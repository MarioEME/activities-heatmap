// Best efforts ("melhores tempos") per distance, computed from the timed GPS
// points of an activity's original file, plus a small IndexedDB cache so each
// activity is only read once.
import { readSegments } from './elevationProfile'
import { openDb, SESSION_STORE } from './db'

export const EFFORT_DISTANCES = [
  { key: '100', m: 100, label: '100 m' },
  { key: '200', m: 200, label: '200 m' },
  { key: '400', m: 400, label: '400 m' },
  { key: '1000', m: 1000, label: '1 km' },
  { key: '5000', m: 5000, label: '5 km' },
  { key: '10000', m: 10000, label: '10 km' },
  { key: '21098', m: 21097.5, label: '21,1 km' },
  { key: '42195', m: 42195, label: '42,2 km' },
  { key: '50000', m: 50000, label: '50 km' },
]
export const EFFORTS_VERSION = 1

const R = 6371008.8
function hav(a, b) {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
}

// Best time (seconds) for each target distance, or {} when the file has no
// usable timestamps. Gaps > 60 s between points (pauses) break the effort, and impossible speeds (GPS jumps) are discarded.
//   vmax: fastest believable speed in m/s (about 12 for running, 35 otherwise)
export async function computeEfforts(bytes, ext, vmax = 12) {
  const segments = await readSegments(bytes, ext)
  if (!segments) return { v: EFFORTS_VERSION, d: {} }
  const xs = [0]
  const ts = [0]
  let prev = null
  let prevT = null
  for (const seg of segments) {
    prev = null
    prevT = null
    for (const p of seg) {
      const tm = p.time ? Date.parse(p.time) / 1000 : NaN
      if (!Number.isFinite(tm)) { prev = null; continue }
      if (prev) {
        const dt = tm - prevT
        if (dt <= 0) continue
        if (dt > 60) { prev = p; prevT = tm; continue } // paused / signal lost: no distance, no time
        const dd = hav(prev, p)
        if (dd / dt > vmax * 1.6) continue // GPS glitch
        xs.push(xs[xs.length - 1] + dd)
        ts.push(ts[ts.length - 1] + dt)
      }
      prev = p
      prevT = tm
    }
  }
  const total = xs[xs.length - 1]
  const d = {}
  for (const { key, m } of EFFORT_DISTANCES) {
    if (total < m) continue
    let best = Infinity
    let i = 0
    for (let j = 1; j < xs.length; j++) {
      const target = xs[j] - m
      if (target < 0) continue
      while (i + 1 < j && xs[i + 1] <= target) i++
      const span = xs[i + 1] - xs[i]
      const f = span > 0 ? (target - xs[i]) / span : 0
      const tStart = ts[i] + f * (ts[i + 1] - ts[i])
      const time = ts[j] - tStart
      if (time > 0 && m / time <= vmax && time < best) best = time
    }
    if (Number.isFinite(best)) d[key] = Math.round(best * 10) / 10
  }
  return { v: EFFORTS_VERSION, d }
}

// --- cache (IndexedDB "session" store, key "efforts"): { [activityId]: { v, d } } ---
const KEY = 'efforts'
export async function loadEffortsCache() {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const req = db.transaction(SESSION_STORE, 'readonly').objectStore(SESSION_STORE).get(KEY)
      req.onsuccess = () => { db.close(); resolve(req.result || {}) }
      req.onerror = () => { db.close(); resolve({}) }
    })
  } catch (e) { return {} }
}
export async function saveEffortsCache(cache) {
  try {
    const db = await openDb()
    await new Promise((resolve) => {
      const tx = db.transaction(SESSION_STORE, 'readwrite')
      tx.objectStore(SESSION_STORE).put(cache, KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
    })
  } catch (e) { /* cache only */ }
}
export async function clearEffortsCache() { await saveEffortsCache({}) }
