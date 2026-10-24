// Each activity remembers the time zone of the PLACE where it happened
// (`tz`, an IANA name like "Europe/Lisbon"), next to its UTC start instant
// (`date`). Times and calendar days are shown in that zone — the same way
// Strava shows an activity's local start time — not in the zone of whatever
// browser happens to be looking at it. The zone comes from the first GPS
// point (offline lookup, loaded on demand); an activity with no GPS falls
// back to the browser's zone at the time it was imported.

let lookupPromise = null

export function browserTz() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch (e) { return 'UTC' }
}

export function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch (e) { return false }
}

// IANA zone for a coordinate, or null if it can't be determined.
export async function tzFromLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  try {
    lookupPromise = lookupPromise || import('tz-lookup').then((m) => m.default || m)
    const lookup = await lookupPromise
    const tz = lookup(lat, lon)
    return isValidTz(tz) ? tz : null
  } catch (e) {
    lookupPromise = null
    return null
  }
}

// Zone for an activity given its (display) track; the browser's zone if none.
export async function tzForTrack(latlngs) {
  const first = latlngs && latlngs[0]
  return (first && (await tzFromLatLon(first[0], first[1]))) || browserTz()
}

// Zone for an already-stored activity, from its bounding box.
export async function tzForBbox(bbox) {
  if (bbox && [bbox.south, bbox.north, bbox.west, bbox.east].every(Number.isFinite)) {
    const tz = await tzFromLatLon((bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2)
    if (tz) return tz
  }
  return browserTz()
}
