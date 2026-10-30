// Builds an elevation profile (altitude vs. distance) for ONE activity, read
// on demand from its original FIT / GPX / TCX file. The map's cached tracks
// only keep lat/lon (see trackStore.js), so altitude has to come from the
// original — which is also the full-quality source. Loaded lazily (dynamic
// import from HeatmapView): it pulls in the FIT parser via gpxConvert.js.

import { readFit, readTcx, parseXmlLenient } from './gpxConvert'

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
  const doc = parseXmlLenient(new TextDecoder('utf-8').decode(bytes), 'GPX malformado')
  const segments = []
  for (const trkseg of doc.getElementsByTagName('trkseg')) {
    const seg = []
    for (const pt of trkseg.getElementsByTagName('trkpt')) {
      const lat = parseFloat(pt.getAttribute('lat'))
      const lon = parseFloat(pt.getAttribute('lon'))
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
      const eleEl = pt.getElementsByTagName('ele')[0]
      const ele = eleEl ? parseFloat(eleEl.textContent) : NaN
      const timeEl = pt.getElementsByTagName('time')[0]
      seg.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null, time: timeEl ? timeEl.textContent.trim() : null })
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
  return (await extractSeries(bytes, ext)).profile
}

export async function readSegments(bytes, ext) {
  if (ext === 'fit') return readFit(bytes)
  if (ext === 'tcx') return readTcx(bytes)
  if (ext === 'gpx') return readGpx(bytes)
  return null
}

// Both graphs from ONE read of the original file:
//   { profile: <elevation profile or null>, pace: <speed series or null> }
export async function extractSeries(bytes, ext) {
  const segments = await readSegments(bytes, ext)
  if (!segments) return { profile: null, pace: null, splits: null }
  let profile = null
  let pace = null
  let splits = null
  try { profile = buildProfile(segments) } catch (e) { console.warn('[activities-heatmap] altimetria:', e) }
  try { pace = buildPace(segments) } catch (e) { console.warn('[activities-heatmap] ritmo:', e) }
  try { splits = buildSplits(segments) } catch (e) { console.warn('[activities-heatmap] parciais:', e) }
  return { profile, pace, splits }
}

// Per-kilometre splits: [{ km, dist (m), time (s, moving), pace (s/km), gap (s/km | null), elev (net m | null) }]
// "gap" is the grade-adjusted pace (Minetti's running cost model): the pace the
// same effort would give on flat ground. Pauses and GPS glitches are skipped.
const minettiCost = (g) => 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6
function buildSplits(segments) {
  const out = []
  let cd = 0
  let acc = { dist: 0, time: 0, flat: 0, e0: null, e1: null }
  let hasEle = false
  const flush = (force) => {
    if (acc.dist <= 0) return
    if (!force && acc.dist < 999.5) return
    if (force && acc.dist < 150) return
    out.push({
      km: out.length + 1,
      dist: acc.dist,
      time: acc.time,
      pace: acc.time / (acc.dist / 1000),
      gap: hasEle && acc.flat > 0 ? acc.time / (acc.flat / 1000) : null,
      elev: acc.e0 != null && acc.e1 != null ? acc.e1 - acc.e0 : null,
    })
    acc = { dist: 0, time: 0, flat: 0, e0: acc.e1, e1: acc.e1 }
  }
  for (const seg of segments) {
    const pts = seg.filter((p) => p.time && Number.isFinite(Date.parse(p.time)))
    if (pts.length < 2) continue
    // light smoothing of the noisy altitude
    const el = pts.map((p) => p.ele)
    const ok = el.every((v) => v != null)
    const sm = ok ? el.map((_, i) => {
      let s = 0, n = 0
      for (let k = Math.max(0, i - 3); k <= Math.min(el.length - 1, i + 3); k++) { s += el[k]; n++ }
      return s / n
    }) : null
    if (ok) hasEle = true
    if (sm && acc.e0 == null) { acc.e0 = sm[0]; acc.e1 = sm[0] }
    for (let i = 1; i < pts.length; i++) {
      const dt = (Date.parse(pts[i].time) - Date.parse(pts[i - 1].time)) / 1000
      if (!(dt > 0) || dt > 60) continue
      const dd = haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon)
      if (dd / dt < 0.4 || dd / dt > 15) continue // standing still / GPS glitch
      let g = sm && dd >= 1 ? Math.max(-0.45, Math.min(0.45, (sm[i] - sm[i - 1]) / dd)) : 0
      const factor = Math.max(0.3, minettiCost(g) / 3.6)
      let left = dd
      let frac0 = 0
      while (left > 0) {
        const room = (out.length + 1) * 1000 - cd
        const take = Math.min(left, Math.max(room, 0.001))
        const f = take / dd
        acc.dist += take
        acc.time += dt * f
        acc.flat += take * factor
        if (sm) acc.e1 = sm[i - 1] + (sm[i] - sm[i - 1]) * Math.min(1, frac0 + f)
        cd += take
        left -= take
        frac0 += f
        if (acc.dist >= 999.5) flush(false)
      }
    }
  }
  flush(true)
  return out.length ? out : null
}

// Speed (km/h) along the track, from the timestamps. Time spent standing still
// or paused (gaps between two points > 20 s) does not count, and each sample
// is smoothed over its neighbours so the line is readable.
//   { dist: km[], speed: km/h[] (null = stopped), lat[], lon[], totalKm }
const MAX_PACE_POINTS = 300
const PAUSE_GAP_S = 20
function buildPace(segments) {
  const pts = []
  let dist = 0
  for (const seg of segments) {
    let prev = null
    for (const p of seg) {
      if (prev) dist += haversineM(prev.lat, prev.lon, p.lat, p.lon)
      prev = p
      const t = p.time ? Date.parse(p.time) : NaN
      if (Number.isFinite(t)) pts.push({ d: dist, t, lat: p.lat, lon: p.lon })
    }
  }
  if (pts.length < 12) return null

  const n = Math.min(MAX_PACE_POINTS, Math.floor(pts.length / 3))
  const sumD = new Array(n).fill(0)
  const sumT = new Array(n).fill(0)
  const mid = new Array(n)
  for (let b = 0; b < n; b++) {
    const from = Math.floor((b * pts.length) / n)
    const to = Math.max(from + 1, Math.floor(((b + 1) * pts.length) / n))
    mid[b] = pts[Math.min(pts.length - 1, from + ((to - from) >> 1))]
    for (let i = Math.max(from, 1); i <= Math.min(to, pts.length - 1); i++) {
      const dt = (pts[i].t - pts[i - 1].t) / 1000
      if (dt > 0 && dt <= PAUSE_GAP_S) { sumD[b] += pts[i].d - pts[i - 1].d; sumT[b] += dt }
    }
  }
  const out = { dist: [], speed: [], lat: [], lon: [], totalKm: pts[pts.length - 1].d / 1000 }
  let valid = 0
  for (let b = 0; b < n; b++) {
    let d = 0, t = 0
    for (let k = Math.max(0, b - 2); k <= Math.min(n - 1, b + 2); k++) { d += sumD[k]; t += sumT[k] }
    const kmh = t > 0 ? (d / t) * 3.6 : null
    out.dist.push(mid[b].d / 1000)
    out.speed.push(kmh != null && kmh >= 0.5 ? kmh : null)
    out.lat.push(mid[b].lat)
    out.lon.push(mid[b].lon)
    if (kmh != null && kmh >= 0.5) valid++
  }
  return valid >= n / 4 ? out : null
}

function buildProfile(segments) {
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
