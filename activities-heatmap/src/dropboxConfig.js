// Dropbox setup. This app works fully offline/local (IndexedDB) without
// Dropbox configured at all — cloud sync is an optional layer on top, and
// the data lives in the USER'S OWN Dropbox account (in an app-only folder
// only this app can see), not in any infrastructure controlled by whoever
// deployed this site.
//
// TO ENABLE CLOUD SYNC, put your own Dropbox app's key in src/env.js
// (DROPBOX_APP_KEY). That value is safe to commit/embed in client code —
// it identifies the app, it is not a secret. This uses the OAuth 2.0 PKCE
// flow (no client secret involved at all, by design — it's meant for
// exactly this kind of backend-less browser app).
//
// Setup checklist (all done at https://www.dropbox.com/developers/apps):
//   1. Create app → "Scoped access" → "App folder" (NOT "Full Dropbox" —
//      App folder means this app only ever sees its own folder inside the
//      user's Dropbox, nothing else).
//   2. Give it a name — this becomes the folder name under /Apps/ in the
//      user's Dropbox.
//   3. Permissions tab → enable files.content.write, files.content.read
//      and account_info.read.
//   4. Settings tab → copy the "App key" → paste it into src/env.js.
//   5. Settings tab → "OAuth 2" → Redirect URIs → add the exact URL(s)
//      this app is served from (e.g. http://localhost:5173/ for local dev,
//      and your GitHub Pages URL for production). Must match exactly,
//      including trailing slash.

import { DROPBOX_APP_KEY as APP_KEY } from './env'

export const dropboxConfigured = !!APP_KEY && APP_KEY !== 'REPLACE_ME'
export const DROPBOX_APP_KEY = APP_KEY

// Where Dropbox redirects back to after the user approves access. Using
// the app's own current URL (minus any query string) keeps this working
// regardless of where it's deployed, as long as that exact URL is also
// registered in the Dropbox app's settings.
export function getRedirectUri() {
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  return url.toString()
}

const DATA_FILE_PATH = '/activities.json' // legacy single-blob format (metadata + embedded GPS points) — still read for migration, never written any more
const FILTERS_FILE_PATH = '/filters.json' // kept separate so a filter tweak doesn't re-upload the whole index
// The current format: a lightweight metadata "index" (no GPS points — those
// live in the original FIT/GPX/TCX files under /activities/, see
// dropboxFiles.js), one JSON object per line (NDJSON) so it stays plain,
// human-readable text even with thousands of entries.
const INDEX_FILE_PATH = '/index.ndjson'
const TRASH_FILE_PATH = '/trash.ndjson'
const META_FILE_PATH = '/meta.json' // tiny file: { fileName, trackFailures, failureBreakdown } — the bits that don't belong per-activity
const TAGS_FILE_PATH = '/tags.json' // the list of tags (id + name) activities can be labelled with
const GEAR_FILE_PATH = '/gear.json' // equipment list: names + the last recalculated totals (see activities.js)
const TRACKS_FILE_PATH = '/tracks.json.gz' // OLD single-file format, only deleted now
const TRACKS_DIR = '/tracks' // routes in chunks: /tracks/manifest.json + /tracks/<n>.json.gz (250 activities each, oldest first)
const _unused_tracks_comment = '/tracks.json.gz' // simplified map routes of every activity in ONE gzipped file (fast to restore; originals are only for export)
const ORIGINALS_DIR = '/activities' // original source files: /activities/<id>.<ext>.gz
export { DATA_FILE_PATH, FILTERS_FILE_PATH, INDEX_FILE_PATH, TRASH_FILE_PATH, META_FILE_PATH, TAGS_FILE_PATH, GEAR_FILE_PATH, TRACKS_FILE_PATH, TRACKS_DIR, ORIGINALS_DIR }
