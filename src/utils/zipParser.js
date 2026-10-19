import { t } from '../i18n'
import JSZip from 'jszip'
import Papa from 'papaparse'
import { inflate } from 'pako'
import FitParser from 'fit-file-parser'

// ---- CSV header resolution -------------------------------------------------
// Strava's bulk-export CSV headers are translated to match the athlete's
// account language (e.g. a Portuguese account gets "ID da atividade" instead
// of "Activity ID"). We try common translations by name first, and — since we
// can't cover every language — fall back to detecting the two columns that
// matter most (the GPS filename and the date) by the *shape* of their values,
// which don't change with language.
const FIELD_ALIASES = {
  id: ['activity id', 'id da atividade', 'id de la actividad', "id de l'activité", 'aktivitäts-id'],
  date: ['activity date', 'data da atividade', 'fecha de la actividad', "date de l'activité", 'aktivitätsdatum'],
  name: ['activity name', 'nome da atividade', 'nombre de la actividad', "nom de l'activité", 'aktivitätsname'],
  description: ['activity description', 'descrição da atividade', 'descripción de la actividad', "description de l'activité", 'aktivitätsbeschreibung'],
  type: ['activity type', 'tipo de atividade', 'tipo de actividad', "type d'activité", 'aktivitätstyp'],
  filename: ['filename', 'nome do ficheiro', 'nome do arquivo', 'nombre de archivo', 'nom du fichier', 'dateiname'],
  elapsedTime: ['elapsed time', 'tempo decorrido', 'tiempo transcurrido', 'temps écoulé', 'verstrichene zeit'],
  movingTime: ['moving time', 'tempo em movimento', 'tiempo en movimiento', 'temps de déplacement', 'bewegungszeit'],
  distance: ['distance', 'distância', 'distancia'],
  elevationGain: ['elevation gain', 'ganho de elevação', 'desnivel positivo', "dénivelé positif", 'höhengewinn'],
  avgHr: ['average heart rate', 'frequência cardíaca média', 'frecuencia cardíaca media'],
  maxHr: ['max heart rate', 'frequência cardíaca máxima', 'frecuencia cardíaca máxima'],
  avgSpeed: ['average speed', 'velocidade média', 'velocidad media'],
  maxSpeed: ['max speed', 'velocidade máxima', 'velocidad máxima'],
  commute: ['commute', 'deslocação', 'deslocamento', 'trajet domicile-travail'],
  gear: ['activity gear', 'gear', 'equipamento da atividade', 'equipamento'],
  // Confirmed against a real Strava export (PT account): there's no single
  // "workout type" column — it's two separate true/false columns, one per
  // tag. "Workout" has no column of its own at all, only Race and Long Run.
  workoutRace: ['competição', 'competition', 'race', 'carrera', 'wettkampf'],
  workoutLongRun: ['corrida longa', 'long run', 'carrera larga', 'course longue', 'langer lauf'],
}

function buildHeaderMap(fields) {
  const lower = fields.map((f) => (f || '').trim().toLowerCase())
  const map = {}
  for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
    let foundIndex = -1
    for (const alias of aliases) {
      foundIndex = lower.indexOf(alias)
      if (foundIndex !== -1) break
    }
    map[key] = foundIndex === -1 ? null : fields[foundIndex]
  }
  return map
}

// Scans sample rows to find which column holds the GPS filename, by looking
// for the file-extension pattern rather than the (possibly translated)
// header text. This is what makes tracks load even when we don't recognise
// the account's language at all.
function detectFilenameColumn(rows, fields) {
  const pattern = /\.(gpx|tcx|fit)(\.gz)?$/i
  let bestField = null
  let bestScore = 0
  const sample = rows.slice(0, 200)
  for (const field of fields) {
    let score = 0
    for (const row of sample) {
      if (pattern.test(String(row[field] || '').trim())) score++
    }
    if (score > bestScore) { bestScore = score; bestField = field }
  }
  return bestScore > 0 ? bestField : null
}

// Scans sample rows to find which column holds the activity date, by testing
// which values parse into plausible dates (again, independent of language).
function detectDateColumn(rows, fields, excludeField) {
  let bestField = null
  let bestScore = 0
  const sample = rows.slice(0, 200)
  for (const field of fields) {
    if (field === excludeField) continue
    let score = 0
    for (const row of sample) {
      const raw = row[field]
      if (!raw) continue
      const d = parseActivityDate(raw)
      if (d && d.getFullYear() > 1990 && d.getFullYear() < 2100) score++
    }
    if (score > bestScore) { bestScore = score; bestField = field }
  }
  return bestScore > 0 ? bestField : null
}

// Parses a numeric string whose decimal/thousands separators could go
// either way depending on the exporting account's locale: "48,001" might
// mean 48001 (comma grouping thousands, period decimal) or 48.001 (comma
// decimal, no grouping) — the two conventions disagree on what a lone comma
// means. We disambiguate instead of always guessing one way, since blindly
// treating comma as decimal turns "48,001" (48001) into "48.001", silently
// shrinking a distance by ~1000x.
function toNumber(v) {
  if (v === undefined || v === null || v === '') return null
  let s = String(v).trim()
  if (s === '') return null

  const hasComma = s.includes(',')
  const hasDot = s.includes('.')

  if (hasComma && hasDot) {
    // Both present: whichever comes last is the decimal separator, the
    // other is thousands grouping and gets stripped. Covers "48,001.5" (US)
    // and "48.001,5" (EU) alike.
    const lastComma = s.lastIndexOf(',')
    const lastDot = s.lastIndexOf('.')
    s = lastComma > lastDot
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '')
  } else if (hasComma && !hasDot) {
    // Only a comma: ambiguous on its own. A decimal comma almost always has
    // 1-2 digits after it (e.g. "48,5" = 48.5); anything else (e.g. "48,001")
    // is far more likely a thousands-grouped whole number.
    const parts = s.split(',')
    s = parts.length === 2 && parts[1].length <= 2
      ? s.replace(',', '.')
      : s.replace(/,/g, '')
  }
  // a lone period needs no special handling — it's already a valid JS decimal

  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

// Strava's real export date format is like "Mar 10, 2024, 6:03:02 PM" for
// English accounts — a spelled-out month name. On a non-English account the
// whole string is translated (month name, and sometimes day/month order),
// and JS's native `new Date(str)` parser only understands English month
// names: it returns "Invalid Date" for anything else, silently. That
// invalid date then fails every date-based filter, which looks exactly like
// "the date filter isn't working". This table lets us recognise the month
// regardless of language and rebuild the date ourselves.
const MONTH_NAMES = {
  jan: 0, janeiro: 0, enero: 0, janvier: 0, januar: 0, gennaio: 0,
  feb: 1, fev: 1, fevereiro: 1, febrero: 1, février: 1, februar: 1, febbraio: 1,
  mar: 2, mars: 2, março: 2, marzo: 2, märz: 2,
  apr: 3, abr: 3, abril: 3, avril: 3, april: 3, aprile: 3,
  may: 4, mai: 4, maio: 4, mayo: 4, maggio: 4,
  jun: 5, junho: 5, junio: 5, juin: 5, juni: 5, giugno: 5,
  jul: 6, julho: 6, julio: 6, juillet: 6, juli: 6, luglio: 6,
  aug: 7, ago: 7, agosto: 7, août: 7, agosto_: 7,
  sep: 8, set: 8, setembro: 8, septiembre: 8, septembre: 8, september: 8, settembre: 8,
  oct: 9, out: 9, outubro: 9, octubre: 9, octobre: 9, oktober: 9, ottobre: 9,
  nov: 10, novembro: 10, noviembre: 10, novembre: 10, november: 10,
  dec: 11, dez: 11, dezembro: 11, diciembre: 11, décembre: 11, dezember: 11, dicembre: 11,
}

// Confirmed real-world format from an actual Strava export on a Portuguese
// account: "15 de jul. de 2026, 05:38:48" — day, abbreviated month with a
// trailing period, year, then time, joined with "de". Matched and parsed
// directly (no heuristics) since we know its exact shape, before falling
// back to anything more general.
const PT_EXACT_RE = /^(\d{1,2})\s+de\s+([a-zçã]{3,})\.?\s+de\s+(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/i

function parsePtExactDate(str) {
  const s = String(str).trim()
  const m = s.match(PT_EXACT_RE)
  if (!m) return null
  const [, dayStr, monthStr, yearStr, hourStr, minStr, secStr] = m
  const month = MONTH_NAMES[monthStr.toLowerCase()]
  if (month === undefined) return null
  const d = new Date(Number(yearStr), month, Number(dayStr), Number(hourStr), Number(minStr), secStr ? Number(secStr) : 0)
  return isNaN(d) ? null : d
}

// Matches a month name (any language above) anywhere in the string, plus a
// 4-digit year, a 1-2 digit day, and an optional HH:MM(:SS) [AM/PM] time —
// regardless of the order the locale puts them in.
function parseLocalizedDate(str) {
  const s = String(str).trim()
  const monthPattern = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join('|')
  const monthMatch = s.match(new RegExp(`\\b(${monthPattern})[a-zçãéíóú]*\\b`, 'i'))
  const yearMatch = s.match(/\b(\d{4})\b/)
  if (!monthMatch || !yearMatch) return null

  const month = MONTH_NAMES[monthMatch[1].toLowerCase()]
  const year = Number(yearMatch[1])

  // day: the 1-2 digit number nearest the month name that isn't the year
  const dayMatch = s.match(/\b(\d{1,2})\b(?!.*\b\d{4}\b.*\1\b)/) // first small number in the string
  let day = 1
  const allSmallNums = [...s.matchAll(/\b(\d{1,2})\b/g)].map((m) => Number(m[1]))
  if (allSmallNums.length) day = allSmallNums[0]

  // time: HH:MM(:SS) with optional AM/PM (in various spellings) anywhere after the date
  const timeMatch = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp]\.?[Mm]\.?)?/)
  let hour = 0, minute = 0, second = 0
  if (timeMatch) {
    hour = Number(timeMatch[1])
    minute = Number(timeMatch[2])
    second = timeMatch[3] ? Number(timeMatch[3]) : 0
    const meridiem = (timeMatch[4] || '').toLowerCase().replace(/\./g, '')
    if (meridiem === 'pm' && hour < 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
  }

  const d = new Date(year, month, day, hour, minute, second)
  return isNaN(d) ? null : d
}

// Parse order: (1) the exact confirmed real-world PT format first — no
// guessing, so it can't be thrown off by an unrelated number elsewhere in
// the string; (2) the native JS parser, which covers ISO timestamps and
// English-locale exports; (3) the generic multilingual heuristic parser as
// a last resort for locales we haven't special-cased.
function parseActivityDate(raw) {
  if (!raw) return null
  const exact = parsePtExactDate(raw)
  if (exact) return exact
  const native = new Date(raw)
  if (!isNaN(native)) return native
  return parseLocalizedDate(raw)
}

// Builds a strava.com activity link from the CSV's "Activity ID" column.
// Worth flagging: this ID is what Strava's own bulk-export CSV calls
// "Activity ID", but there are scattered user reports of it not matching
// the ID used in the actual strava.com/activities/{id} URL for some
// accounts/exports — occasionally showing a different activity entirely.
// We still use it (it's the only ID we have, and it's correct for most
// exports), but treat it as "best effort", not a guarantee.
function stravaLink(activityId) {
  // Guard against the synthetic "row-N" fallback used when a CSV row has no
  // real Activity ID — only build a link for something that looks like an
  // actual numeric Strava ID.
  if (!activityId || !/^\d+$/.test(String(activityId))) return null
  return `https://www.strava.com/activities/${activityId}`
}

// ---- Track point extraction -------------------------------------------------

// Every GPS fix in the file is collected (no fixed point cap, no striding):
// a fixed cap is what made long activities look angular/cut. Instead,
// downsample() below only drops points that don't change the drawn line —
// see there. Infinity keeps the stride logic in the extractors below as a
// no-op (stride is always 1) without having to rewrite them.
const HARD_POINT_CAP = Infinity

// Maximum distance (in metres) a dropped point may be from the simplified
// line. Consumer GPS is only accurate to a few metres, and at the deepest
// map zoom (z19, roughly 0.3 m per pixel) 0.3 m is under one pixel, so
// this removes redundant points (straight stretches, standing still)
// without any visible change to the route at any zoom the map offers.
const SIMPLIFY_TOLERANCE_M = 0.3

// The file extension a track file should be stored under on Dropbox, once
// any ".gz" suffix is stripped (we always re-gzip ourselves at upload time —
// see dropboxFiles.js — so the stored name is always "<id>.<ext>.gz"
// regardless of whether the original in the zip already was).
function baseExtension(filename) {
  const noGz = filename.toLowerCase().endsWith('.gz') ? filename.slice(0, -3) : filename
  const m = noGz.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toLowerCase() : 'dat'
}

// Near-lossless line simplification (Douglas-Peucker, iterative so a
// 200,000-point multi-day track can't blow the call stack). Keeps the first
// and last point and every point that deviates more than
// SIMPLIFY_TOLERANCE_M from the line through its neighbours; everything
// else is redundant for drawing. Unlike a fixed point cap, short tracks
// aren't touched much and long ones keep their detail where the route
// actually turns. (The original file is stored untouched on Dropbox — this
// only affects the points used to draw the map.)
function downsample(points) {
  const n = points.length
  if (n <= 2) return points

  // Project to local metres (equirectangular around the track's first
  // point) — plenty accurate for a distance tolerance this small.
  const M_PER_DEG = 111320
  const cosLat = Math.cos((points[0][0] * Math.PI) / 180)
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xs[i] = points[i][1] * cosLat * M_PER_DEG
    ys[i] = points[i][0] * M_PER_DEG
  }

  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const tol2 = SIMPLIFY_TOLERANCE_M * SIMPLIFY_TOLERANCE_M
  const stack = [0, n - 1]

  while (stack.length) {
    const end = stack.pop()
    const start = stack.pop()
    if (end - start < 2) continue

    const ax = xs[start], ay = ys[start]
    const dx = xs[end] - ax, dy = ys[end] - ay
    const len2 = dx * dx + dy * dy

    let maxD2 = -1
    let maxIdx = -1
    for (let i = start + 1; i < end; i++) {
      const px = xs[i] - ax, py = ys[i] - ay
      let d2
      if (len2 === 0) {
        d2 = px * px + py * py // closed loop: first == last
      } else {
        let t = (px * dx + py * dy) / len2
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const ex = px - t * dx, ey = py - t * dy
        d2 = ex * ex + ey * ey
      }
      if (d2 > maxD2) { maxD2 = d2; maxIdx = i }
    }

    if (maxD2 > tol2) {
      keep[maxIdx] = 1
      stack.push(start, maxIdx, maxIdx, end)
    }
  }

  const out = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i])
  return out
}

// Strava lets you mark an activity as a "Race" or, separately, as a "Long
// Run" — in the CSV export these are two independent true/false columns
// (Competição / Corrida longa in a PT account), not one combined field.
// "Race" wins if somehow both are set; anything with neither becomes
// 'Outro', so every activity always has *some* value here, same as the
// plain activity type.
function parseBoolField(raw) {
  return String(raw ?? '').trim().toLowerCase() === 'true'
}
function workoutTypeLabel(isRace, isLongRun) {
  if (isRace) return 'Prova'
  if (isLongRun) return 'Treino longo'
  return 'Outro'
}

function bytesToString(bytes) {
  let text = new TextDecoder('utf-8').decode(bytes)
  // A DOMParser rejects the *entire* document if anything precedes the
  // `<?xml ...?>` declaration — a stray BOM character or leading
  // whitespace is enough to trigger exactly the "XML or text declaration
  // not at start of entity" error, and that failure doesn't throw a JS
  // exception we can catch; the browser just logs it and hands back an
  // unusable document. TextDecoder should already strip a UTF-8 BOM, but
  // we strip it again defensively (some upstream tooling can double-encode
  // it) and trim any leading whitespace/newlines too.
  text = text.replace(/^\uFEFF/, '').replace(/^\s+/, '')
  return text
}

// DOMParser doesn't throw on malformed XML — it returns a document
// containing a <parsererror> element instead. Without checking for this,
// a bad file silently contributes zero track points with no way to tell
// "this activity genuinely has no GPS data" apart from "this file failed
// to parse". We check explicitly so failures can be logged and counted.
function isParseError(doc) {
  return !!doc.getElementsByTagName('parsererror').length
}

// Extracts [lat, lon] pairs directly from raw GPX/TCX text via regex,
// striding through matches so we never hold more than ~HARD_POINT_CAP
// points at once — critical for multi-day tracks with hundreds of
// thousands of points. This is also dramatically lighter than DOMParser:
// building a full DOM tree for 200,000+ <trkpt> elements can use hundreds
// of MB (each DOM element carries far more overhead than a plain [num,num]
// pair), which is almost certainly what was crashing the tab. Returns null
// (not []) if the pattern isn't found at all, so callers can fall back to
// a stricter parser for unusual file shapes rather than assuming "no GPS".
// Two-group variant (single fixed group order) used for TCX, where
// LatitudeDegrees/LongitudeDegrees always appear in that order inside a
// Position element.
function extractPointsByRegex(text, regex) {
  // First pass: count matches only (regex.exec in a tight loop without
  // capturing/storing anything) to size the stride correctly up front.
  let count = 0
  regex.lastIndex = 0
  while (regex.exec(text)) count++
  if (count === 0) return null

  const stride = count > HARD_POINT_CAP ? Math.ceil(count / HARD_POINT_CAP) : 1
  const pts = []
  regex.lastIndex = 0
  let i = 0
  let m
  while ((m = regex.exec(text))) {
    if (i % stride === 0) {
      const lat = parseFloat(m[1])
      const lon = parseFloat(m[2])
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon])
    }
    i++
  }
  return pts
}

const GPX_TRKPT_RE = /<trkpt\b[^>]*?\blat=["']([-\d.]+)["'][^>]*?\blon=["']([-\d.]+)["'][^>]*?\/?>|<trkpt\b[^>]*?\blon=["']([-\d.]+)["'][^>]*?\blat=["']([-\d.]+)["'][^>]*?\/?>/gi
const GPX_RTEPT_RE = /<rtept\b[^>]*?\blat=["']([-\d.]+)["'][^>]*?\blon=["']([-\d.]+)["'][^>]*?\/?>|<rtept\b[^>]*?\blon=["']([-\d.]+)["'][^>]*?\blat=["']([-\d.]+)["'][^>]*?\/?>/gi

function extractPointsGpxRegex(text, tagRegex) {
  // The regex has two alternatives (lat-then-lon, lon-then-lat) so groups
  // 1/2 or 3/4 will be set depending on which one matched.
  let count = 0
  tagRegex.lastIndex = 0
  while (tagRegex.exec(text)) count++
  if (count === 0) return null

  const stride = count > HARD_POINT_CAP ? Math.ceil(count / HARD_POINT_CAP) : 1
  const pts = []
  tagRegex.lastIndex = 0
  let i = 0
  let m
  while ((m = tagRegex.exec(text))) {
    if (i % stride === 0) {
      const lat = parseFloat(m[1] !== undefined ? m[1] : m[4])
      const lon = parseFloat(m[1] !== undefined ? m[2] : m[3])
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon])
    }
    i++
  }
  return pts
}

function parseGPX(xmlText, debugLabel, activityId) {
  // Fast path: regex extraction straight to numbers, no DOM tree at all.
  // Handles the overwhelming majority of real GPX files (including huge
  // ones) without the memory cost of DOMParser.
  const fast = extractPointsGpxRegex(xmlText, GPX_TRKPT_RE) || extractPointsGpxRegex(xmlText, GPX_RTEPT_RE)
  if (fast && fast.length) return { points: downsample(fast), reason: null }

  // Fallback: only reached for files where the fast pattern found nothing
  // (unusual namespacing, unexpected structure, or a genuinely GPS-less
  // file) — these are rare, so the DOM overhead here is acceptable, and it
  // also gives us proper malformed-XML detection for genuinely broken files.
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (isParseError(doc)) {
    console.warn(
      `[activities-heatmap] Falha ao interpretar GPX${debugLabel ? ` (${debugLabel})` : ''}: XML malformado. ` +
        `Primeiros 120 caracteres do ficheiro: ${JSON.stringify(xmlText.slice(0, 120))}`
    )
    return { points: [], reason: 'malformed-xml' }
  }
  const pts = []
  const trkpts = doc.getElementsByTagName('trkpt')
  for (let i = 0; i < trkpts.length; i++) {
    const el = trkpts[i]
    const lat = parseFloat(el.getAttribute('lat'))
    const lon = parseFloat(el.getAttribute('lon'))
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon])
  }
  if (pts.length === 0) {
    const rtepts = doc.getElementsByTagName('rtept')
    for (let i = 0; i < rtepts.length; i++) {
      const el = rtepts[i]
      const lat = parseFloat(el.getAttribute('lat'))
      const lon = parseFloat(el.getAttribute('lon'))
      if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon])
    }
  }
  if (pts.length === 0) {
    // The file parsed as valid XML but contains no <trkpt>/<rtept> elements
    // at all — this is the normal shape of an indoor/trainer activity's
    // GPX export (Strava still writes one, just with no GPS fix), so it's
    // *expected* for a fraction of activities and not itself an error.
    const link = stravaLink(activityId)
    console.info(
      `[activities-heatmap] GPX válido mas sem pontos de GPS${debugLabel ? ` (${debugLabel})` : ''}` +
        (link ? ` — ${link}` : '')
    )
    return { points: [], reason: 'no-gps-points' }
  }
  return { points: downsample(pts), reason: null }
}

// Sum of great-circle distances between consecutive points — an
// approximation (computed on the already-simplified display points, not
// every raw GPS fix), fine for the summary shown for a manually-imported
// GPX, but not meant to exactly match what a device/Strava would report.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function totalDistanceKm(latlngs) {
  let total = 0
  for (let i = 1; i < latlngs.length; i++) {
    total += haversineKm(latlngs[i - 1][0], latlngs[i - 1][1], latlngs[i][0], latlngs[i][1])
  }
  return total
}

// Parses a single, standalone .gpx file (as picked directly from disk, not
// extracted from a Strava export) into the same activity shape the zip
// importer produces, so it can go through the exact same map rendering,
// filtering and merge-duplicate-detection code paths. GPX itself carries
// none of Strava's per-activity summary fields (distance, elevation gain,
// moving time, average speed/HR, activity type) — only the raw track —
// so those are approximated here from the points/timestamps/elevations in
// the file itself, and that approximation is deliberately kept separate
// from (and simpler than) the CSV-driven parsing above.
export async function parseGpxActivityFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xmlText = bytesToString(bytes)

  const { points: latlngs, reason } = parseGPX(xmlText, file.name)

  const nameMatch = xmlText.match(/<trk\b[^>]*>[\s\S]*?<name>([^<]*)<\/name>/i) || xmlText.match(/<name>([^<]*)<\/name>/i)
  const name = nameMatch ? nameMatch[1].trim() : file.name.replace(/\.gpx$/i, '')

  const typeMatch = xmlText.match(/<trk\b[^>]*>[\s\S]*?<type>([^<]*)<\/type>/i)
  const type = typeMatch ? typeMatch[1].trim() : 'Other'

  const descMatch = xmlText.match(/<trk\b[^>]*>[\s\S]*?<desc>([^<]*)<\/desc>/i) || xmlText.match(/<desc>([^<]*)<\/desc>/i)
  const description = descMatch ? descMatch[1].trim() : ''

  // First/last <time> in the whole document — close enough for a rough
  // start time and elapsed duration without walking every single point.
  const times = [...xmlText.matchAll(/<time>([^<]*)<\/time>/gi)]
    .map((m) => new Date(m[1]))
    .filter((d) => !isNaN(d))
  const startTime = times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : null
  const endTime = times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null
  const elapsedTime = startTime && endTime ? Math.round((endTime - startTime) / 1000) : null

  const elevations = [...xmlText.matchAll(/<ele>([-\d.]+)<\/ele>/gi)].map((m) => parseFloat(m[1]))
  let elevationGain = null
  if (elevations.length > 1) {
    elevationGain = 0
    for (let i = 1; i < elevations.length; i++) {
      const diff = elevations[i] - elevations[i - 1]
      if (diff > 0) elevationGain += diff
    }
  }

  const hasTrack = !!(latlngs && latlngs.length > 1)
  const distanceKm = hasTrack ? totalDistanceKm(latlngs) : null
  const avgSpeedKmh = distanceKm != null && elapsedTime ? distanceKm / (elapsedTime / 3600) : null

  const id = `gpx-${(startTime || new Date()).getTime()}-${Math.random().toString(36).slice(2, 8)}`
  // The uploaded .gpx itself is the original file here (there's no separate
  // zip entry to defer to) — kept alongside the activity, not inside it,
  // for the same reason as the zip import path (see parseStravaZip above).
  const sourceFile = `activities/${id}.gpx.gz`

  return {
    activity: {
      id,
      name: name || t('edit.unnamed'),
      description,
      source: 'manual', // picked directly as a standalone .gpx file, not from a Strava export
      type,
      date: startTime,
      dateLabel: startTime && !isNaN(startTime) ? startTime.toISOString().slice(0, 10) : '—',
      distanceKm,
      elevationGain,
      movingTime: elapsedTime, // approximation: elapsed time, not true moving time (no pause detection without speed data)
      elapsedTime,
      avgHr: null,
      avgSpeedKmh,
      commute: false,
      gear: null,
      workoutType: 'Outro', // GPX files carry no Strava race/long-run tagging
      filename: file.name,
      hasTrack,
      latlngs: hasTrack ? latlngs : null,
      sourceFile,
    },
    trackFailure: !hasTrack,
    failureReason: !hasTrack ? (reason || 'no-gps-points') : null,
    originalFile: { id, sourceFile, name: file.name, bytes, alreadyGzipped: false },
  }
}

const TCX_POS_RE = /<Position>\s*<LatitudeDegrees>([-\d.]+)<\/LatitudeDegrees>\s*<LongitudeDegrees>([-\d.]+)<\/LongitudeDegrees>\s*<\/Position>/gi

function parseTCX(xmlText, debugLabel, activityId) {
  const fast = extractPointsByRegex(xmlText, TCX_POS_RE)
  if (fast && fast.length) return { points: downsample(fast), reason: null }

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  if (isParseError(doc)) {
    console.warn(
      `[activities-heatmap] Falha ao interpretar TCX${debugLabel ? ` (${debugLabel})` : ''}: XML malformado. ` +
        `Primeiros 120 caracteres do ficheiro: ${JSON.stringify(xmlText.slice(0, 120))}`
    )
    return { points: [], reason: 'malformed-xml' }
  }
  const pts = []
  const trackpoints = doc.getElementsByTagName('Trackpoint')
  for (let i = 0; i < trackpoints.length; i++) {
    const pos = trackpoints[i].getElementsByTagName('Position')[0]
    if (!pos) continue
    const latEl = pos.getElementsByTagName('LatitudeDegrees')[0]
    const lonEl = pos.getElementsByTagName('LongitudeDegrees')[0]
    if (!latEl || !lonEl) continue
    const lat = parseFloat(latEl.textContent)
    const lon = parseFloat(lonEl.textContent)
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon])
  }
  if (pts.length === 0) {
    const link = stravaLink(activityId)
    console.info(
      `[activities-heatmap] TCX válido mas sem pontos de GPS${debugLabel ? ` (${debugLabel})` : ''}` +
        (link ? ` — ${link}` : '')
    )
    return { points: [], reason: 'no-gps-points' }
  }
  return { points: downsample(pts), reason: null }
}

async function parseFIT(arrayBuffer, debugLabel, activityId) {
  let result
  try {
    const fitParser = new FitParser({
      force: true,
      mode: 'list',
      lengthUnit: 'km',
      speedUnit: 'km/h',
      elapsedRecordField: false,
    })
    result = await fitParser.parseAsync(arrayBuffer)
  } catch (e) {
    console.warn(`[activities-heatmap] Falha ao interpretar FIT${debugLabel ? ` (${debugLabel})` : ''}: ${e?.message || e}`)
    return { points: [], reason: 'malformed-fit' }
  }
  const records = result?.records || []
  // fit-file-parser materializes every field per record (heart rate,
  // cadence, power, temperature, etc.), not just position, so a 60h+
  // activity recorded at 1Hz can produce hundreds of thousands of fairly
  // heavy objects. We stride through them the same way as the GPX/TCX fast
  // path so we're not also building an equally huge [lat,lon] array on top
  // of that before downsampling.
  const stride = records.length > HARD_POINT_CAP ? Math.ceil(records.length / HARD_POINT_CAP) : 1
  const pts = []
  for (let i = 0; i < records.length; i += stride) {
    const lat = records[i].position_lat
    const lon = records[i].position_long
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon])
  }
  if (pts.length === 0) {
    // "records" here means data samples in general (one per recorded
    // instant: heart rate, cadence, power, etc.) — not GPS fixes. A FIT
    // file can have hundreds of these and still have zero of them carry a
    // GPS position, which is exactly the indoor/trainer case.
    const link = stravaLink(activityId)
    console.info(
      `[activities-heatmap] FIT válido (${records.length} pontos de dados, nenhum com coordenadas GPS)` +
        `${debugLabel ? ` (${debugLabel})` : ''}` +
        (link ? ` — ${link}` : '')
    )
    return { points: [], reason: 'no-gps-points' }
  }
  return { points: downsample(pts), reason: null }
}

async function extractTrack(zip, filename, pathIndex, activityId) {
  if (!filename) return { points: null, reason: null } // no file at all — not a failure, just no track data expected

  const cleanName = filename.replace(/^\.?\//, '')
  const base = cleanName.split('/').pop()
  let entry = zip.file(cleanName) || pathIndex.get(cleanName) || pathIndex.get(base)
  if (!entry) {
    console.warn(`[activities-heatmap] Ficheiro de track não encontrado no zip: "${filename}"`)
    return { points: null, reason: 'missing-file' }
  }

  let rawBytes
  try {
    rawBytes = new Uint8Array(await entry.async('uint8array'))
  } catch (e) {
    console.warn(`[activities-heatmap] Falha ao ler "${entry.name}" do zip (entrada corrompida?): ${e?.message || e}`)
    return { points: null, reason: 'zip-entry-error' }
  }
  // Kept exactly as found in the zip — this is what eventually gets
  // uploaded to Dropbox as "the original file" (see dropboxFiles.js), so it
  // must never be touched by the parsing below. `bytes`/`name` are a
  // separate, possibly-gunzipped working copy used only to parse points.
  const original = { name: entry.name, bytes: rawBytes }

  let bytes = rawBytes
  let name = entry.name
  if (name.toLowerCase().endsWith('.gz')) {
    try {
      bytes = inflate(bytes)
    } catch (e) {
      console.warn(`[activities-heatmap] Falha ao descomprimir "${name}" (${bytes.length} bytes): ${e?.message || e}`)
      return { points: null, reason: 'gzip-error', original }
    }
    name = name.slice(0, -3)
  }

  const lower = name.toLowerCase()
  try {
    if (lower.endsWith('.gpx')) {
      const { points, reason } = parseGPX(bytesToString(bytes), name, activityId)
      return { points, reason, original }
    } else if (lower.endsWith('.tcx')) {
      const { points, reason } = parseTCX(bytesToString(bytes), name, activityId)
      return { points, reason, original }
    } else if (lower.endsWith('.fit')) {
      const { points, reason } = await parseFIT(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        name,
        activityId
      )
      return { points, reason, original }
    }
    console.warn(`[activities-heatmap] Extensão de ficheiro não reconhecida, a ignorar: "${name}"`)
    return { points: null, reason: 'unrecognized-extension', original }
  } catch (e) {
    console.warn(`[activities-heatmap] Erro inesperado ao processar "${name}": ${e?.message || e}`)
    return { points: null, reason: 'unexpected-exception', original }
  }
}

// Parses already-decompressed bytes of a single original track file (a
// standalone GPX/TCX/FIT file's content, as downloaded from
// dropboxFiles.downloadOriginalFile or read back from originalsStore.js)
// into a latlngs array, or null if it couldn't be read. The same dispatch
// extractTrack() uses above, exposed standalone for trackStore.js's
// on-demand fallback: rebuilding a track from its original file when it
// isn't in the local IndexedDB track cache yet (e.g. right after pulling
// an index from Dropbox on a fresh browser, before any geometry has been
// drawn/cached locally).
export async function parseTrackFileBytes(bytes, nameOrSourceFile, activityId) {
  // originals are stored as "<id>.<ext>.gz" (see dropboxFiles.js) and `bytes`
  // are already gunzipped, so look at the extension underneath the ".gz"
  const lower = (nameOrSourceFile || '').toLowerCase().replace(/\.gz$/, '')
  try {
    if (lower.endsWith('.gpx')) return parseGPX(bytesToString(bytes), nameOrSourceFile, activityId).points
    if (lower.endsWith('.tcx')) return parseTCX(bytesToString(bytes), nameOrSourceFile, activityId).points
    if (lower.endsWith('.fit')) {
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      return (await parseFIT(buf, nameOrSourceFile, activityId)).points
    }
    console.warn(`[activities-heatmap] Extensão de ficheiro original não reconhecida, a ignorar: "${nameOrSourceFile}"`)
  } catch (e) {
    console.warn(`[activities-heatmap] Falha ao reconstruir o track a partir do ficheiro original "${nameOrSourceFile}":`, e)
  }
  return null
}

// Human-readable text for a track-failure reason, in the current language
// (the reason code is what gets stored; the text is looked up when shown).
export function failureLabel(reason) {
  const key = `failure.${reason}`
  const text = t(key)
  return text === key ? reason : text
}

/**
 * Parses a Strava "bulk export" zip file entirely client-side.
 * @param {File} file
 * @param {(info: {done:number,total:number,label:string}) => void} onProgress
 */
export async function parseStravaZip(file, onProgress) {
  onProgress?.({ done: 0, total: 1, label: t('import.openingZip') })
  const zip = await JSZip.loadAsync(file)

  // Index every file by its basename and by suffix-matched path, since the
  // export sometimes nests everything inside an extra top-level folder.
  const pathIndex = new Map()
  zip.forEach((relPath, entry) => {
    if (entry.dir) return
    const base = relPath.split('/').pop()
    if (!pathIndex.has(base)) pathIndex.set(base, entry)
    if (!pathIndex.has(relPath)) pathIndex.set(relPath, entry)
  })

  const csvEntry = [...pathIndex.values()].find((e) => /(^|\/)activities\.csv$/i.test(e.name))
  if (!csvEntry) {
    throw new Error(t('import.noCsv'))
  }

  onProgress?.({ done: 0, total: 1, label: t('import.readingCsv') })
  const csvText = await csvEntry.async('string')
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true })
  const fields = parsed.meta.fields || []
  const headerMap = buildHeaderMap(fields)

  // Safety net for accounts whose export language we don't have aliases for:
  // detect the filename/date columns from their values instead of their
  // (untranslated) header text. Without this, a non-English export would
  // silently resolve every activity's filename/date to null and nothing
  // would show up on the map.
  if (!headerMap.filename) {
    headerMap.filename = detectFilenameColumn(parsed.data, fields)
  }
  if (!headerMap.date) {
    headerMap.date = detectDateColumn(parsed.data, fields, headerMap.filename)
  }
  if (!headerMap.id && fields.length) {
    headerMap.id = fields[0] // "Activity ID" has always been the first column
  }

  const rows = parsed.data
  const total = rows.length
  const activities = []
  // Original FIT/GPX/TCX bytes, kept OUT of the activity objects (see the
  // comment at the push site below) — handed back alongside `activities`
  // for the caller to upload to Dropbox.
  const originalFiles = []

  // Strava's Distance column isn't consistently in meters — some exports
  // give it already in km (observed directly: "48,46" meaning 48.46 km).
  // Rather than assume one or the other, we look at the overall size of the
  // values in this file: km-denominated activities are almost always under
  // a few hundred, while meter-denominated ones are in the thousands. This
  // is decided once from the whole column (median), not per row, so a
  // single unusually short or long activity can't flip the unit by itself.
  const sampleDistances = rows
    .map((row) => toNumber(headerMap.distance ? row[headerMap.distance] : undefined))
    .filter((n) => n != null && n > 0)
    .sort((a, b) => a - b)
  const medianDistance = sampleDistances.length
    ? sampleDistances[Math.floor(sampleDistances.length / 2)]
    : null
  const distanceIsInMeters = medianDistance == null || medianDistance > 300
  const distanceDivisor = distanceIsInMeters ? 1000 : 1

  const BATCH = 25
  let trackFailures = 0
  const failuresByReason = new Map()

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const get = (key) => (headerMap[key] ? row[headerMap[key]] : undefined)

    const distanceRaw = toNumber(get('distance'))
    const movingTime = toNumber(get('movingTime'))
    const elapsedTime = toNumber(get('elapsedTime'))
    const elevationGain = toNumber(get('elevationGain'))
    const avgHr = toNumber(get('avgHr'))
    const filename = (get('filename') || '').trim()
    const type = (get('type') || 'Other').trim() || 'Other'
    const activityName = get('name') || t('edit.unnamed')
    const description = get('description') || ''
    const activityId = get('id') || `row-${i}`
    const dateStr = get('date')
    const date = dateStr ? parseActivityDate(dateStr) : null

    const distanceKm = distanceRaw != null ? distanceRaw / distanceDivisor : null
    const avgSpeedKmh =
      distanceKm != null && movingTime ? (distanceKm / (movingTime / 3600)) : toNumber(get('avgSpeed'))

    let latlngs = null
    let sourceFile = null
    if (filename) {
      const result = await extractTrack(zip, filename, pathIndex, activityId)
      latlngs = result.points
      if (!latlngs || latlngs.length < 2) {
        trackFailures++
        const reason = result.reason || 'unexpected-exception'
        const entry = failuresByReason.get(reason) || { count: 0, examples: [] }
        entry.count++
        if (entry.examples.length < 5) entry.examples.push(activityName)
        failuresByReason.set(reason, entry)
      }
      // The original file (exactly as found in the zip — see extractTrack)
      // is handed back separately, never attached to the activity object
      // itself: it can be tens/hundreds of KB, and the activity objects go
      // straight into the reactive Pinia store, which is exactly the
      // memory problem this app already fixed once for GPS points. The
      // caller (loadFromZip -> commitActivities) uploads these to Dropbox
      // directly from this parallel array instead.
      if (result.original?.bytes?.length) {
        sourceFile = `activities/${activityId}.${baseExtension(result.original.name)}.gz`
        originalFiles.push({
          id: activityId,
          sourceFile,
          name: result.original.name,
          bytes: result.original.bytes,
          // Strava's own export already gzips .fit entries — regzipping
          // those wastes CPU for no size benefit (see dropboxFiles.js).
          alreadyGzipped: result.original.name.toLowerCase().endsWith('.gz'),
        })
      }
    }

    activities.push({
      id: activityId,
      name: activityName,
      description,
      source: 'strava', // came from a Strava bulk-export zip, as opposed to a manually-imported GPX
      type,
      date,
      dateLabel: date && !isNaN(date) ? date.toISOString().slice(0, 10) : '—',
      distanceKm,
      elevationGain,
      movingTime,
      elapsedTime,
      avgHr,
      avgSpeedKmh,
      commute: String(get('commute') || '').toLowerCase() === 'true',
      gear: get('gear') || null,
      workoutType: workoutTypeLabel(parseBoolField(get('workoutRace')), parseBoolField(get('workoutLongRun'))),
      filename: filename || null,
      hasTrack: !!(latlngs && latlngs.length > 1),
      latlngs: latlngs && latlngs.length > 1 ? latlngs : null,
      // Relative path of the original FIT/GPX/TCX file once uploaded to the
      // Dropbox app folder — set here deterministically (id + extension) so
      // it's known before the upload even happens; the upload itself is a
      // best-effort background step (see dropboxFiles.js), so this can
      // point at a file that doesn't exist yet if it fails/hasn't run.
      sourceFile,
    })

    if (i % BATCH === 0) {
      onProgress?.({ done: i, total, label: t('import.processing', { done: i, total }) })
      // yield to the event loop so the UI stays responsive and GC gets a
      // chance to run between batches
      await new Promise((r) => setTimeout(r, 0))
    } else if (movingTime && movingTime > 3 * 3600) {
      // an unusually long activity (multi-hour+) likely just parsed a very
      // large track file — yield here too, even mid-batch, so its memory
      // can be reclaimed before piling into the next one
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  onProgress?.({ done: total, total, label: t('import.done') })
  if (trackFailures > 0) {
    const breakdown = [...failuresByReason.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([reason, { count, examples }]) => {
        const label = failureLabel(reason)
        const sample = examples.length ? ` (ex: ${examples.join(', ')}${count > examples.length ? ', …' : ''})` : ''
        return `  • ${count}x ${label}${sample}`
      })
      .join('\n')
    console.warn(
      `[activities-heatmap] ${trackFailures} de ${total} atividades ficaram sem GPS no mapa. Motivos:\n${breakdown}`
    )
  }
  return {
    activities,
    trackFailures,
    failureBreakdown: [...failuresByReason.entries()].map(([reason, { count, examples }]) => ({
      reason,
      count,
      examples,
    })),
    originalFiles,
  }
}
