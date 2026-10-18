// Owns GPS track geometry (the a.latlngs point arrays) for every activity,
// kept deliberately OUT of the Pinia store. With a few thousand activities,
// holding every track's full point array in memory at once — even without
// Vue's reactivity overhead — is the bulk of the app's memory footprint,
// and almost none of it is ever needed at the same time: filters (recent
// limit, date range, search...) usually narrow what's actually drawn down
// to a fraction of the total dataset.
//
// So the Pinia activities store only ever holds lightweight metadata (name,
// date, distance, a small bounding box, a `sourceFile` pointer, etc. — see
// splitTracks() in stores/activities.js). The actual point arrays live
// here:
//   - persisted in IndexedDB, so they survive a reload/pull exactly like
//     everything else — this cache never round-trips through Dropbox as
//     JSON any more (see dropboxFiles.js): the real backup is each
//     activity's original FIT/GPX/TCX file, and this cache is rebuildable
//     from that original (see getTracks()'s fallback, once Task #4 wires
//     it in) rather than being the backup itself;
//   - mirrored in a small in-memory LRU cache, so repeatedly drawing the
//     same filtered set of activities doesn't mean repeatedly hitting
//     IndexedDB.

import { openDb, TRACKS_STORE } from './db'

// Generous headroom over any reasonable "activities currently shown on the
// map" count (the default filter already caps that at a few hundred), while
// staying far below "the whole multi-thousand-activity dataset".
const CACHE_LIMIT = 1500
const cache = new Map()

function cacheGet(id) {
  if (!cache.has(id)) return undefined
  const v = cache.get(id)
  // Re-insert so Map's iteration order keeps "most recently used" last —
  // turns the plain Map into a cheap LRU without extra bookkeeping.
  cache.delete(id)
  cache.set(id, v)
  return v
}

function cacheSet(id, latlngs) {
  if (cache.has(id)) cache.delete(id)
  cache.set(id, latlngs)
  while (cache.size > CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value
    cache.delete(oldestKey)
  }
}

// entries: [{ id, latlngs }]. Activities without a track are skipped —
// nothing to store.
export async function saveTracks(entries) {
  const withTracks = (entries || []).filter((e) => e && e.latlngs && e.latlngs.length)
  if (!withTracks.length) return
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(TRACKS_STORE, 'readwrite')
    const store = tx.objectStore(TRACKS_STORE)
    for (const { id, latlngs } of withTracks) {
      store.put(latlngs, id)
      cacheSet(id, latlngs)
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

// Returns a Map(id -> latlngs) for exactly the ids asked for — anything
// without a stored track (or not found) is simply absent from the result,
// never a rejected promise, so one missing track never breaks a batch draw.
export async function getTracks(ids) {
  const result = new Map()
  const missing = []
  for (const id of ids || []) {
    const hit = cacheGet(id)
    if (hit) result.set(id, hit)
    else missing.push(id)
  }
  if (!missing.length) return result

  const db = await openDb()
  await new Promise((resolve) => {
    const tx = db.transaction(TRACKS_STORE, 'readonly')
    const store = tx.objectStore(TRACKS_STORE)
    let remaining = missing.length
    const done = () => { if (--remaining === 0) { db.close(); resolve() } }
    for (const id of missing) {
      const req = store.get(id)
      req.onsuccess = () => {
        if (req.result) {
          result.set(id, req.result)
          cacheSet(id, req.result)
        }
        done()
      }
      req.onerror = () => done()
    }
  })
  return result
}

export async function deleteTracks(ids) {
  if (!ids || !ids.length) return
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(TRACKS_STORE, 'readwrite')
    const store = tx.objectStore(TRACKS_STORE)
    for (const id of ids) {
      store.delete(id)
      cache.delete(id)
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function clearAllTracks() {
  cache.clear()
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(TRACKS_STORE, 'readwrite')
    tx.objectStore(TRACKS_STORE).clear()
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
