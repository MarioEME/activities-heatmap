// Download helpers. The normal path is downloading an activity's ORIGINAL
// file (FIT/GPX/TCX, byte-for-byte — see HeatmapView's
// downloadOriginalForActivity). buildGpxString below is only the fallback
// for activities with no original at all: it rebuilds a GPX from the
// already-loaded track points, which only keep the lat/lon of points that
// shape the line (no time, elevation or heart rate), so that output is not
// a copy of the original recording.

import { t } from '../i18n'

function escapeXml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]))
}

function slugifyFilename(name) {
  const base = String(name || 'atividade')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return base || 'atividade'
}

export function buildGpxString(activity) {
  const points = activity.latlngs || []
  const trkpts = points
    .map(([lat, lon]) => `      <trkpt lat="${lat}" lon="${lon}"></trkpt>`)
    .join('\n')
  const name = escapeXml(activity.name || t('common.activity'))
  const time = activity.date && !isNaN(activity.date) ? activity.date.toISOString() : null

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="activities-heatmap" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    ${time ? `<time>${time}</time>` : ''}
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`
}

export function buildGpxFilename(activity) {
  const datePart = activity.dateLabel && activity.dateLabel !== '—' ? `${activity.dateLabel}-` : ''
  return `${datePart}${slugifyFilename(activity.name)}.gpx`
}

// Same naming scheme as buildGpxFilename, but for the activity's ORIGINAL
// file (whatever format it actually is — see sourceFileExtension below),
// used when offering that file for download instead of a reconstructed,
// simplified GPX.
export function buildOriginalFilename(activity, ext) {
  const datePart = activity.dateLabel && activity.dateLabel !== '—' ? `${activity.dateLabel}-` : ''
  return `${datePart}${slugifyFilename(activity.name)}.${ext}`
}

// `sourceFile` is always "activities/<id>.<ext>.gz" (see zipParser.js /
// dropboxFiles.js) — pull the real extension (fit/gpx/tcx) back out of it.
export function sourceFileExtension(sourceFile) {
  const withoutGz = String(sourceFile || '').replace(/\.gz$/i, '')
  const match = withoutGz.match(/\.([a-z0-9]+)$/i)
  return match ? match[1].toLowerCase() : 'dat'
}

const MIME_BY_EXTENSION = {
  fit: 'application/octet-stream', // binary format, no registered XML/text MIME type
  gpx: 'application/gpx+xml',
  tcx: 'application/vnd.garmin.tcx+xml',
}

export function mimeForExtension(ext) {
  return MIME_BY_EXTENSION[ext] || 'application/octet-stream'
}

// Triggers a browser "save as" for arbitrary bytes (or a GPX string),
// without needing a pre-built data: URI — unlike the GPX reconstruction
// above, downloading an original file requires an async fetch first (local
// cache or Dropbox), so it can't be wired up as a plain <a href="data:...">
// at popup-render time.
export function triggerBytesDownload(bytes, filename, mime) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
