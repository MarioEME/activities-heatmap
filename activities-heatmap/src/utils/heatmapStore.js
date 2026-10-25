// "My heatmap": every recorded track aggregated into two derived products,
// recomputed after each import (see scheduleHeatmapRebuild in the activities
// store) and kept in IndexedDB so a reload doesn't have to redo the work.
//
//  1. a density grid — how many DIFFERENT activities went through each cell
//     of ~22 m x ~15 m (a place you pass 50 times is "hotter" than one you
//     passed once; an out-and-back inside one activity counts once);
//  2. a summary route — the union of all tracks with every stretch of road
//     kept only once, as a list of polylines (exportable as a GPX), i.e. one
//     "activity" that covers everywhere you have been.
//
// The Dropbox copy (/heatmap.bin.gz) is the saved version; IndexedDB only
// caches it so the map doesn't wait for a download. Both are derived from the
// tracks, so they can always be rebuilt.

import { openDb, SESSION_STORE } from './db'
import { getStoredTrackIds, getTracks } from './trackStore'
import { gzip, ungzip } from 'pako'

export const CELL = 0.0002 // degrees (~22 m north-south)
const KEY = 'heatmap'
const LON_SPAN = 2_000_000 // > 360 / CELL

let current = null // { sig, li, lo, n, runs, used, built }
let building = null

function hashIds(ids) {
  let h = 5381
  const s = ids.join('|')
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${ids.length}:${h}`
}

const tick = () => new Promise((r) => setTimeout(r, 0))

// ---- binary codec (Dropbox file) ------------------------------------------
// [u32 header length][header JSON][Int32 li][Int32 lo][Uint16 n][Float64 runs...], gzipped
export function encodeHeatmap(d) {
  const header = JSON.stringify({
    v: 1, sig: d.sig, used: d.used, built: d.built, cells: d.n.length, partial: !!d.partial,
    runs: d.runs.map((r) => r.length),
  })
  const hb = new TextEncoder().encode(header)
  const cells = d.n.length
  const align = (x, m) => (x % m ? x + m - (x % m) : x)
  const offLi = align(4 + hb.length, 4)
  const offLo = offLi + cells * 4
  const offN = offLo + cells * 4
  const offRuns = align(offN + cells * 2, 8)
  const runFloats = d.runs.reduce((acc, r) => acc + r.length, 0)
  const buf = new ArrayBuffer(offRuns + runFloats * 8)
  new DataView(buf).setUint32(0, hb.length, true)
  new Uint8Array(buf, 4, hb.length).set(hb)
  new Int32Array(buf, offLi, cells).set(d.li)
  new Int32Array(buf, offLo, cells).set(d.lo)
  new Uint16Array(buf, offN, cells).set(d.n)
  const f = new Float64Array(buf, offRuns, runFloats)
  let o = 0
  for (const r of d.runs) { f.set(r, o); o += r.length }
  return gzip(new Uint8Array(buf))
}

export function decodeHeatmap(bytes) {
  const raw = ungzip(bytes)
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
  const hl = new DataView(buf).getUint32(0, true)
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)))
  let off = 4 + hl
  if (off % 4) off += 4 - (off % 4)
  const c = h.cells
  const li = new Int32Array(buf.slice(off, off + c * 4)); off += c * 4
  const lo = new Int32Array(buf.slice(off, off + c * 4)); off += c * 4
  const n = new Uint16Array(buf.slice(off, off + c * 2)); off += c * 2
  if (off % 8) off += 8 - (off % 8)
  const runs = []
  for (const len of h.runs) { runs.push(new Float64Array(buf.slice(off, off + len * 8))); off += len * 8 }
  return { sig: h.sig, used: h.used, built: h.built, partial: h.partial, li, lo, n, runs }
}

async function readCache() {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const req = db.transaction(SESSION_STORE, 'readonly').objectStore(SESSION_STORE).get(KEY)
      req.onsuccess = () => { db.close(); resolve(req.result || null) }
      req.onerror = () => { db.close(); resolve(null) }
    })
  } catch (e) { return null }
}

let remoteChecked = false

// Current heatmap: memory -> IndexedDB cache; the Dropbox copy (when
// `remote` = { download() } is given) is consulted once per session and wins
// when it is newer than the cache or the cache only has partial data.
export async function loadHeatmap(remote) {
  if (!current) current = await readCache()
  if (remote && !remoteChecked) {
    remoteChecked = true
    try {
      const bytes = await remote.download()
      if (bytes) {
        const r = decodeHeatmap(bytes)
        if (!current || current.partial || (r.built || 0) > (current.built || 0)) {
          current = r
          await persist(r) // refresh the cache
        }
      }
    } catch (e) { remoteChecked = false; console.warn('[activities-heatmap] Heatmap da Dropbox ilegível:', e) }
  }
  return current
}

async function persist(data) {
  try {
    const db = await openDb()
    await new Promise((resolve) => {
      const tx = db.transaction(SESSION_STORE, 'readwrite')
      tx.objectStore(SESSION_STORE).put(data, KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
    })
  } catch (e) { /* best effort */ }
}

export async function clearHeatmap() {
  current = null
  remoteChecked = false
  try {
    const db = await openDb()
    await new Promise((resolve) => {
      const tx = db.transaction(SESSION_STORE, 'readwrite')
      tx.objectStore(SESSION_STORE).delete(KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
    })
  } catch (e) { /* ignore */ }
}

// Pure aggregation over an async source of tracks, exported for testing.
// `batches` yields arrays of latlng arrays ([[lat, lon], ...]).
export async function aggregate(batches) {
  const counts = new Map() // cell key -> number of activities
  const covered = new Set() // cells already present in the summary route
  const runs = []
  let used = 0

  for await (const batch of batches) {
    for (const latlngs of batch) {
      if (!latlngs || latlngs.length < 2) continue
      used++
      const mine = new Set()
      let prevLi = null, prevLo = null
      for (const [lat, lon] of latlngs) {
        const li = Math.floor((lat + 90) / CELL)
        const lo = Math.floor((lon + 180) / CELL)
        if (prevLi === null) {
          mine.add(li * LON_SPAN + lo)
        } else {
          const steps = Math.max(Math.abs(li - prevLi), Math.abs(lo - prevLo))
          if (steps <= 1 || steps > 400) { // adjacent, or a GPS jump: no filling
            mine.add(li * LON_SPAN + lo)
          } else {
            for (let s = 1; s <= steps; s++) {
              mine.add(Math.round(prevLi + ((li - prevLi) * s) / steps) * LON_SPAN
                + Math.round(prevLo + ((lo - prevLo) * s) / steps))
            }
          }
        }
        prevLi = li; prevLo = lo
      }
      for (const k of mine) counts.set(k, (counts.get(k) || 0) + 1)

      // summary route: keep only points that open new ground
      let run = null
      let prev = null
      const fresh = new Set() // cells opened by THIS activity (several points per cell are normal)
      for (const p of latlngs) {
        const k = Math.floor((p[0] + 90) / CELL) * LON_SPAN + Math.floor((p[1] + 180) / CELL)
        if (!covered.has(k) || fresh.has(k)) {
          covered.add(k)
          fresh.add(k)
          if (!run) { run = []; if (prev) run.push(prev[0], prev[1]) } // join to the existing line
          run.push(p[0], p[1])
        } else if (run) {
          run.push(p[0], p[1]) // close the run on the covered point so it connects
          if (run.length >= 4) runs.push(Float64Array.from(run))
          run = null
        }
        prev = p
      }
      if (run && run.length >= 4) runs.push(Float64Array.from(run))
    }
    await tick()
  }

  const size = counts.size
  const li = new Int32Array(size)
  const lo = new Int32Array(size)
  const n = new Uint16Array(size)
  let i = 0
  for (const [k, c] of counts) {
    li[i] = Math.floor(k / LON_SPAN)
    lo[i] = k - li[i] * LON_SPAN
    n[i] = Math.min(c, 65535)
    i++
  }
  return { li, lo, n, runs, used }
}

async function* trackBatches(ids) {
  const SIZE = 150
  for (let i = 0; i < ids.length; i += SIZE) {
    const m = await getTracks(ids.slice(i, i + SIZE))
    yield [...m.values()]
  }
}

// Rebuilds from the tracks stored locally for `activityIds` (activities that
// are not in the bin and have a track). Skips the work when nothing changed.
export function rebuildHeatmap(activityIds, { force = false, remote = null } = {}) {
  if (building) return building
  building = (async () => {
    const stored = await getStoredTrackIds()
    const all = activityIds || []
    const ids = all.filter((id) => stored.has(id)).sort()
    const missing = all.length - ids.length
    // fresh browser: only some years of routes are downloaded yet. Never
    // replace a complete heatmap (cache/Dropbox) with a partial one.
    const complete = missing <= Math.max(3, Math.floor(all.length * 0.01))
    const sig = hashIds(ids)
    const prev = await loadHeatmap(remote)
    if (!force && prev && prev.sig === sig) return prev
    if (!force && !complete && prev) return prev
    const agg = await aggregate(trackBatches(ids))
    current = { sig, ...agg, built: Date.now(), partial: !complete }
    await persist(current) // cache
    if (complete && remote) {
      try { await remote.upload(encodeHeatmap(current)) } catch (e) { console.warn('[activities-heatmap] Falha ao guardar o heatmap na Dropbox:', e) }
    }
    return current
  })().finally(() => { building = null })
  return building
}

export function isBuilding() { return !!building }

export function buildSummaryGpx(data) {
  const segs = data.runs.map((r) => {
    let pts = ''
    for (let i = 0; i < r.length; i += 2) pts += `      <trkpt lat="${r[i].toFixed(5)}" lon="${r[i + 1].toFixed(5)}"></trkpt>\n`
    return `    <trkseg>\n${pts}    </trkseg>\n`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="activities-heatmap" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Heatmap summary</name>
    <time>${new Date(data.built || Date.now()).toISOString()}</time>
${segs}  </trk>
</gpx>
`
}
