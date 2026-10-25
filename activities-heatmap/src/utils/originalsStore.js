// Local cache of each activity's original FIT/GPX/TCX file, keyed by its
// `sourceFile` path (the same path it lives at in the Dropbox app folder —
// see dropboxFiles.js). This is what makes the Dropbox upload genuinely
// optional at import time and retryable afterwards: commitActivities()
// always writes here, signed in or not, exactly like it always writes GPS
// geometry to trackStore.js regardless of sign-in state. If the person
// imports while signed out and connects Dropbox later, the bytes needed to
// backfill the cloud copy are already sitting here — nothing has to be
// re-parsed or re-uploaded from a file the person would otherwise have to
// pick again.
//
// Stored gzip-compressed, the same representation Dropbox holds (see
// uploadOriginalFile) — so a cached entry can be handed straight to
// uploadBytes() without recompressing, and the two copies are always
// byte-for-byte identical.

import { gzip, ungzip } from 'pako'
import { openDb, ORIGINALS_STORE } from './db'

// entries: [{ sourceFile, bytes, alreadyGzipped }]. Anything without a
// sourceFile or bytes is skipped — nothing to cache.
export async function saveOriginals(entries) {
  const list = (entries || []).filter((e) => e && e.sourceFile && e.bytes?.length)
  if (!list.length) return
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(ORIGINALS_STORE, 'readwrite')
    const store = tx.objectStore(ORIGINALS_STORE)
    for (const { sourceFile, bytes, alreadyGzipped } of list) {
      store.put(alreadyGzipped ? bytes : gzip(bytes), sourceFile)
    }
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

// Raw (gzip-compressed) bytes, exactly as stored — ready to upload as-is.
export async function getRawOriginal(sourceFile) {
  if (!sourceFile) return null
  const db = await openDb()
  return new Promise((resolve) => {
    const tx = db.transaction(ORIGINALS_STORE, 'readonly')
    const req = tx.objectStore(ORIGINALS_STORE).get(sourceFile)
    req.onsuccess = () => { db.close(); resolve(req.result || null) }
    req.onerror = () => { db.close(); resolve(null) }
  })
}

// Decompressed bytes, ready to hand to a FIT/GPX/TCX parser.
export async function getOriginal(sourceFile) {
  const raw = await getRawOriginal(sourceFile)
  if (!raw) return null
  try {
    return ungzip(raw)
  } catch (e) {
    console.warn(`[activities-heatmap] Falha ao descomprimir o ficheiro original em cache "${sourceFile}":`, e)
    return null
  }
}

export async function deleteOriginals(sourceFiles) {
  const list = (sourceFiles || []).filter(Boolean)
  if (!list.length) return
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(ORIGINALS_STORE, 'readwrite')
    const store = tx.objectStore(ORIGINALS_STORE)
    for (const sourceFile of list) store.delete(sourceFile)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function clearAllOriginals() {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(ORIGINALS_STORE, 'readwrite')
    tx.objectStore(ORIGINALS_STORE).clear()
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}
