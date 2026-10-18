// Stores each activity's original FIT/GPX/TCX file under /activities/ in
// the Dropbox app folder — the "real" backup this app is built around (see
// the big comment in stores/activities.js): the NDJSON index is just a fast
// summary, but the original file is what makes the data portable and
// lossless, independent of this app ever existing.
//
// Every original is stored gzip-compressed (these formats compress very
// well — FIT already carries .gz on Strava's own export, GPX/TCX compress
// even better being plain XML), named "<id>.<ext>.gz" regardless of
// whether the source was already gzipped, so the naming is predictable and
// a reader always knows to gunzip first.

import { gzip, ungzip } from 'pako'
import { uploadBytes, downloadBytes, deletePath } from './dropboxSync'
import { ORIGINALS_DIR } from '../dropboxConfig'

export function originalFilePath(sourceFile) {
  // sourceFile is stored on the activity as a path relative to the app
  // folder root, e.g. "activities/12345.fit.gz" — Dropbox's API wants an
  // absolute (from the app folder) path, i.e. a leading slash.
  return sourceFile.startsWith('/') ? sourceFile : `/${sourceFile}`
}

// Uploads one activity's original file, gzip-compressing it first unless
// it's already gzipped (Strava's own .fit.gz entries are — regzipping
// already-compressed bytes just wastes CPU for no size benefit).
export async function uploadOriginalFile(accessToken, sourceFile, bytes, { alreadyGzipped = false } = {}) {
  const payload = alreadyGzipped ? bytes : gzip(bytes)
  await uploadBytes(accessToken, originalFilePath(sourceFile), payload)
}

// Downloads and gunzips one activity's original file back to its raw
// (uncompressed) bytes, ready to hand to the FIT/GPX/TCX parser.
export async function downloadOriginalFile(accessToken, sourceFile) {
  const bytes = await downloadBytes(accessToken, originalFilePath(sourceFile))
  if (!bytes) return null
  return ungzip(bytes)
}

export async function deleteOriginalFile(accessToken, sourceFile) {
  await deletePath(accessToken, originalFilePath(sourceFile)).catch(() => {})
}

// Uploads a batch of originals with a small amount of concurrency — fast
// enough for the one-time "import 2600 activities" case without hammering
// Dropbox's API with 2600 simultaneous requests. Best-effort: one file
// failing (network hiccup, rate limit) doesn't stop the rest, and never
// blocks the app from being usable — a missing original just means that
// one activity's map track falls back to whatever's in the local cache
// (see trackStore.js) until it's retried.
//
// `files` is [{ id, sourceFile, bytes, alreadyGzipped }]. onProgress gets
// called after each file (success or failure) with { done, total }.
export async function uploadOriginalFiles(accessToken, files, { concurrency = 4, onProgress } = {}) {
  let done = 0
  const total = files.length
  const failed = []
  let cursor = 0

  async function worker() {
    while (cursor < files.length) {
      const file = files[cursor++]
      try {
        await uploadOriginalFile(accessToken, file.sourceFile, file.bytes, { alreadyGzipped: file.alreadyGzipped })
      } catch (e) {
        console.warn(`[activities-heatmap] Falha ao enviar o ficheiro original de "${file.id}" para a Dropbox:`, e)
        failed.push({ id: file.id, error: e?.message || String(e) })
      }
      done++
      onProgress?.({ done, total })
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, files.length) }, () => worker())
  await Promise.all(workers)
  return { failed }
}
