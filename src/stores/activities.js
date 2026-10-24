import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { parseStravaZip, parseTrackFileBytes } from '../utils/zipParser'
import { clearSession } from '../utils/sessionStorage'
import { saveTracks, getTracks, getStoredTrackIds, clearAllTracks } from '../utils/trackStore'
import { saveOriginals, getOriginal, getRawOriginal, clearAllOriginals } from '../utils/originalsStore'
import { useAuthStore } from './auth'
import { t } from '../i18n'
import ptMsgs from '../i18n/pt'
import enMsgs from '../i18n/en'

const TYPE_COLORS = {
  // cycling
  Ride: '#C98A3E', VirtualRide: '#C98A3E', GravelRide: '#B4563E', MountainBikeRide: '#B4563E',
  EMountainBikeRide: '#B4563E', EBikeRide: '#C98A3E', Velomobile: '#C98A3E', Handcycle: '#C98A3E',
  // running
  Run: '#4FA8A0', TrailRun: '#4FA8A0', VirtualRun: '#4FA8A0',
  // walking / hiking
  Walk: '#8FAE7A', Hike: '#8FAE7A', Snowshoe: '#8FAE7A',
  // water
  Swim: '#6C87B7', Kayaking: '#6C87B7', Canoeing: '#6C87B7', Rowing: '#6C87B7', VirtualRow: '#6C87B7',
  StandUpPaddling: '#6C87B7', Surfing: '#6C87B7', Kitesurf: '#6C87B7', Windsurf: '#6C87B7', Sail: '#6C87B7',
  // snow
  AlpineSki: '#9B7FD4', BackcountrySki: '#9B7FD4', NordicSki: '#9B7FD4', Snowboard: '#9B7FD4',
  RollerSki: '#9B7FD4', IceSkate: '#9B7FD4',
  // gym / fitness
  Workout: '#A6763F', WeightTraining: '#A6763F', Yoga: '#A6763F', Pilates: '#A6763F', Crossfit: '#A6763F',
  HighIntensityIntervalTraining: '#A6763F', StairStepper: '#A6763F', Elliptical: '#A6763F',
  // racquet / ball / field sports
  Tennis: '#C2578F', Badminton: '#C2578F', Squash: '#C2578F', TableTennis: '#C2578F',
  Pickleball: '#C2578F', Racquetball: '#C2578F', Soccer: '#C2578F', Golf: '#C2578F',
  // other wheels / climbing
  Skateboard: '#D3A036', InlineSkate: '#D3A036', RockClimbing: '#D3A036', Wheelchair: '#D3A036',
}

// Fallback for activity types we don't recognise (including translated CSV
// values) — a saturated, mid-lightness hue derived from the name itself, so
// it stays distinct and never fades into the light basemap or its grey
// roads/borders the way a flat grey default would.
function hashColor(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 58%, 42%)`
}

export function colorForType(type) {
  if (type && TYPE_COLORS[type]) return TYPE_COLORS[type]
  if (!type) return '#7A5C8F'
  return hashColor(type)
}

// Tags an activity can be labelled with. Activities reference tags by id
// (so renaming a tag never touches the activities index); the list itself
// lives in tags.json on Dropbox. These four are the defaults — everything
// else is added/renamed/removed by the person in the "Tags" tab.
const DEFAULT_TAG_IDS = ['prova', 'treino', 'treino-longo', 'deslocacao']

// The default tags are named in the current language when they are created.
function defaultTagDefs() {
  return DEFAULT_TAG_IDS.map((id) => ({ id, name: t(`tags.default.${id}`) }))
}

// True when `name` is the stock name of default tag `id` in ANY language, i.e.
// the person never renamed it (so it is safe to translate when they switch).
function isStockTagName(id, name) {
  return [ptMsgs, enMsgs].some((m) => m.tags.default[id] === name)
}

// Starting tags for an activity that has none recorded yet, taken from what
// the source already said: Strava's own Competição / Corrida longa flags
// (kept on workoutType) and its Deslocação (commute) flag. Strava has no
// plain "workout" flag, so "Treino" is only ever set by hand.
function deriveTags(a) {
  const tags = []
  if (a.workoutType === 'Prova') tags.push('prova')
  if (a.workoutType === 'Treino longo') tags.push('treino-longo')
  if (a.commute) tags.push('deslocacao')
  return tags
}

function ensureTags(list) {
  return (list || []).map((a) => (Array.isArray(a.tags) ? a : { ...a, tags: deriveTags(a) }))
}

// --- Equipment ("gear") ---------------------------------------------------
// Equipment is this app's own concept, not Strava's: the list lives in
// gear.json on Dropbox ({ items, recalculatedAt, dirty }) and activities
// point at a piece of gear by id (gearId), so it can be renamed freely.
// Strava's export only says which gear NAME an activity used — that string
// (a.gear) is read once, when an activity first enters the app, to find or
// create the matching item (see _mapGear); Strava's own processed gear data
// is not imported. Totals per item are computed from the activities by
// recalculateGear() (the "Recalcular" button), never taken from Strava.
function cleanGearName(name) {
  return String(name || '').trim().slice(0, 60)
}
function sameName(a, b) {
  return cleanGearName(a).toLowerCase() === cleanGearName(b).toLowerCase()
}
function newGearId() {
  return `g-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
function blankGear(name) {
  return { id: newGearId(), name, aliases: [], count: null, distanceKm: null, movingTime: null, elevationGain: null, lastUsed: null }
}
// gear.json -> in-memory items (lastUsed back to a Date)
function reviveGearItems(raw) {
  return (raw?.items || []).map((g) => ({
    id: g.id,
    name: cleanGearName(g.name) || t('edit.unnamed'),
    aliases: Array.isArray(g.aliases) ? [...g.aliases] : [],
    count: g.count ?? null,
    distanceKm: g.distanceKm ?? null,
    movingTime: g.movingTime ?? null,
    elevationGain: g.elevationGain ?? null,
    lastUsed: g.lastUsed ? new Date(g.lastUsed) : null,
  }))
}

// Climb per km (m/km): positive elevation gain divided by distance (1000 m
// of climbing over 20 km = 50 m/km). A "how hilly is the route" measure, not
// a slope: descents and flats count in the distance too. Computed on the fly
// from fields every activity already has, so it also works for data imported
// before this filter existed. null = can't be computed.
export function climbPerKm(a) {
  if (!a || a.elevationGain == null || !(a.distanceKm > 0)) return null
  return a.elevationGain / a.distanceKm
}

function emptyFilters() {
  return {
    types: [], // empty = all types
    tags: [], // tag ids; empty = no tag filter, otherwise an activity needs at least one of them
    search: '',
    dateFrom: null,
    dateTo: null,
    distanceMin: 0,
    distanceMax: null,
    elevationMin: 0,
    elevationMax: null,
    speedMin: 0,
    speedMax: null,
    climbMin: 0, // climb per km (m/km): positive elevation gain / distance, see climbPerKm
    climbMax: null,
    passageBox: null, // { south, west, north, east } — rectangle drawn on the map
    recentLimit: null, // null = no limit; number = keep only the N most recent (after other filters)
  }
}

// The sensible starting point: only the 500 most recent activities, so a
// multi-year export with thousands of routes doesn't dump everything onto
// the map at once. The person can raise/clear this from the filter panel.
function defaultFilters() {
  return { ...emptyFilters(), recentLimit: 500 }
}

// Rebuilds a filters object from plain values/spreads, guaranteeing it's
// free of Vue reactivity proxies (which IndexedDB's structured clone
// algorithm can't handle) regardless of whether it was read through a
// reactive store. Date objects pass through untouched — Vue's reactive()
// deliberately never wraps built-ins like Date, so they're already safe.
export function toPlainFilters(f) {
  return {
    types: [...f.types],
    // f.tags may be absent on filters saved before tags existed (an older
    // Dropbox/bridge snapshot) — default to "no tag filter".
    tags: [...(f.tags || [])],
    search: f.search,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    distanceMin: f.distanceMin,
    distanceMax: f.distanceMax,
    elevationMin: f.elevationMin,
    elevationMax: f.elevationMax,
    speedMin: f.speedMin,
    speedMax: f.speedMax,
    // absent on filters saved before this filter existed
    climbMin: f.climbMin ?? 0,
    climbMax: f.climbMax ?? null,
    passageBox: f.passageBox ? { ...f.passageBox } : null,
    recentLimit: f.recentLimit,
  }
}

// --- Keeping GPS geometry out of the reactive store ------------------------
//
// a.latlngs (the actual GPS points) is, by far, the heaviest part of the
// dataset — thousands of [lat, lon] pairs per activity, times thousands of
// activities. Earlier this just lived on each activity object in the store,
// which meant it was ALL in memory, ALL the time, no matter what the
// filters showed. That's what was chewing through ~1GB with ~2600
// activities.
//
// Now the store only ever holds lightweight metadata — never a.latlngs.
// The actual point arrays live in trackStore.js (IndexedDB + a small LRU
// cache), and are fetched on demand only for the activities that are
// actually about to be drawn (see HeatmapView's draw()). splitTracks()
// below is the one place that peels latlngs off an activity before it
// enters the store.
//
// Dropbox sync itself never carries geometry at all any more: the index
// (index.ndjson/trash.ndjson) is metadata only, and the actual lossless
// backup is each activity's original FIT/GPX/TCX file, uploaded separately
// (see originalsStore.js locally and dropboxFiles.js on the cloud side).
// splitTracks() is only still needed for freshly-parsed data (which still
// carries latlngs, straight from the parser) and for the one-time
// migration of pre-existing accounts away from the old single-blob format
// (see restoreFromLegacyBridge below), which also still embeds geometry.

function computeBbox(latlngs) {
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity
  for (let i = 0; i < latlngs.length; i++) {
    const [lat, lon] = latlngs[i]
    if (lat < south) south = lat
    if (lat > north) north = lat
    if (lon < west) west = lon
    if (lon > east) east = lon
  }
  return { south, west, north, east }
}

function bboxOverlaps(b, box) {
  if (!b) return false
  return b.south <= box.north && b.north >= box.south && b.west <= box.east && b.east >= box.west
}

// Splits a full activities array (as freshly parsed, or as downloaded from
// Dropbox / restored from the pre-redirect bridge — both still carry
// latlngs) into plain metadata (what the store keeps) and track entries
// (what trackStore.js persists). A small bounding box is computed once here
// and kept on the metadata, so passage-area filtering (below) can cheaply
// rule out most activities without needing their actual geometry.
function splitTracks(activities) {
  const metas = []
  const trackEntries = []
  for (const a of activities || []) {
    if (a.hasTrack && a.latlngs && a.latlngs.length) {
      trackEntries.push({ id: a.id, latlngs: a.latlngs })
      const { latlngs, ...meta } = a
      metas.push({ ...meta, bbox: a.bbox || computeBbox(a.latlngs) })
    } else {
      const { latlngs, ...meta } = a
      metas.push(meta)
    }
  }
  return { metas, trackEntries }
}

function trackIntersectsBox(latlngs, box) {
  for (let i = 0; i < latlngs.length; i++) {
    const [lat, lon] = latlngs[i]
    if (lat >= box.south && lat <= box.north && lon >= box.west && lon <= box.east) return true
  }
  return false
}

// Routes are backed up one file per UTC year of the activity date (see dropboxSync.js).
const yearKey = (a) => (a.date && !isNaN(a.date) ? String(new Date(a.date).getUTCFullYear()) : 'undated')

export const useActivitiesStore = defineStore('activities', {
  state: () => ({
    status: 'idle', // idle | parsing | ready | error
    progress: { done: 0, total: 0, label: '' },
    errorMessage: '',
    activities: [],
    filters: emptyFilters(),
    fileName: '',
    trackFailures: 0, // count of activities whose GPS file couldn't be parsed
    failureBreakdown: [], // [{reason, label, count, examples}] — why each one failed
    drawingArea: false, // transient UI flag: true while the user is dragging a rectangle on the map
    filtersOpen: false, // whether the filter side panel is visible
    sourcePickerOpen: false, // whether the "choose a data source" popup is visible
    restoredAt: null, // when the current data was saved, if loaded from a previous visit
    persistError: '', // soft warning if saving/restoring the session locally fails
    cloudSyncError: '', // soft warning if syncing to Firestore fails (only relevant when signed in)
    uploadProgress: null, // { done, total } while original files are being copied to Dropbox
    routeColor: '#E31B0C', // vivid red — color used to draw every route on the heatmap, user-adjustable via a color picker
    tagDefs: defaultTagDefs(), // [{ id, name }] — see DEFAULT_TAGS
    gearDefs: [], // equipment: [{ id, name, aliases, count, distanceKm, movingTime, elevationGain, lastUsed }] — see "Equipment" above
    gearMeta: { recalculatedAt: null, dirty: false }, // dirty = activities changed since the totals were last calculated
    trash: [], // removed activities, kept (not hard-deleted) so they can be restored — synced to Dropbox the same way activities are
    // Precise "área de passagem" matches, recomputed async whenever the
    // drawn box changes (see recomputePassageBoxMatches) — null means "no
    // box is active" (filter not applied) rather than "no matches yet"; use
    // passageBoxLoading to tell those two apart while a box is active.
    passageBoxMatches: null,
    passageBoxLoading: false,
    focusRequest: null, // { id } — asks the Heatmap tab to show + select one activity (see focusOnMap)
  }),

  getters: {
    isReady: (s) => s.status === 'ready' && s.activities.length > 0,

    availableTypes: (s) => {
      const counts = new Map()
      for (const a of s.activities) counts.set(a.type, (counts.get(a.type) || 0) + 1)
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count }))
    },

    // Every tag with how many activities carry it, in list order — what
    // the filter panel shows.
    availableTags: (s) => {
      const counts = new Map()
      for (const a of s.activities) for (const t of a.tags || []) counts.set(t, (counts.get(t) || 0) + 1)
      return s.tagDefs.map((t) => ({ ...t, count: counts.get(t.id) || 0 }))
    },

    dataBounds: (s) => {
      let distanceMax = 0
      let elevationMax = 0
      let speedMax = 0
      let climbMax = 0
      let minDate = null
      let maxDate = null
      for (const a of s.activities) {
        if (a.distanceKm != null) distanceMax = Math.max(distanceMax, a.distanceKm)
        if (a.elevationGain != null) elevationMax = Math.max(elevationMax, a.elevationGain)
        if (a.avgSpeedKmh != null) speedMax = Math.max(speedMax, a.avgSpeedKmh)
        const c = climbPerKm(a)
        if (c != null) climbMax = Math.max(climbMax, c)
        if (a.date && !isNaN(a.date)) {
          if (!minDate || a.date < minDate) minDate = a.date
          if (!maxDate || a.date > maxDate) maxDate = a.date
        }
      }
      return {
        distanceMax: Math.ceil(distanceMax),
        elevationMax: Math.ceil(elevationMax / 50) * 50,
        speedMax: Math.ceil(speedMax),
        // capped so one bad GPS/altitude reading can't stretch the slider
        climbMax: Math.min(150, Math.ceil(climbMax / 5) * 5),
        minDate,
        maxDate,
      }
    },

    // Equipment rows for the "Equipamento" tab. Totals are the snapshot from
    // the last recalculateGear() (null = never calculated). "Inativo" is a
    // heuristic, not real Strava data: gear whose most recent activity is
    // older than 365 days. Gear with no activities (or not yet calculated)
    // counts as active so a freshly added item is never hidden.
    gearRows: (s) => {
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - 365)
      return s.gearDefs
        .map((g) => ({ ...g, active: !g.lastUsed || g.lastUsed >= cutoff }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },

    filtered: (s) => {
      const f = s.filters
      const search = f.search.trim().toLowerCase()
      const list = s.activities.filter((a) => {
        if (f.types.length && !f.types.includes(a.type)) return false
        if (f.tags.length && !(a.tags || []).some((t) => f.tags.includes(t))) return false
        if (search && !a.name.toLowerCase().includes(search)) return false
        if (f.dateFrom && (!a.date || a.date < f.dateFrom)) return false
        if (f.dateTo && (!a.date || a.date > f.dateTo)) return false
        if (a.distanceKm != null) {
          if (f.distanceMin && a.distanceKm < f.distanceMin) return false
          if (f.distanceMax != null && a.distanceKm > f.distanceMax) return false
        }
        if (a.elevationGain != null) {
          if (f.elevationMin && a.elevationGain < f.elevationMin) return false
          if (f.elevationMax != null && a.elevationGain > f.elevationMax) return false
        }
        if (a.avgSpeedKmh != null) {
          if (f.speedMin && a.avgSpeedKmh < f.speedMin) return false
          if (f.speedMax != null && a.avgSpeedKmh > f.speedMax) return false
        }
        const c = climbPerKm(a)
        if (c != null) {
          if (f.climbMin && c < f.climbMin) return false
          if (f.climbMax != null && c > f.climbMax) return false
        }
        if (f.passageBox) {
          // Precise matches are computed async (geometry isn't kept in
          // memory for the whole dataset any more — see
          // recomputePassageBoxMatches). While that's in flight, or for
          // anything it hasn't confirmed, the activity is excluded rather
          // than guessed at.
          if (!a.hasTrack || !s.passageBoxMatches || !s.passageBoxMatches.has(a.id)) return false
        }
        return true
      })

      if (f.recentLimit == null || list.length <= f.recentLimit) return list

      // Keep the N most recent (by date). Undated activities sort last,
      // so they're the first to be dropped when trimming down to N.
      return [...list]
        .sort((a, b) => {
          const at = a.date && !isNaN(a.date) ? a.date.getTime() : -Infinity
          const bt = b.date && !isNaN(b.date) ? b.date.getTime() : -Infinity
          return bt - at
        })
        .slice(0, f.recentLimit)
    },

    filteredStats() {
      const list = this.filtered
      let distance = 0
      let elevation = 0
      let movingTime = 0
      let withGps = 0
      for (const a of list) {
        distance += a.distanceKm || 0
        elevation += a.elevationGain || 0
        movingTime += a.movingTime || 0
        if (a.hasTrack) withGps++
      }
      return { count: list.length, distance, elevation, movingTime, withGps }
    },

    activeFilterCount: (s) => {
      const f = s.filters
      const d = emptyFilters()
      let n = 0
      if (f.types.length) n++
      if (f.tags.length) n++
      if (f.search.trim()) n++
      if (f.dateFrom || f.dateTo) n++
      if (f.distanceMin !== d.distanceMin || f.distanceMax !== d.distanceMax) n++
      if (f.elevationMin !== d.elevationMin || f.elevationMax !== d.elevationMax) n++
      if (f.speedMin !== d.speedMin || f.speedMax !== d.speedMax) n++
      if (f.climbMin !== d.climbMin || f.climbMax !== d.climbMax) n++
      if (f.passageBox) n++
      if (f.recentLimit != null) n++
      return n
    },
  },

  actions: {
    // Commits an already-parsed activities array as the current dataset.
    // Per the agreed flow, persistence is all-or-nothing on Dropbox: while
    // signed in, every commit is pushed straight to Dropbox; while signed
    // out, nothing is written to any local store at all — the data only
    // lives in memory for the rest of this visit (see signIn() in the auth
    // store for the one exception: a short-lived "bridge" snapshot taken
    // right before a fresh Dropbox connect, so in-progress work survives
    // the OAuth redirect).
    async commitActivities({ activities, fileName, trackFailures, failureBreakdown, resetFiltersToDefault, originalFiles }) {
      // Defensive: toRaw() is a no-op on an already-plain array, but strips
      // Pinia's reactive Proxy wrapper if a caller passed one by mistake —
      // IndexedDB's structured clone (and, less predictably, some other
      // serialization boundaries) can't handle a live reactive Proxy.
      activities = toRaw(activities)
      failureBreakdown = toRaw(failureBreakdown || [])
      originalFiles = toRaw(originalFiles || [])

      // activities still has latlngs at this point (fresh from the
      // parser) — split it before it ever reaches the reactive store, and
      // persist the geometry separately.
      const { metas, trackEntries } = splitTracks(activities)
      await saveTracks(trackEntries)
      // Same idea for the original FIT/GPX/TCX bytes: always cached locally,
      // signed in or not, so a Dropbox connect made later can still back
      // this import up without asking the person to re-import anything.
      await saveOriginals(originalFiles)

      const filters = resetFiltersToDefault ? defaultFilters() : toPlainFilters(this.filters)
      this.activities = this._mapGear(ensureTags(metas))
      if (this.activities.some((a) => a.gearId)) this.gearMeta.dirty = true // new data: totals need recalculating
      this.fileName = fileName
      this.trackFailures = trackFailures
      this.failureBreakdown = failureBreakdown || []
      if (resetFiltersToDefault) this.filters = filters
      this.status = 'ready'
      this.restoredAt = null
      if (this.filters.passageBox) await this.recomputePassageBoxMatches()

      const authStore = useAuthStore()
      if (authStore.status === 'signed-in') {
        await this._syncToCloud({ originalFiles })
        if (trackEntries.length) this.scheduleTracksSnapshot(trackEntries.map((e) => e.id))
        try {
          await authStore.syncFilters(filters)
        } catch (e) { /* surfaced via cloudSyncError already */ }
      }
    },

    // Shared tail for every path that needs to push the current in-memory
    // dataset to Dropbox: the metadata-only index/trash/meta files always
    // (cheap, every commit/edit), plus any freshly-introduced original
    // files (only when there are some — most edits don't add new ones).
    async _syncToCloud({ originalFiles } = {}) {
      const authStore = useAuthStore()
      try {
        // The small metadata files go FIRST: as soon as index.ndjson is in
        // Dropbox the dataset can be restored from any tab/device. The
        // original files can be thousands and take minutes — uploading them
        // first meant that reloading mid-upload left Dropbox with originals
        // but no index, i.e. "my data is there but the app shows nothing".
        await authStore.syncCurrentData({
          activities: toRaw(this.activities),
          trash: toRaw(this.trash),
          fileName: this.fileName,
          trackFailures: this.trackFailures,
          failureBreakdown: toRaw(this.failureBreakdown),
        })
        await authStore.syncTags(this.tagDefs.map((t) => ({ ...t })))
        await authStore.syncGear(this.gearSnapshot())
        this.cloudSyncError = ''
      } catch (e) {
        this.cloudSyncError = t('err.saveCloud')
      }
      if (originalFiles?.length) {
        this.uploadProgress = { done: 0, total: originalFiles.length }
        try {
          const { failed } = await authStore.uploadOriginals(originalFiles, (p) => { this.uploadProgress = { ...p } })
          if (failed?.length) this.cloudSyncError = t('err.originalsFailed', { n: failed.length }, failed.length)
        } finally {
          this.uploadProgress = null
        }
      }
    },

    // Edits an activity's title/description in place (the only fields the
    // person can hand-edit here — everything else came from the source
    // file). Re-syncs to Dropbox the same way a fresh import does, since
    // this changes the committed dataset just as much as a merge would.
    async updateActivity(id, { name, description, tags, gearId }) {
      const idx = this.activities.findIndex((a) => a.id === id)
      if (idx === -1) return
      const current = this.activities[idx]
      // undefined = leave as is; null/'' = no equipment. Only ids that exist count.
      let nextGear = current.gearId ?? null
      if (gearId !== undefined) nextGear = gearId && this.gearDefs.some((g) => g.id === gearId) ? gearId : null
      if (nextGear !== (current.gearId ?? null)) this.gearMeta.dirty = true
      this.activities[idx] = {
        ...current,
        name: name != null ? name : current.name,
        description: description != null ? description : current.description,
        tags: Array.isArray(tags) ? [...tags] : current.tags,
        gearId: nextGear,
      }
      await this._syncAfterLocalEdit()
    },

    // "Removes" an activity by moving it into the recycle bin (this.trash)
    // rather than deleting it outright — recoverable from the "Reciclagem"
    // tab until the person restores it (there's no hard-delete anywhere
    // in the UI yet).
    async removeActivity(id) {
      const idx = this.activities.findIndex((a) => a.id === id)
      if (idx === -1) return
      const [removed] = this.activities.splice(idx, 1)
      if (removed.gearId) this.gearMeta.dirty = true
      this.trash.unshift({ ...removed, deletedAt: new Date() })
      await this._syncAfterLocalEdit()
    },

    async restoreActivity(id) {
      const idx = this.trash.findIndex((a) => a.id === id)
      if (idx === -1) return
      const [restored] = this.trash.splice(idx, 1)
      const { deletedAt, ...activity } = restored
      if (activity.gearId) this.gearMeta.dirty = true
      this.activities.push(activity)
      await this._syncAfterLocalEdit()
    },

    // --- Tag list management (the "Tags" tab) ---------------------------
    // Only the list changes here, so only tags.json is rewritten — except
    // deleteTag, which also strips the tag off activities.

    async _syncTagList() {
      const authStore = useAuthStore()
      if (authStore.status !== 'signed-in') return
      try {
        await authStore.syncTags(this.tagDefs.map((t) => ({ ...t })))
        this.cloudSyncError = ''
      } catch (e) {
        this.cloudSyncError = t('err.saveTags')
      }
    },

    // Returns the new tag, or the existing one if a tag with that name
    // (ignoring case) is already there, or null for an empty name.
    async addTag(name) {
      const clean = String(name || '').trim().slice(0, 40)
      if (!clean) return null
      const existing = this.tagDefs.find((t) => t.name.toLowerCase() === clean.toLowerCase())
      if (existing) return existing
      const tag = { id: `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: clean }
      this.tagDefs.push(tag)
      await this._syncTagList()
      return tag
    },

    // Returns false when the name is empty or already used by another tag.
    async renameTag(id, name) {
      const clean = String(name || '').trim().slice(0, 40)
      const tag = this.tagDefs.find((t) => t.id === id)
      if (!tag || !clean) return false
      if (this.tagDefs.some((t) => t.id !== id && t.name.toLowerCase() === clean.toLowerCase())) return false
      if (tag.name === clean) return true
      tag.name = clean
      await this._syncTagList()
      return true
    },

    // Called when the language changes: default tags the person never renamed
    // follow the new language; anything they renamed or created is left alone.
    async localizeDefaultTags() {
      let changed = false
      for (const tag of this.tagDefs) {
        if (!DEFAULT_TAG_IDS.includes(tag.id) || !isStockTagName(tag.id, tag.name)) continue
        const next = t(`tags.default.${tag.id}`)
        if (tag.name !== next) { tag.name = next; changed = true }
      }
      if (changed) await this._syncTagList()
    },

    async deleteTag(id) {
      const idx = this.tagDefs.findIndex((t) => t.id === id)
      if (idx === -1) return
      this.tagDefs.splice(idx, 1)
      const strip = (list) => {
        for (let i = 0; i < list.length; i++) {
          if (list[i].tags?.includes(id)) list[i] = { ...list[i], tags: list[i].tags.filter((t) => t !== id) }
        }
      }
      strip(this.activities)
      strip(this.trash)
      this.filters.tags = this.filters.tags.filter((t) => t !== id)
      // activities changed too, so this is a full sync (it uploads tags.json as well)
      await this._syncAfterLocalEdit()
    },

    // --- Equipment management (the "Equipamento" tab) --------------------

    // Plain, serializable copy of the equipment state (gear.json's shape).
    gearSnapshot() {
      return {
        items: this.gearDefs.map((g) => ({
          id: g.id,
          name: g.name,
          aliases: [...(g.aliases || [])],
          count: g.count,
          distanceKm: g.distanceKm,
          movingTime: g.movingTime,
          elevationGain: g.elevationGain,
          lastUsed: g.lastUsed ? new Date(g.lastUsed).toISOString() : null,
        })),
        recalculatedAt: this.gearMeta.recalculatedAt,
        dirty: !!this.gearMeta.dirty,
      }
    },

    _loadGear(raw) {
      this.gearDefs = reviveGearItems(raw)
      this.gearMeta = { recalculatedAt: raw?.recalculatedAt || null, dirty: !!raw?.dirty }
    },

    // Gives every activity a gearId. An activity that still carries Strava's
    // gear NAME (a.gear, from a fresh import or from data saved before gear
    // became its own list) is matched to an existing item by its name or by a
    // name it used to have (aliases — so renaming an item doesn't make the next
    // import create a duplicate); an unseen name creates a new item. The
    // Strava string is dropped afterwards: from then on gearId is the truth.
    _mapGear(list) {
      let created = false
      const out = (list || []).map((a) => {
        if (a.gearId !== undefined && !('gear' in a)) return a
        const { gear, ...rest } = a
        if (a.gearId !== undefined) return rest
        const name = cleanGearName(gear)
        if (!name) return { ...rest, gearId: null }
        let def = this.gearDefs.find((g) => sameName(g.name, name) || (g.aliases || []).some((x) => sameName(x, name)))
        if (!def) {
          def = blankGear(name)
          this.gearDefs.push(def)
          created = true
        }
        return { ...rest, gearId: def.id }
      })
      if (created) this.gearMeta.dirty = true
      return out
    },

    async _syncGearList() {
      const authStore = useAuthStore()
      if (authStore.status !== 'signed-in') return
      try {
        await authStore.syncGear(this.gearSnapshot())
        this.cloudSyncError = ''
      } catch (e) {
        this.cloudSyncError = t('err.saveGear')
      }
    },

    // Totals per item, computed from the activities currently in the app
    // (not the recycle bin) — the "Recalcular" button.
    async recalculateGear() {
      const stats = new Map(this.gearDefs.map((g) => [g.id, { count: 0, distanceKm: 0, movingTime: 0, elevationGain: 0, lastUsed: null }]))
      for (const a of this.activities) {
        const st = a.gearId ? stats.get(a.gearId) : null
        if (!st) continue
        st.count++
        st.distanceKm += a.distanceKm || 0
        st.movingTime += a.movingTime || 0
        st.elevationGain += a.elevationGain || 0
        if (a.date && !isNaN(a.date) && (!st.lastUsed || a.date > st.lastUsed)) st.lastUsed = a.date
      }
      for (const g of this.gearDefs) Object.assign(g, stats.get(g.id))
      this.gearMeta.recalculatedAt = new Date().toISOString()
      this.gearMeta.dirty = false
      await this._syncGearList()
    },

    // Returns the new item, the existing one if the name is already taken
    // (ignoring case), or null for an empty name.
    async addGear(name) {
      const clean = cleanGearName(name)
      if (!clean) return null
      const existing = this.gearDefs.find((g) => sameName(g.name, clean))
      if (existing) return existing
      const def = { ...blankGear(clean), count: 0, distanceKm: 0, movingTime: 0, elevationGain: 0 }
      this.gearDefs.push(def)
      await this._syncGearList()
      return def
    },

    // Returns false when the name is empty or used by another item. The old
    // name is remembered as an alias so a later Strava import still maps to
    // this item.
    async renameGear(id, name) {
      const clean = cleanGearName(name)
      const def = this.gearDefs.find((g) => g.id === id)
      if (!def || !clean) return false
      if (this.gearDefs.some((g) => g.id !== id && sameName(g.name, clean))) return false
      if (def.name === clean) return true
      if (!def.aliases.some((x) => sameName(x, def.name))) def.aliases.push(def.name)
      def.aliases = def.aliases.filter((x) => !sameName(x, clean))
      def.name = clean
      await this._syncGearList()
      return true
    },

    // The activities keep existing — they just lose this equipment.
    async deleteGear(id) {
      const idx = this.gearDefs.findIndex((g) => g.id === id)
      if (idx === -1) return
      this.gearDefs.splice(idx, 1)
      const strip = (list) => {
        for (let i = 0; i < list.length; i++) {
          if (list[i].gearId === id) list[i] = { ...list[i], gearId: null }
        }
      }
      strip(this.activities)
      strip(this.trash)
      this.gearMeta.dirty = true
      await this._syncAfterLocalEdit() // activities changed too → full sync (includes gear.json)
    },

    // Shared tail for updateActivity/removeActivity/restoreActivity: push
    // the edited in-memory array (activities AND trash — both are part of
    // the same synced dataset) to Dropbox when signed in, same as
    // commitActivities.
    async _syncAfterLocalEdit() {
      const authStore = useAuthStore()
      if (authStore.status !== 'signed-in') return
      await this._syncToCloud()
    },

    // Used by the auth store to drop cloud- or local-bridge-sourced data
    // straight into the store without re-triggering a sync back to
    // Dropbox (it either came from there, or is about to be pushed there
    // explicitly by the caller). Both sources (the current-format
    // index/trash download, and the local pre-redirect bridge snapshot)
    // are already metadata-only — nothing to split, geometry is fetched
    // on demand from trackStore.js/the original file exactly as it is for
    // any other activity.
    async restoreFromBridge({ activities, fileName, trackFailures, failureBreakdown, filters, trash, tagDefs, gear }) {
      this._loadGear(toRaw(gear)) // before mapping, so Strava names match existing items
      this.activities = this._mapGear(ensureTags(toRaw(activities)))
      this.trash = this._mapGear(ensureTags(toRaw(trash)))
      // null/undefined = no tags.json yet (fresh or older account): use the defaults
      this.tagDefs = Array.isArray(tagDefs) ? tagDefs.map((t) => ({ id: t.id, name: t.name })) : defaultTagDefs()
      this.fileName = fileName || ''
      this.trackFailures = trackFailures || 0
      this.failureBreakdown = toRaw(failureBreakdown) || []
      this.filters = filters ? toPlainFilters(filters) : defaultFilters()
      this.status = 'ready'
      this.restoredAt = null
      this.persistError = ''
      this.cloudSyncError = ''
      if (this.filters.passageBox) await this.recomputePassageBoxMatches()
      else this.passageBoxMatches = null
    },

    // One-time migration path: an account that connected before the
    // NDJSON-index/original-files format existed only has the old single
    // blob, with geometry still embedded. Split it exactly like a fresh
    // import would, then immediately re-upload in the new shape so this
    // path is never needed again for this account. The legacy blob never
    // carried original FIT/GPX/TCX files, so `sourceFile` stays unset on
    // these activities — see the "attach originals from export.zip"
    // backfill flow for recovering those separately.
    async restoreFromLegacyBridge({ activities, fileName, trackFailures, failureBreakdown, filters, trash, tagDefs, gear }) {
      const act = splitTracks(toRaw(activities) || [])
      const tr = splitTracks(toRaw(trash) || [])
      await saveTracks([...act.trackEntries, ...tr.trackEntries])
      this._loadGear(toRaw(gear))
      this.activities = this._mapGear(ensureTags(act.metas))
      this.trash = this._mapGear(ensureTags(tr.metas))
      this.tagDefs = Array.isArray(tagDefs) ? tagDefs.map((t) => ({ id: t.id, name: t.name })) : defaultTagDefs()
      this.fileName = fileName || ''
      this.trackFailures = trackFailures || 0
      this.failureBreakdown = toRaw(failureBreakdown) || []
      this.filters = filters ? toPlainFilters(filters) : defaultFilters()
      this.status = 'ready'
      this.restoredAt = null
      this.persistError = ''
      this.cloudSyncError = ''
      if (this.filters.passageBox) await this.recomputePassageBoxMatches()
      else this.passageBoxMatches = null

      const authStore = useAuthStore()
      if (authStore.status === 'signed-in') await this._syncToCloud()
    },

    // Reads back every cached original (signed-out imports still save to
    // originalsStore.js — see commitActivities) for the activities/trash
    // listed, and uploads whichever ones Dropbox doesn't have yet. Used
    // once, right after resolving the "cloud empty, keep my pending local
    // data" conflict, so connecting Dropbox later never leaves an import
    // without its lossless backup just because the person wasn't signed in
    // when they first imported it.
    async uploadCachedOriginals() {
      const authStore = useAuthStore()
      if (authStore.status !== 'signed-in') return
      const withSource = [...this.activities, ...this.trash].filter((a) => a.sourceFile)
      if (!withSource.length) return
      const files = []
      for (const a of withSource) {
        const bytes = await getRawOriginal(a.sourceFile)
        if (bytes) files.push({ id: a.id, sourceFile: a.sourceFile, bytes, alreadyGzipped: true })
      }
      if (files.length) await authStore.uploadOriginals(files)
    },

    // Recomputes exactly which activities pass through the drawn
    // "área de passagem" rectangle. Geometry isn't kept in memory for the
    // whole dataset, so this runs in two stages: a cheap, synchronous
    // bounding-box overlap check (using the small bbox already stored on
    // each activity's metadata) narrows the field, then only THOSE
    // candidates' actual point arrays are fetched to confirm a real
    // intersection — so even this precise check never needs more than a
    // fraction of the dataset's geometry in memory at once.
    async recomputePassageBoxMatches() {
      const box = this.filters.passageBox
      if (!box) {
        this.passageBoxMatches = null
        return
      }
      this.passageBoxLoading = true
      try {
        const candidates = this.activities.filter((a) => a.hasTrack && bboxOverlaps(a.bbox, box))
        const tracks = await this.resolveTracks(candidates.map((a) => a.id))
        const matches = new Set()
        for (const a of candidates) {
          const latlngs = tracks.get(a.id)
          if (latlngs && trackIntersectsBox(latlngs, box)) matches.add(a.id)
        }
        this.passageBoxMatches = matches
      } finally {
        this.passageBoxLoading = false
      }
    },

    // The one place anything (HeatmapView's draw(), recomputePassageBoxMatches
    // above) should go to get geometry for a batch of activities. Checks the
    // local IndexedDB track cache first (trackStore.js) exactly like a plain
    // getTracks() call; for anything still missing, falls back to that
    // activity's original file — the local cache (originalsStore.js) first,
    // then Dropbox itself if signed in — reparses it, and backfills
    // trackStore.js so the next call for the same activity is a cache hit
    // again. This is what makes the local track cache truly rebuildable
    // rather than a single point of failure: a fresh browser that only
    // pulled the Dropbox index (no geometry cached yet anywhere locally)
    // can still draw/filter by geometry, recovered on demand from the same
    // lossless original file Dropbox already holds.
    async resolveTracks(ids) {
      const found = await getTracks(ids)
      let missing = (ids || []).filter((id) => !found.has(id))
      if (!missing.length) return found

      // 1) Routes are backed up in Dropbox one file per year: fetch only the
      // years that hold what we need (far faster than the originals).
      await this._loadRemoteTrackYears(missing)
      const again = await getTracks(missing)
      for (const [id, v] of again) found.set(id, v)
      missing = missing.filter((id) => !found.has(id))
      this._prefetchOtherYears()
      if (!missing.length) return found

      // 2) Whatever is still missing is rebuilt from its original file, a few
      // at a time. Slow, so it only happens for activities not in the file;
      // afterwards the routes file is refreshed so it never repeats.
      const byId = new Map(this.activities.map((a) => [a.id, a]))
      const toSave = []
      let cursor = 0
      const worker = async () => {
        while (cursor < missing.length) {
          const id = missing[cursor++]
          const a = byId.get(id)
          if (!a?.sourceFile) continue
          const bytes = await this.fetchOriginalBytes(a.sourceFile)
          if (!bytes) continue
          const latlngs = await parseTrackFileBytes(bytes, a.sourceFile, id)
          if (!latlngs || !latlngs.length) continue
          found.set(id, latlngs)
          toSave.push({ id, latlngs })
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, missing.length) }, worker))
      if (toSave.length) {
        await saveTracks(toSave)
        this.scheduleTracksSnapshot(toSave.map((e) => e.id))
      }
      return found
    },

    // Downloads (once per year per session) the year files holding the given
    // ids, newest year first, and stores every route in them that isn't
    // cached locally yet.
    async _loadRemoteTrackYears(ids, concurrency = 3) {
      const authStore = useAuthStore()
      if (!authStore._accessToken || !ids.length) return
      const byId = new Map([...this.activities, ...this.trash].map((a) => [String(a.id), a]))
      const years = [...new Set(ids.map((id) => byId.get(String(id))).filter(Boolean).map(yearKey))]
        .sort((x, y) => (y === 'undated') - (x === 'undated') || y.localeCompare(x))
      this._yearJobs = this._yearJobs || new Map()
      const todo = years.filter((y) => !this._yearJobs.has(y))
      let cursor = 0
      const worker = async () => {
        while (cursor < todo.length) {
          const y = todo[cursor++]
          const job = (async () => {
            const file = await authStore.downloadTrackFile(y)
            if (!file) { this._yearJobs.delete(y); return }
            const have = await getStoredTrackIds()
            const entries = []
            for (const [rid, latlngs] of file) {
              const a = byId.get(rid)
              if (a && !have.has(a.id) && latlngs.length) entries.push({ id: a.id, latlngs })
            }
            if (entries.length) await saveTracks(entries)
          })()
          this._yearJobs.set(y, job)
          await job
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker))
      await Promise.all(years.map((y) => this._yearJobs.get(y)).filter(Boolean)) // years another call already started
    },

    // Once the map is showing, quietly fetch the remaining years in the
    // background (one at a time, newest first) so later filter changes are
    // instant instead of waiting on the network.
    _prefetchOtherYears() {
      if (this._prefetching) return
      this._prefetching = true
      setTimeout(async () => {
        try {
          const authStore = useAuthStore()
          if (!authStore._accessToken) return
          const stored = await getStoredTrackIds()
          const lacking = [...this.activities, ...this.trash].filter((a) => a.hasTrack && !stored.has(a.id))
          const years = [...new Set(lacking.map(yearKey))].sort((x, y) => y.localeCompare(x))
          for (const y of years) {
            const ids = lacking.filter((a) => yearKey(a) === y).map((a) => a.id)
            await this._loadRemoteTrackYears(ids, 1)
          }
        } catch (e) { /* best effort */ } finally { this._prefetching = false }
      }, 2000)
    },

    // Checks which years with locally cached routes are missing from Dropbox
    // (first run, new format, or an earlier failed upload) and queues them.
    async ensureTracksSnapshot() {
      const authStore = useAuthStore()
      if (!authStore._accessToken) return
      const stored = await getStoredTrackIds()
      const local = [...this.activities, ...this.trash].filter((a) => a.hasTrack && stored.has(a.id))
      const years = [...new Set(local.map(yearKey))]
      const missing = []
      for (const y of years) if (!(await authStore.trackFileExists(y))) missing.push(y)
      if (missing.length) this.scheduleTracksSnapshot(null, missing)
    },

    // Debounced: rewrites the year files that changed. `ids` = activities
    // whose routes were just added/rebuilt (their years are rewritten);
    // `years` = years named directly. Routes this browser doesn't hold are
    // taken from the file already in Dropbox, so nothing is lost.
    scheduleTracksSnapshot(ids, years) {
      this._dirtyYears = this._dirtyYears || new Set()
      if (years) years.forEach((y) => this._dirtyYears.add(y))
      if (ids) {
        const byId = new Map([...this.activities, ...this.trash].map((a) => [String(a.id), a]))
        for (const id of ids) { const a = byId.get(String(id)); if (a) this._dirtyYears.add(yearKey(a)) }
      }
      clearTimeout(this._snapshotTimer)
      this._snapshotTimer = setTimeout(() => this.uploadTracksSnapshotNow(), 3000)
    },

    async uploadTracksSnapshotNow() {
      const authStore = useAuthStore()
      if (!authStore._accessToken || !this._dirtyYears?.size) return
      const years = [...this._dirtyYears]
      this._dirtyYears = new Set()
      const all = [...this.activities, ...this.trash].filter((a) => a.hasTrack)
      const uploads = []
      for (const y of years) {
        const inYear = all.filter((a) => yearKey(a) === y)
        if (!inYear.length) continue
        const tracks = new Map()
        const local = await getTracks(inYear.map((a) => a.id))
        for (const [id, v] of local) tracks.set(String(id), v)
        if (inYear.some((a) => !local.has(a.id))) {
          const remote = await authStore.downloadTrackFile(y)
          if (remote) for (const a of inYear) if (!local.has(a.id) && remote.has(String(a.id))) tracks.set(String(a.id), remote.get(String(a.id)))
        }
        if (tracks.size) uploads.push({ key: y, tracks })
      }
      if (!uploads.length) return
      if (!(await authStore.uploadTrackFiles(uploads))) years.forEach((y) => this._dirtyYears.add(y))
    },

    // Decompressed bytes of one activity's original file — the local cache
    // (originalsStore.js) first, then Dropbox itself if signed in. Used by
    // resolveTracks() above (to reparse a track that isn't cached yet) and
    // by HeatmapView's "download original" popup button (to offer the
    // exact original file, not a reconstruction). A file freshly fetched
    // from Dropbox is cached locally too, so it's a cache hit next time.
    async fetchOriginalBytes(sourceFile) {
      if (!sourceFile) return null
      const cached = await getOriginal(sourceFile)
      if (cached) return cached

      const authStore = useAuthStore()
      const bytes = await authStore.downloadOriginalForTrack(sourceFile)
      if (bytes) await saveOriginals([{ sourceFile, bytes, alreadyGzipped: false }])
      return bytes
    },

    async loadFromZip(file) {
      this.status = 'parsing'
      this.errorMessage = ''
      this.progress = { done: 0, total: 0, label: t('picker.starting') }
      try {
        const result = await parseStravaZip(file, (p) => {
          this.progress = p
        })
        await this.commitActivities({
          activities: result.activities,
          fileName: file.name,
          trackFailures: result.trackFailures,
          failureBreakdown: result.failureBreakdown,
          originalFiles: result.originalFiles,
          resetFiltersToDefault: true,
        })
      } catch (err) {
        console.error(err)
        this.errorMessage = err?.message || t('picker.fileError')
        this.status = 'error'
      }
    },

    // Debounced call site lives in App.vue (watches store.filters). Only
    // does anything while signed in — while signed out, filters (like
    // everything else) are never persisted, per the agreed flow.
    async persistFilters() {
      const authStore = useAuthStore()
      if (authStore.status !== 'signed-in') return
      const plain = toPlainFilters(this.filters)
      try {
        await authStore.syncFilters(plain)
        this.cloudSyncError = ''
      } catch (e) {
        this.cloudSyncError = t('err.saveFilters')
      }
    },

    resetFilters() {
      this.filters = defaultFilters()
      this.passageBoxMatches = null
    },

    startDrawingArea() {
      this.drawingArea = true
    },

    stopDrawingArea() {
      this.drawingArea = false
    },

    clearPassageBox() {
      this.filters.passageBox = null
      this.passageBoxMatches = null
    },

    // From the activities list: switch to the Heatmap tab (App.vue) and zoom
    // to this activity (HeatmapView.vue). A fresh object each time so asking
    // for the same activity twice still triggers.
    focusOnMap(id) { this.focusRequest = { id } },

    openFilters() { this.filtersOpen = true },
    closeFilters() { this.filtersOpen = false },
    toggleFilters() { this.filtersOpen = !this.filtersOpen },

    setRouteColor(color) { this.routeColor = color },

    openSourcePicker() { this.sourcePickerOpen = true },
    closeSourcePicker() { this.sourcePickerOpen = false },

    // keepSignedIn: true is used by the auth store itself (discarding
    // pending/cloud data while staying connected) — it must NOT touch
    // auth state. A plain clearAll() (e.g. from signOut()) only ever
    // clears the activities side; signing out is the auth store's job.
    clearAll({ keepSignedIn = false } = {}) {
      this.activities = []
      this.trash = []
      this.tagDefs = defaultTagDefs()
      this.gearDefs = []
      this.gearMeta = { recalculatedAt: null, dirty: false }
      this.status = 'idle'
      this.fileName = ''
      this.filters = defaultFilters()
      this.drawingArea = false
      this.filtersOpen = false
      this.restoredAt = null
      this.persistError = ''
      this.cloudSyncError = ''
      this.passageBoxMatches = null
      this._yearJobs = null
      this._dirtyYears = null
      this._prefetching = false
      clearTimeout(this._snapshotTimer)
      clearAllTracks().catch((e) => console.warn('[activities-heatmap] Não foi possível limpar os tracks guardados:', e))
      clearAllOriginals().catch((e) => console.warn('[activities-heatmap] Não foi possível limpar os ficheiros originais guardados:', e))
      if (!keepSignedIn) {
        clearSession().catch((e) => console.warn('[activities-heatmap] Não foi possível limpar a sessão guardada:', e))
      }
    },
  },
})
