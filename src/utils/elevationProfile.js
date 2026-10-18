// Builds an elevation profile (altitude vs. distance) for ONE activity, read
// on demand from its original FIT / GPX / TCX file. The map's cached tracks
// only keep lat/lon (see trackStore.js), so altitude has to come from the
// original — which is also the full-quality source. Loaded lazily (dynamic
// import from HeatmapView): it pulls in the FIT parser via gpxConvert.js.

import { readFit, readTcx } from './gpxConvert'

const EARTH_RADIUS_M = 6371008.8
const MAX_PROFILE_POINTS = 600

function haversineM(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

// GPX: <trkseg> -> <trkpt lat lon><ele>. Same { lat, lon, ele } shape the
// FIT/TCX readers return, grouped in segments.
function readGpx(bytes) {
  const text = new TextDecoder('utf-8').decode(bytes)
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX malformado')
  const segments = []
  for (const trkseg of doc.getElementsByTagName('trkseg')) {
    const seg = []
    for (const pt of trkseg.getElementsByTagName('trkpt')) {
      const lat = parseFloat(pt.getAttribute('lat'))
      const lon = parseFloat(pt.getAttribute('lon'))
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      const eleEl = pt.getElementsByTagName('ele')[0]
      const ele = eleEl ? parseFloat(eleEl.textContent) : NaN
      seg.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null })
    }
    if (seg.length) segments.push(seg)
  }
  return segments
}

// Returns null when the file has no altitude data at all (e.g. a device
// without a barometer/DEM), otherwise:
//   { dist: number[] (km), ele: number[] (m), lat: number[], lon: number[],
//     min, max, totalKm }
// Averaged into at most MAX_PROFILE_POINTS buckets, which also smooths the
// noisy per-second altitude readings enough to read the shape of the climb.
export async function extractProfile(bytes, ext) {
  let segments
  if (ext === 'fit') segments = await readFit(bytes)
  else if (ext === 'tcx') segments = readTcx(bytes)
  else if (ext === 'gpx') segments = readGpx(bytes)
  else return null

  // Cumulative distance along the track (not across the gap between two
  // segments), keeping only points that actually have an altitude.
  const pts = []
  let dist = 0
  for (const seg of segments) {
    let prev = null
    for (const p of seg) {
      if (prev) dist += haversineM(prev.lat, prev.lon, p.lat, p.lon)
      prev = p
      if (p.ele != null) pts.push({ d: dist, ele: p.ele, lat: p.lat, lon: p.lon })
    }
  }
  if (pts.length < 2) return null

  const buckets = Math.min(MAX_PROFILE_POINTS, pts.length)
  const out = { dist: [], ele: [], lat: [], lon: [], min: Infinity, max: -Infinity, totalKm: 0 }
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * pts.length) / buckets)
    const to = Math.max(from + 1, Math.floor(((b + 1) * pts.length) / buckets))
    let d = 0, e = 0
    for (let i = from; i < to; i++) { d += pts[i].d; e += pts[i].ele }
    const n = to - from
    const mid = pts[Math.min(pts.length - 1, from + (n >> 1))]
    out.dist.push(d / n / 1000)
    out.ele.push(e / n)
    out.lat.push(mid.lat)
    out.lon.push(mid.lon)
    if (e / n < out.min) out.min = e / n
    if (e / n > out.max) out.max = e / n
  }
  out.totalKm = pts[pts.length - 1].d / 1000
  return out
}
