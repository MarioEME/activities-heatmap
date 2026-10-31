// Keeps the best-efforts data (bestEfforts.js) up to date on its own: whenever
// activities are imported or changed, the ones not calculated yet are read in
// the background. Results live in IndexedDB (cache) and in Dropbox
// (/efforts.json, the copy every device shares).
import { ref, shallowRef } from 'vue'
import { isPaceSport } from './sport'
import { sourceFileExtension } from './gpxExport'
import { EFFORTS_VERSION, computeEfforts, loadEffortsCache, saveEffortsCache } from './bestEfforts'

export const effortsCache = shallowRef({}) // activity id -> { v, d, sf }
export const effortsState = ref({ running: false, done: 0, total: 0 })

export const effortValid = (cache, a) => {
  const e = cache[a.id]
  return !!e && e.v === EFFORTS_VERSION && e.sf === a.sourceFile
}

let stage = 'none' // none | local | remote
let running = false
let again = false
let timer = null
const tick = () => new Promise((r) => setTimeout(r, 0))

async function pushRemote(auth, data) {
  if (auth.status === 'signed-in') await auth.uploadEfforts({ v: EFFORTS_VERSION, byId: data })
}

async function load(auth) {
  if (stage === 'none') {
    effortsCache.value = await loadEffortsCache()
    stage = 'local'
  }
  if (stage === 'local' && auth.status === 'signed-in') {
    const remote = await auth.downloadEfforts()
    if (remote?.byId) {
      const merged = { ...remote.byId, ...effortsCache.value }
      effortsCache.value = merged
      await saveEffortsCache(merged)
      if (Object.keys(merged).length > Object.keys(remote.byId).length) pushRemote(auth, merged)
    }
    stage = 'remote'
  }
}

export function scheduleEfforts(store, auth, delay = 4000) {
  clearTimeout(timer)
  timer = setTimeout(() => run(store, auth), delay)
}

async function run(store, auth) {
  if (running) { again = true; return }
  if (store.status !== 'ready') return
  if (store.syncing) { scheduleEfforts(store, auth, 5000); return } // let an import finish uploading first
  running = true
  try {
    await load(auth)
    do {
      again = false
      const todo = store.activities.filter((a) => a.sourceFile && !effortValid(effortsCache.value, a))
      if (!todo.length) break
      effortsState.value = { running: true, done: 0, total: todo.length }
      const next = { ...effortsCache.value }
      let done = 0
      for (const a of todo) {
        let entry = { v: EFFORTS_VERSION, d: {}, sf: a.sourceFile }
        try {
          if (a.distanceKm == null || a.distanceKm >= 0.1) {
            const bytes = await store.fetchOriginalBytes(a.sourceFile)
            if (bytes) entry = { ...(await computeEfforts(bytes, sourceFileExtension(a.sourceFile), isPaceSport(a.type) ? 12 : 35)), sf: a.sourceFile }
          }
        } catch (e) { /* keep the empty entry so it is not retried forever */ }
        next[a.id] = entry
        done++
        effortsState.value = { running: true, done, total: todo.length }
        if (done % 25 === 0) { effortsCache.value = { ...next }; await saveEffortsCache(next) }
        if (done % 250 === 0) pushRemote(auth, next)
        await new Promise((r) => setTimeout(r, 25)) // leave room for the UI
      }
      effortsCache.value = { ...next }
      await saveEffortsCache(next)
      await pushRemote(auth, next)
    } while (again)
  } finally {
    running = false
    effortsState.value = { running: false, done: 0, total: 0 }
  }
}
