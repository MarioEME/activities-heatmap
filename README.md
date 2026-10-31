# Activities Heatmap

A 100% client-side web app (Vue 3 + Pinia + Leaflet) that turns your activity
history into an interactive heatmap and a searchable activity list. There is
no backend: everything runs in your browser, and the only optional cloud
component is **your own Dropbox account**.

It started as a way to explore a Strava bulk export, and aims to be an
aggregator you fully control: your data stays in open formats (the original
FIT / GPX / TCX files plus plain-text metadata), readable without this app.

> The UI is available in **European Portuguese (pt-PT)** and **American English (en-US)**.
> Pick the language with the **PT / EN** selector (top bar, and on the first screen).
> It defaults to your browser's language and is remembered between visits.

## Features

**Map**
- All routes overlaid on one map in a single colour of your choice; hover to
  preview, click a route to select it and open the detail panel.
- Four base maps: standard (OpenStreetMap), satellite (Esri), terrain
  (OpenTopoMap) and a neutral gray one so the routes stand out.
- **Detail panel** docked at the bottom of the screen: date, start time,
  distance, elevation, total and moving time, pace/speed, heart rate and tags,
  with edit / remove actions. Next to it (right on desktop, below on mobile)
  an **elevation profile** read from the original file; moving over it marks
  the matching spot on the map. The panel is dismissed by clicking an empty part of the map.
- Download the **original file** (FIT / GPX / TCX) from the panel, or a
  **GPX converted** from FIT / TCX (including heart rate, cadence and
  temperature extensions when present).
- Tracks keep full resolution: every GPS point is imported and only
  near-lossless simplification (Douglas-Peucker, 0.3 m tolerance) is applied.

**Filters**
- Activity type, date range, distance, elevation, speed.
- Tags (match any of the selected tags).
- **Passage area**: draw a rectangle on the map and keep only the activities
  that pass through it.
- Filters are remembered between sessions.

**Activity list, gear, tags, trash**
- Sortable activity table with all the data; edit name, description and tags.
- Equipment tab: your own list of bikes, shoes, etc. Rename items in place,
  add or delete them, and assign one to each activity from the edit dialog.
  Strava's gear data is not imported: only the gear *name* on each activity is
  read once to create the item, and the totals (activities, distance, time,
  elevation gain, last use) are calculated by this app with the **Recalcular**
  button. Activities point to an item by id, so renaming never breaks them.
- Tags tab: add, rename and delete tags. Defaults: *Prova*, *Treino*,
  *Treino longo*, *Deslocação*. Tags are seeded on import from Strava's
  "race" / "long run" / "commute" flags.
- Recycle bin: deleted activities can be restored.

**Languages**
- pt-PT and en-US, switchable at any time. Default tags (Race / Workout / Long run /
  Commute) follow the language unless you renamed them.
- To add a language: copy `src/i18n/en.js` to a new file, translate the values, register it
  in `src/i18n/index.js` (`MESSAGES` and `LOCALES`). Keep the keys identical.

**Data sources**
- Strava bulk export (`.zip`), including its GPX / TCX / FIT files.
- Loose `.gpx` files.
- Importing more data merges with what you already have (keep existing or
  replace overlapping activities).

**Storage**
- Works entirely offline/local first: data is saved in the browser
  (IndexedDB), so it is still there next time you open the app.
- Optional Dropbox sync (see below) so the data survives clearing the browser
  and is available on other devices.

## Quick start

Requirements: Node.js 18 or newer.

```bash
git clone <your-fork-or-this-repo-url>
cd activities-heatmap
npm install
npm run dev        # dev server at http://localhost:5173
```

Open http://localhost:5173, click **Carregar dados** and pick your Strava
export `.zip` (or GPX files).

Other commands:

```bash
npm run build      # production build into dist/ (static files)
npm run preview    # serve the production build locally
```

`dist/` is a plain static site: host it anywhere (GitHub Pages, Netlify,
Vercel, Cloudflare Pages, any static file server). The build uses relative
paths (`base: './'`), so it works from a sub-path too.

### Getting your Strava export

1. On strava.com go to **Settings → My Account**.
2. Under "Download or Delete Your Account" choose **Download Request**.
3. Strava emails you when the `.zip` is ready (it can take hours).
4. The zip contains `activities.csv` and an `activities/` folder with
   `.gpx.gz`, `.tcx.gz` and `.fit.gz` files.

## Dropbox sync (optional)

Without any configuration the app runs purely locally and no Dropbox button
appears. If you clone this repo and want sync, you must register **your own
Dropbox app**: the app key in this repo is a placeholder, and each deployment
should use its own.

### 1. Create the Dropbox app

At https://www.dropbox.com/developers/apps:

1. **Create app** → **Scoped access** → **App folder**
   (not "Full Dropbox": the app will only ever see its own folder).
2. Name it. The name becomes the folder `/Apps/<name>/` in your Dropbox.
3. **Permissions** tab: enable `files.content.read`, `files.content.write`
   and `account_info.read` (the last one only to show your name in the
   navbar), then save.
4. **Settings** tab: copy the **App key**.
5. **Settings → OAuth 2 → Redirect URIs**: add the exact URL(s) the app is
   served from, trailing slash included, e.g.
   - `http://localhost:5173/` for local development
   - your production URL, e.g. `https://<user>.github.io/<repo>/`

### 2. Put the app key in the code

Edit `src/env.js` (the only file meant for keys) and replace the placeholder:

```js
export const DROPBOX_APP_KEY = 'your-app-key-here'
```

The key is not a secret. Login uses OAuth 2.0 **PKCE**, so there is no client
secret anywhere and no backend. A refresh token is stored in the browser so
you stay signed in; revoke it any time in Dropbox → Settings → Connected apps.

Restart `npm run dev` and a **Ligar ao Dropbox** button appears in the navbar.

### What gets stored in your Dropbox

Everything lives in `/Apps/<name>/` and is plain, readable data:

| Path | Content |
| --- | --- |
| `index.ndjson` | One JSON object per line with each activity's metadata (no GPS points): name, date, type, distance, times, gear id (`gearId`), tags, `sourceFile`. |
| `tracks/<year>.json.gz` | The simplified map routes, one file per year of the activity date (`undated` for activities without one). The year comes from the index, so a new browser downloads only the years it needs to draw the latest activities and fetches the rest in the background. The originals in `activities/` are only used for export (and as a fallback for routes missing here). |
| `activities/<id>.<ext>.gz` | The **original** FIT / GPX / TCX file, gzipped. This is the source of truth for the GPS track. |
| `trash.ndjson` | Activities in the recycle bin, same format as the index. |
| `tags.json` | The tag list: `[{ "id": "prova", "name": "Prova" }, ...]`. |
| `gear.json` | The equipment list: names (and previous names, so re-imports still match renamed items) plus the totals from the last recalculation. |
| `filters.json` | Your last filter settings. |
| `meta.json` | Small bookkeeping: imported file name, track-parsing failures. |
| `activities.json` | Legacy single-file format. Only read, once, to migrate older accounts; never written. |

GPS geometry is not stored in the index: it is rebuilt from the original files
and cached locally (IndexedDB) for speed. On a new device, tracks are
rebuilt on demand from the originals in Dropbox.

### How syncing behaves

- On connect, the app compares local and cloud data. If both have data, a
  dialog asks which to keep (choosing to log out there leaves your local data
  untouched).
- Imports upload the original files first, then the index, trash, tags and
  metadata. Changing only a filter rewrites just `filters.json`.
- **sair** (sign out) revokes the Dropbox token and wipes the local copy from
  the browser; the files in Dropbox are left alone, and signing in again
  restores everything from them.
- To start over, delete the contents of `/Apps/<name>/` in Dropbox (and clear
  the site data in your browser), then re-import.

### Dropbox testing status

The PKCE flow is checked against the RFC 7636 test vector and the app is
exercised end to end without Dropbox configured. A full run against a real
Dropbox account is the part you should verify yourself after setting it up:

- [ ] "Ligar ao Dropbox" redirects to Dropbox and returns to the app.
- [ ] After an import, `index.ndjson`, `tags.json`, `filters.json`, `meta.json`
      and `activities/` appear in the app folder.
- [ ] Closing and reopening the app keeps you signed in.
- [ ] A second browser with different local data shows the conflict dialog.
- [ ] Downloading the original file from the detail panel works after the track cache is
      cleared (it is fetched from Dropbox).

## How it works

- **JSZip** reads the export `.zip` in the browser; **PapaParse** parses
  `activities.csv`.
- **pako** gunzips the track files. GPX and TCX are parsed with the native
  `DOMParser`; FIT with **fit-file-parser**.
- Routes are drawn with **Leaflet** on a `<canvas>` so thousands of activities
  stay smooth.
- **Pinia** holds only metadata. GPS geometry and the original files are kept
  in IndexedDB with an in-memory LRU for the tracks being drawn.
- A passage-area query uses a bounding box per activity first, then the real
  geometry.

Main folders: `src/i18n` (translations), `src/stores` (state and sync logic), `src/utils` (parsers, GPX
export/conversion, Dropbox client, IndexedDB), `src/views` and
`src/components` (UI).

## Known limitations

- Very large `.fit` files (e.g. ultra-distance, per-second recording) can take
  a few seconds to parse; parsing runs in batches to keep the UI responsive
  but is single-threaded.
- CSV column mapping covers the standard Strava header names (English and
  Portuguese). For other languages, add aliases to `FIELD_ALIASES` in
  `src/utils/zipParser.js`.
- Strava export timestamps carry no timezone; the panel's date is the UTC date
  while the start time is shown in your local time.
- The elevation profile needs the original file (available for anything
  imported with the current version) and an activity with altitude data.
- The map tile providers (OpenStreetMap, Esri, OpenTopoMap) are third-party
  services subject to their own usage policies; check them before deploying
  publicly with heavy traffic.
- Not included: badges, photos, explored-tiles overlays, heatmap video export.


## Time zones

Each activity stores its UTC start (`date`) and the IANA time zone of the place it happened (`tz`, found offline from the first GPS point with `tz-lookup`, loaded on demand). Start times and the calendar day are shown in that zone, like Strava does; activities without GPS use the zone of the browser that imported them. Run `npm install` after pulling (new dependency).

## Heatmap agregado e rota resumo

O botão da chama, na barra lateral do mapa, mostra o **heatmap de todas as atividades**: cada
célula (~22 m) é colorida pelo número de atividades que passaram nela (escala logarítmica,
do roxo ao amarelo). Ao ativá-lo as rotas individuais são escondidas (há uma opção para as
mostrar por cima) e aparece a opção **Exportar GPX resumo**: uma única "atividade" que cobre
todos os sítios onde já estiveste, cada troço só uma vez.

Ambos são recalculados depois de cada importação (e quando o conjunto de atividades muda) e
guardados na Dropbox em `/heatmap.bin.gz` (ficheiro binário comprimido). O IndexedDB do browser
é só uma cache: num browser novo o heatmap vem da Dropbox, sem esperar pelo carregamento de todos
os percursos. Um cálculo parcial (browser novo com poucos anos de rotas já carregados) nunca
substitui um heatmap completo. O heatmap usa todas as atividades com GPS, independentemente dos
filtros ativos.

O ícone da app está em `public/favicon.svg` (os PNG de `public/` foram gerados a partir dele).

## Import folder (Dropbox)

Drop `.gpx`, `.fit`, `.tcx` or Strava `.zip` files into the `import` folder of the app's Dropbox folder (`Apps/<app>/import`, created automatically). Each time you open the app signed in, they are imported (activities that already exist are kept) and moved to `import/done`. Files that fail stay in `import`.

**Metadata sidecar.** A `<name>.json` next to `<name>.fit|gpx|tcx` (same base name) is read together with it and then moved to `import/done`. All fields are optional: `name`, `description`, `type` (e.g. `Run`), `gear` (name; created if new), `tags` (names; created if new), `commute` (boolean). If the activity already exists, nothing is changed.

**Strava → app.** `tools/strava-to-explorer.user.js` is a userscript (Violentmonkey/Tampermonkey, Firefox) that adds a button on a Strava activity page: it downloads the original file and uploads it with the sidecar to `/import`. Put the same Dropbox app key as `src/env.js` in `APP_KEY`; the first use asks you to authorize Dropbox once.

## Statistics tab

- **Best times by distance** (100 m … 50 km): computed on demand from each activity's original file (timed GPS points, best sliding window, pauses and GPS jumps ignored). Press *Calculate*; only activities not yet calculated are read, and results are cached in IndexedDB. Filtered by sport.
- **Kilometres per activity + running total** over time, following the active filters.
