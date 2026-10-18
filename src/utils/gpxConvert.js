// Converts an activity's ORIGINAL FIT or TCX file into a GPX 1.1 file, for
// people who need GPX (most route tools and apps import it) when the
// original isn't one. Unlike gpxExport.js's buildGpxString — which can only
// rebuild lat/lon from the simplified map points — this reads the original
// file again, so the GPX keeps time, elevation, heart rate, cadence and
// temperature for every recorded point (heart rate/cadence/temperature via
// the standard Garmin TrackPointExtension, which Strava, Garmin Connect and
// most other apps read).
//
// Loaded on demand (dynamic import from the popup's download button) so
// fit-file-parser doesn't need to be initialised just to browse the map.

import FitParser from 'fit-file-parser'
import { t } from '../i18n'

function escapeXml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]))
}

function isoOrNull(value) {
  const d = value instanceof Date ? value : value ? new Date(value) : null
  return d && !isNaN(d) ? d.toISOString() : null
}

function num(v) {
  return Number.isFinite(v) ? v : null
}

// Each point: { lat, lon, ele, time, hr, cad, temp } (any of the last five
// may be null). Points are grouped in segments (one per TCX <Track>; a FIT
// file is a single segment).
export async function readFit(bytes) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const parser = new FitParser({
    force: true,
    mode: 'list',
    lengthUnit: 'm',
    elapsedRecordField: false,
  })
  const result = await parser.parseAsync(buffer)
  const seg = []
  for (const r of result?.records || []) {
    const lat = num(r.position_lat)
    const lon = num(r.position_long)
    if (lat == null || lon == null) continue
    seg.push({
      lat,
      lon,
      ele: num(r.enhanced_altitude) ?? num(r.altitude),
      time: isoOrNull(r.timestamp),
      hr: num(r.heart_rate),
      cad: num(r.cadence),
      temp: num(r.temperature),
    })
  }
  return [seg]
}

export function readTcx(bytes) {
  const text = new TextDecoder('utf-8').decode(bytes)
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('TCX malformado')

  const first = (el, tag) => el.getElementsByTagName(tag)[0]
  const numberOf = (el) => (el ? num(parseFloat(el.textContent)) : null)

  const segments = []
  for (const track of doc.getElementsByTagName('Track')) {
    const seg = []
    for (const tp of track.getElementsByTagName('Trackpoint')) {
      const pos = first(tp, 'Position')
      if (!pos) continue
      const lat = numberOf(first(pos, 'LatitudeDegrees'))
      const lon = numberOf(first(pos, 'LongitudeDegrees'))
      if (lat == null || lon == null) continue
      const hrEl = first(tp, 'HeartRateBpm')
      seg.push({
        lat,
        lon,
        ele: numberOf(first(tp, 'AltitudeMeters')),
        time: isoOrNull(first(tp, 'Time')?.textContent),
        hr: hrEl ? numberOf(first(hrEl, 'Value')) : null,
        cad: numberOf(first(tp, 'Cadence')),
        temp: null,
      })
    }
    if (seg.length) segments.push(seg)
  }
  return segments
}

function trkptXml(p) {
  const parts = []
  if (p.ele != null) parts.push(`<ele>${p.ele}</ele>`)
  if (p.time) parts.push(`<time>${p.time}</time>`)
  const ext = []
  if (p.temp != null) ext.push(`<gpxtpx:atemp>${p.temp}</gpxtpx:atemp>`)
  if (p.hr != null) ext.push(`<gpxtpx:hr>${Math.round(p.hr)}</gpxtpx:hr>`)
  if (p.cad != null) ext.push(`<gpxtpx:cad>${Math.round(p.cad)}</gpxtpx:cad>`)
  if (ext.length) parts.push(`<extensions><gpxtpx:TrackPointExtension>${ext.join('')}</gpxtpx:TrackPointExtension></extensions>`)
  return `      <trkpt lat="${p.lat}" lon="${p.lon}">${parts.join('')}</trkpt>`
}

// `ext` is the original file's extension ('fit' | 'tcx'; a 'gpx' original
// needs no conversion). Returns the GPX text, or null when the file has no
// GPS points at all (e.g. an indoor activity). Throws if the file can't be
// read.
export async function convertToGpx(bytes, ext, activity) {
  let segments
  if (ext === 'fit') segments = await readFit(bytes)
  else if (ext === 'tcx') segments = readTcx(bytes)
  else throw new Error(t('err.noConvert', { ext }))

  segments = segments.filter((s) => s.length)
  if (!segments.length) return null

  const name = escapeXml(activity?.name || t('common.activity'))
  const time = isoOrNull(activity?.date) || segments[0][0].time
  const trksegs = segments
    .map((seg) => `    <trkseg>\n${seg.map(trkptXml).join('\n')}\n    </trkseg>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="activities-heatmap" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <metadata>${time ? `<time>${time}</time>` : ''}</metadata>
  <trk>
    <name>${name}</name>
${trksegs}
  </trk>
</gpx>
`
}
