// Persists the parsed session (activities, filters, filename) across visits
// using IndexedDB rather than localStorage. localStorage caps out around
// 5-10MB per origin, which a real Strava export blows past almost
// immediately — a few thousand activities with GPS tracks easily reaches
// tens of MB even after downsampling. IndexedDB's quota is dramatically
// larger (typically a large share of free disk space), and — as a bonus —
// it stores values via the structured clone algorithm, so Date objects
// (activity dates, filter date-range bounds) survive a round trip intact,
// unlike JSON.stringify/parse which would turn them into strings.

import { openDb, SESSION_STORE as STORE_NAME } from './db'

// Activities (the heavy blob: potentially tens of MB of GPS tracks) is
// written once, right after a zip is parsed, and never rewritten again
// until a new upload or a reset. Filters live in a *separate* small record
// so that adjusting a slider or checkbox only ever rewrites a few bytes,
// not the entire dataset.
export async function saveActivities(payload) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ ...payload, savedAt: new Date() }, 'activities')
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function loadActivities() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get('activities')
    req.onsuccess = () => { db.close(); resolve(req.result || null) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function saveFilters(filters) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({ filters, savedAt: new Date() }, 'filters')
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function loadFilters() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get('filters')
    req.onsuccess = () => { db.close(); resolve(req.result?.filters || null) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function clearSession() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.delete('activities')
    store.delete('filters')
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

// Dropbox's refresh token (long-lived) is kept here so the person doesn't
// have to reauthorize on every visit — the same IndexedDB store as
// everything else, just a different key.
export async function saveDropboxAuth(authData) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(authData, 'dropboxAuth')
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function loadDropboxAuth() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get('dropboxAuth')
    req.onsuccess = () => { db.close(); resolve(req.result || null) }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function clearDropboxAuth() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete('dropboxAuth')
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
