// Dropbox integration: OAuth 2.0 with PKCE (no client secret — this is a
// backend-less browser app, which is exactly what PKCE is designed for),
// and a single JSON file stored in the app's own folder inside the user's
// Dropbox (App folder access — this app can never see anything else in
// their account). Unlike Firestore's 1 MiB per-document limit, Dropbox's
// simple upload endpoint handles files up to 150 MB in one request, so no
// chunking is needed — the whole dataset is just one file.

import { DROPBOX_APP_KEY, getRedirectUri, DATA_FILE_PATH, FILTERS_FILE_PATH, INDEX_FILE_PATH, TRASH_FILE_PATH, META_FILE_PATH, TAGS_FILE_PATH, GEAR_FILE_PATH, TRACKS_FILE_PATH, TRACKS_DIR, dropboxConfigured } from '../dropboxConfig'
import { t } from '../i18n'
import { gzip, ungzip } from 'pako'

export { dropboxConfigured }

const AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize'
const TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token'
const REVOKE_URL = 'https://api.dropboxapi.com/2/auth/token/revoke'
const ACCOUNT_URL = 'https://api.dropboxapi.com/2/users/get_current_account'
const UPLOAD_URL = 'https://content.dropboxapi.com/2/files/upload'
const DOWNLOAD_URL = 'https://content.dropboxapi.com/2/files/download'
const METADATA_URL = 'https://api.dropboxapi.com/2/files/get_metadata'
const DELETE_URL = 'https://api.dropboxapi.com/2/files/delete_v2'

const PKCE_SESSION_KEY = 'dropbox_pkce_verifier'
const STATE_SESSION_KEY = 'dropbox_oauth_state'

// ---- PKCE helpers ----------------------------------------------------------

function randomString(length) {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

function base64url(bytes) {
  let str = btoa(String.fromCharCode(...bytes))
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function codeChallengeFor(verifier) {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return base64url(new Uint8Array(digest))
}

// ---- Auth flow --------------------------------------------------------------

// Kicks off the redirect to Dropbox's consent screen. The verifier and a
// CSRF-guard state value are stashed in sessionStorage so they survive the
// full-page redirect and can be checked when the user comes back.
export async function startAuth() {
  const verifier = randomString(64)
  const state = randomString(32)
  const challenge = await codeChallengeFor(verifier)

  sessionStorage.setItem(PKCE_SESSION_KEY, verifier)
  sessionStorage.setItem(STATE_SESSION_KEY, state)

  const params = new URLSearchParams({
    client_id: DROPBOX_APP_KEY,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    token_access_type: 'offline', // request a refresh token, not just a short-lived access token
    redirect_uri: getRedirectUri(),
    state,
  })
  window.location.href = `${AUTHORIZE_URL}?${params.toString()}`
}

// Call once on app startup. If the URL has an OAuth callback (?code=...),
// completes the token exchange and cleans the URL; otherwise does nothing.
// Returns the new auth data on success, or null if there was no callback
// (the normal case for every visit that isn't returning from Dropbox).
export async function handleRedirectCallback() {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code) return null

  const expectedState = sessionStorage.getItem(STATE_SESSION_KEY)
  const verifier = sessionStorage.getItem(PKCE_SESSION_KEY)
  sessionStorage.removeItem(STATE_SESSION_KEY)
  sessionStorage.removeItem(PKCE_SESSION_KEY)

  // Clean the code/state out of the URL either way, so a page refresh
  // doesn't try to reuse a spent (or forged) authorization code.
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  window.history.replaceState({}, '', url.toString())

  if (!state || state !== expectedState) {
    throw new Error(t('err.badState'))
  }
  if (!verifier) {
    throw new Error(t('err.authExpired'))
  }

  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: DROPBOX_APP_KEY,
    code_verifier: verifier,
    redirect_uri: getRedirectUri(),
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(t('err.codeExchange', { status: res.status }))
  const data = await res.json()

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    accountId: data.account_id,
  }
}

export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: DROPBOX_APP_KEY,
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(t('err.refresh', { status: res.status }))
  const data = await res.json()
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
}

export async function revokeToken(accessToken) {
  try {
    // Dropbox's parameterless RPC-style endpoints (this one included) fail
    // with "could not decode input as JSON" if Content-Type is
    // application/json but the body is empty — they require the literal
    // string "null" as the body, not an omitted/empty one.
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: 'null',
    })
  } catch (e) {
    // Non-fatal — worst case the token just expires naturally later.
    console.warn('[activities-heatmap] Falha ao revogar o token do Dropbox:', e)
  }
}

export async function getCurrentAccount(accessToken) {
  // Same Dropbox quirk as revokeToken: a parameterless RPC endpoint still
  // needs a literal "null" body when Content-Type is application/json,
  // or the server rejects it with "could not decode input as JSON".
  const res = await fetch(ACCOUNT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: 'null',
  })
  if (!res.ok) throw new Error(`Falha ao obter a conta Dropbox (${res.status}).`)
  const data = await res.json()
  return {
    name: data.name?.display_name || data.email,
    email: data.email,
    photoUrl: data.profile_photo_url || null,
  }
}

// ---- Generic file primitives ------------------------------------------------
// Everything below (the NDJSON index, filters, and — in dropboxFiles.js —
// the original FIT/GPX/TCX files) is built on these two: raw bytes in, raw
// bytes out. Keeping them generic means the original-file uploads and the
// index/filters uploads share the exact same HTTP plumbing and error
// handling, instead of each having their own copy.

export async function getFileMeta(accessToken, path = DATA_FILE_PATH) {
  const res = await fetch(METADATA_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (res.status === 409) return null // not_found is reported as a 409 conflict by this endpoint
  if (!res.ok) throw new Error(`Falha ao verificar dados no Dropbox (${res.status}).`)
  return res.json()
}

export async function downloadBytes(accessToken, path) {
  const res = await authedFetch(DOWNLOAD_URL, accessToken, (token) => ({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': JSON.stringify({ path }),
    },
  }))
  if (res.status === 409) return null // not_found
  if (!res.ok) throw new Error(`Falha ao descarregar "${path}" do Dropbox (${await statusDetail(res)}).`)
  const buf = await res.arrayBuffer()
  return new Uint8Array(buf)
}

// Dropbox answers 429 (rate limit) / 5xx under load — common when thousands
// of originals are uploaded in a row. Wait (honouring Retry-After) and try
// again a few times before giving up.
// A 429 pauses EVERY request (not just the one that got it): with several
// uploads in flight, each one retrying on its own just keeps the limit hot.
let pauseUntil = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchWithRetry(url, init, attempts = 8) {
  let res
  for (let i = 0; i < attempts; i++) {
    const wait = pauseUntil - Date.now()
    if (wait > 0) await sleep(wait)
    res = await fetch(url, init)
    if (res.status !== 429 && res.status < 500) return res
    const seconds = Math.min(Number(res.headers.get('Retry-After')) || 2 ** Math.min(i + 1, 5), 60)
    if (res.status === 429) pauseUntil = Math.max(pauseUntil, Date.now() + seconds * 1000)
    else await sleep(seconds * 1000)
  }
  return res
}

// The auth store registers a function that forces a token refresh and
// returns the new access token. A 401 (expired / revoked access token, which
// can happen in the middle of a long batch of uploads) then triggers ONE
// refresh and a retry instead of failing every remaining file.
let onUnauthorized = null
export function setUnauthorizedHandler(fn) { onUnauthorized = fn }

// `accessToken` may be a string or a function returning the current token
// (so a long batch always picks up a refreshed one).
const tokenOf = (tk) => (typeof tk === 'function' ? tk() : tk)

async function authedFetch(url, accessToken, build) {
  let res = await fetchWithRetry(url, build(tokenOf(accessToken)))
  if (res.status === 401 && onUnauthorized) {
    let fresh
    try { fresh = await onUnauthorized() } catch { return res }
    if (fresh) res = await fetchWithRetry(url, build(fresh))
  }
  return res
}

// "401: expired_access_token" etc. — Dropbox says why in the response body.
async function statusDetail(res) {
  let detail = ''
  try {
    const text = await res.text()
    try { detail = JSON.parse(text).error_summary || '' } catch { detail = text.slice(0, 120) }
  } catch { /* no body */ }
  return detail ? `${res.status}: ${detail}` : String(res.status)
}

export async function uploadBytes(accessToken, path, bytes) {
  const res = await authedFetch(UPLOAD_URL, accessToken, (token) => ({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': JSON.stringify({ path, mode: 'overwrite', mute: true }),
    },
    body: bytes,
  }))
  if (!res.ok) throw new Error(`Falha ao guardar "${path}" no Dropbox (${await statusDetail(res)}).`)
  return res.json()
}

export async function deletePath(accessToken, path) {
  const res = await fetch(DELETE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
  if (!res.ok && res.status !== 409) throw new Error(`Falha ao apagar "${path}" no Dropbox (${res.status}).`)
}

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8')

async function downloadText(accessToken, path) {
  const bytes = await downloadBytes(accessToken, path)
  return bytes ? utf8Decoder.decode(bytes) : null
}

async function uploadText(accessToken, path, text) {
  return uploadBytes(accessToken, path, utf8Encoder.encode(text))
}

async function downloadJson(accessToken, path) {
  const text = await downloadText(accessToken, path)
  return text ? JSON.parse(text) : null
}

async function uploadJson(accessToken, path, data) {
  return uploadText(accessToken, path, JSON.stringify(data))
}

// ---- NDJSON index (activities / trash) --------------------------------------
// One JSON object per line, metadata only — no GPS points (see
// stores/activities.js splitTracks/withTracks and dropboxFiles.js for where
// the actual geometry lives). A line each means the file stays legible in
// a plain text editor and a single edit never requires rewriting entries
// that didn't change, unlike one giant JSON array.

function toNdjson(list) {
  return list.map((a) => JSON.stringify(a)).join('\n') + (list.length ? '\n' : '')
}

function fromNdjson(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

export async function downloadIndex(accessToken) {
  const text = await downloadText(accessToken, INDEX_FILE_PATH)
  if (text == null) return null
  return fromNdjson(text).map(reviveActivityDates)
}

export async function uploadIndex(accessToken, activities) {
  return uploadText(accessToken, INDEX_FILE_PATH, toNdjson(activities))
}

export async function downloadTrash(accessToken) {
  const text = await downloadText(accessToken, TRASH_FILE_PATH)
  if (text == null) return null
  return fromNdjson(text).map(reviveActivityDates)
}

export async function uploadTrash(accessToken, trash) {
  return uploadText(accessToken, TRASH_FILE_PATH, toNdjson(trash))
}

// The handful of dataset-level fields that aren't per-activity (so they
// don't belong in the NDJSON index) and aren't filters either — their own
// tiny file, same reasoning as filters.json.
export async function downloadMeta(accessToken) {
  const raw = await downloadJson(accessToken, META_FILE_PATH)
  if (!raw) return null
  return {
    fileName: raw.fileName || '',
    trackFailures: raw.trackFailures || 0,
    failureBreakdown: raw.failureBreakdown || [],
  }
}

export async function uploadMeta(accessToken, { fileName, trackFailures, failureBreakdown }) {
  return uploadJson(accessToken, META_FILE_PATH, { fileName, trackFailures, failureBreakdown })
}

// The tag list ([{ id, name }]) — activities reference tags by id, so
// renaming a tag only rewrites this tiny file, never the whole index.
// Returns null when the file doesn't exist yet (callers fall back to the
// default tags), which is different from an empty list.
export async function downloadTags(accessToken) {
  const raw = await downloadJson(accessToken, TAGS_FILE_PATH)
  return Array.isArray(raw) ? raw : null
}

export async function uploadTags(accessToken, tags) {
  return uploadJson(accessToken, TAGS_FILE_PATH, tags)
}

// Equipment: { items: [{ id, name, aliases, count, distanceKm, movingTime,
// elevationGain, lastUsed }], recalculatedAt, dirty }. Activities reference
// gear by id (gearId), so renaming only rewrites this file. null = no file
// yet (nothing to restore; the list is rebuilt from the activities).
export async function downloadGear(accessToken) {
  const raw = await downloadJson(accessToken, GEAR_FILE_PATH)
  return raw && Array.isArray(raw.items) ? raw : null
}

export async function uploadGear(accessToken, gear) {
  return uploadJson(accessToken, GEAR_FILE_PATH, gear)
}

// Simplified map routes, one file per YEAR of the activity date:
// /tracks/<year>.json.gz (and /tracks/undated.json.gz) holds
// { "<id>": [lat, lon, lat, lon, ...] } with 5 decimals (~1 m). Which file an
// activity lives in follows from its date, which the index already has, so
// no catalogue is needed: a fresh browser works out the years of the
// activities it is about to draw and downloads just those files.
const trackFilePath = (key) => `${TRACKS_DIR}/${key}.json.gz`

export async function trackFileExists(accessToken, key) {
  return !!(await getFileMeta(accessToken, trackFilePath(key)))
}

// -> Map(id -> [[lat, lon], ...]) or null when the file doesn't exist
export async function downloadTrackFile(accessToken, key) {
  const bytes = await downloadBytes(accessToken, trackFilePath(key))
  if (!bytes) return null
  const raw = JSON.parse(utf8Decoder.decode(ungzip(bytes)))
  const out = new Map()
  for (const [id, flat] of Object.entries(raw)) {
    const pts = new Array(flat.length >> 1)
    for (let i = 0; i < pts.length; i++) pts[i] = [flat[2 * i], flat[2 * i + 1]]
    out.set(id, pts)
  }
  return out
}

// tracks: Map(id -> [[lat, lon], ...])
export async function uploadTrackFile(accessToken, key, tracks) {
  const obj = {}
  for (const [id, pts] of tracks) {
    const flat = new Array(pts.length * 2)
    for (let i = 0; i < pts.length; i++) {
      flat[2 * i] = Math.round(pts[i][0] * 1e5) / 1e5
      flat[2 * i + 1] = Math.round(pts[i][1] * 1e5) / 1e5
    }
    obj[id] = flat
  }
  return uploadBytes(accessToken, trackFilePath(key), gzip(utf8Encoder.encode(JSON.stringify(obj))))
}

// Leftovers of earlier formats (single file, chunk manifest); best-effort.
export async function deleteOldTrackFormats(accessToken) {
  await deletePath(accessToken, TRACKS_FILE_PATH).catch(() => {})
  await deletePath(accessToken, `${TRACKS_DIR}/manifest.json`).catch(() => {})
}

// Filters live in their own small file — updated far more often (every
// filter tweak) than the index, so keeping them separate avoids
// re-uploading every activity's metadata just because a checkbox changed.
export async function downloadFilters(accessToken) {
  const raw = await downloadJson(accessToken, FILTERS_FILE_PATH)
  if (!raw) return null
  return reviveFilterDates(raw)
}

export async function uploadFilters(accessToken, filters) {
  return uploadJson(accessToken, FILTERS_FILE_PATH, filters)
}

// ---- Legacy single-blob format (read-only) ----------------------------------
// Pre-NDJSON accounts have one big /activities.json with metadata AND GPS
// points embedded together. Only ever read now, as a one-time migration
// source (see auth.js _reconcileAfterConnect / activities.js) — nothing
// writes this format any more.
export async function downloadLegacyData(accessToken) {
  const raw = await downloadJson(accessToken, DATA_FILE_PATH)
  if (!raw) return null
  return reviveDates(raw)
}

// The aggregated heatmap + summary route (see heatmapStore.js): one gzipped
// binary file, already encoded by the caller.
export const HEATMAP_FILE_PATH = '/heatmap.bin.gz'
export const downloadHeatmapFile = (accessToken) => downloadBytes(accessToken, HEATMAP_FILE_PATH)
export const uploadHeatmapFile = (accessToken, bytes) => uploadBytes(accessToken, HEATMAP_FILE_PATH, bytes)

export async function deleteData(accessToken) {
  for (const path of [HEATMAP_FILE_PATH, DATA_FILE_PATH, FILTERS_FILE_PATH, INDEX_FILE_PATH, TRASH_FILE_PATH, META_FILE_PATH, TAGS_FILE_PATH, GEAR_FILE_PATH, TRACKS_FILE_PATH, TRACKS_DIR]) {
    await deletePath(accessToken, path).catch(() => {}) // best-effort — a path that was never created 404s, which is fine
  }
}

// JSON.stringify turns Date objects into ISO strings; revive the ones we
// know about back into real Date objects on the way back in.
function reviveActivityDates(a) {
  return {
    ...a,
    date: a.date ? new Date(a.date) : null,
    deletedAt: a.deletedAt ? new Date(a.deletedAt) : undefined,
  }
}

function reviveDates(payload) {
  const activities = (payload.activities || []).map(reviveActivityDates)
  const trash = (payload.trash || []).map(reviveActivityDates)
  return {
    activities,
    trash,
    fileName: payload.fileName || '',
    trackFailures: payload.trackFailures || 0,
    failureBreakdown: payload.failureBreakdown || [],
    savedAt: payload.savedAt ? new Date(payload.savedAt) : null,
  }
}

function reviveFilterDates(filters) {
  return {
    ...filters,
    dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : null,
    dateTo: filters.dateTo ? new Date(filters.dateTo) : null,
  }
}
