// Single shared IndexedDB connection opener, used by both sessionStorage.js
// (the small "session" record: activities metadata snapshot, filters, the
// Dropbox refresh token) and trackStore.js (the potentially large "tracks"
// table: one GPS point array per activity). Centralizing the open() call
// avoids two modules racing to open the same database at two different
// version numbers — IndexedDB throws if you ask to open at a version lower
// than what's already there, so every store that touches this database has
// to agree on one DB_VERSION and one upgrade path.

import { t } from '../i18n'

const DB_NAME = 'activities-heatmap'
const DB_VERSION = 3

export const SESSION_STORE = 'session'
export const TRACKS_STORE = 'tracks'
// Raw bytes of each activity's original FIT/GPX/TCX file (uncompressed,
// exactly as sourced), keyed by sourceFile path — see originalsStore.js.
// Kept locally the same way tracks are, so the data is never only one
// upload away from being gone, and so a Dropbox upload that didn't happen
// yet (signed out at import time, or a failed upload) can be retried later
// from this cache instead of asking the person to re-import anything.
export const ORIGINALS_STORE = 'originals'

export function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error(t('err.noIndexedDb')))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE)
      // Keyed directly by activity id — a track is a single value (the
      // [lat, lon] array) per key, no need for an in-record wrapper.
      if (!db.objectStoreNames.contains(TRACKS_STORE)) db.createObjectStore(TRACKS_STORE)
      if (!db.objectStoreNames.contains(ORIGINALS_STORE)) db.createObjectStore(ORIGINALS_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
