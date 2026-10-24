<script setup>
import { onMounted, onBeforeUnmount, watch, ref, shallowRef, computed, nextTick } from 'vue'
import L from 'leaflet'
import { useActivitiesStore } from '../stores/activities'
import { t } from '../i18n'
import {
  buildGpxString, buildGpxFilename, buildOriginalFilename,
  sourceFileExtension, mimeForExtension, triggerBytesDownload,
} from '../utils/gpxExport'
import EditActivityModal from '../components/EditActivityModal.vue'
import ActivityPanel from '../components/ActivityPanel.vue'

// Routes are drawn in a single color regardless of activity type —
// a deliberate choice (previously color-coded by type) for a bolder, more
// legible trace against the basemap. The color itself is user-adjustable
// (store.routeColor, picked via the color input in the toolbar below);
// this is just the default.
const store = useActivitiesStore()
const mapEl = ref(null)
let map = null
let layerGroup = null
let boxLayer = null
let hasFitBounds = false
let focusId = null // activity asked for from the activities list; drawn even if the filters would hide it
let redrawTimer = null
let mapRO = null

// "no-gps-points" is an expected, benign case (indoor/trainer activities
// genuinely have no GPS fix) — worth a soft note, not a warning icon. Any
// other reason is a real processing failure worth flagging more visibly.
const failureSummary = computed(() => {
  const items = store.failureBreakdown
  if (!items.length) return null
  const benign = items.find((f) => f.reason === 'no-gps-points')
  const errors = items.filter((f) => f.reason !== 'no-gps-points')
  const errorCount = errors.reduce((sum, f) => sum + f.count, 0)
  return {
    benignCount: benign?.count || 0,
    errorCount,
    errors,
  }
})

const BASE_LAYERS = {
  light: {
    label: 'Mapa',
    // Plain OpenStreetMap tiles — free and keyless. (CARTO's basemaps,
    // used here previously, now require an API key for their tile
    // service, which is why this layer started asking for one while
    // satellite/terrain — Esri and OpenTopoMap, still keyless — kept
    // working.)
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    label: 'Satélite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, GIS User Community',
    maxZoom: 19,
  },
  terrain: {
    label: 'Relevo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  },
  gray: {
    label: 'Cinza',
    // A flat, desaturated all-gray basemap,
    // so the (colored) routes are the only thing that stands out. There's
    // no free, keyless tile provider left that serves this directly (the
    // old CARTO "Positron" tiles now require an API key — see the "light"
    // layer's note above), so this reuses the plain OSM tiles and applies
    // a CSS filter (className below) to desaturate them in the browser.
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    className: 'gray-basemap-tiles',
  },
}
const activeBaseKey = ref('gray')
const layerPanelOpen = ref(false)
const statsPopupOpen = ref(false)
const editingActivity = ref(null)

function pickBaseLayer(key) {
  setBaseLayer(key)
  layerPanelOpen.value = false
}
let baseTileLayer = null

function setBaseLayer(key) {
  if (!map || !BASE_LAYERS[key]) return
  const cfg = BASE_LAYERS[key]
  const next = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom, className: cfg.className || '' })
  next.addTo(map)
  if (baseTileLayer) map.removeLayer(baseTileLayer)
  baseTileLayer = next
  activeBaseKey.value = key
}

const BASE_WEIGHT = 2.2
const HOVER_WEIGHT = 5
const BASE_OPACITY = 0.6
const HOVER_OPACITY = 0.95
const SELECTED_WEIGHT = 6
const SELECTED_OPACITY = 1
const BOX_COLOR = '#B8792C'

let selectedLayer = null

// Downloads the activity's ORIGINAL file (whatever it was imported as —
// FIT/GPX/TCX — byte-for-byte, decompressed) from the local cache or
// Dropbox. Only when there's no original at all (e.g. an activity migrated
// from the old single-blob format) does it fall back to a GPX rebuilt from
// the track points already loaded for drawing, which only keep lat/lon.
async function downloadOriginalForActivity(a, latlngs) {
  if (a.sourceFile) {
    try {
      const bytes = await store.fetchOriginalBytes(a.sourceFile)
      if (bytes) {
        const ext = sourceFileExtension(a.sourceFile)
        triggerBytesDownload(bytes, buildOriginalFilename(a, ext), mimeForExtension(ext))
        return
      }
      window.alert(t('map.noOriginal'))
      return
    } catch (e) {
      console.warn('[activities-heatmap] Falha ao descarregar o ficheiro original:', e)
      window.alert(t('map.downloadFailed'))
      return
    }
  }
  if (latlngs) {
    const gpx = buildGpxString({ ...a, latlngs })
    triggerBytesDownload(new TextEncoder().encode(gpx), buildGpxFilename(a), 'application/gpx+xml')
  }
}

// Converts the original FIT/TCX to GPX on demand (gpxConvert.js is loaded
// lazily — it pulls in the FIT parser, which isn't needed to browse the map).
async function downloadConvertedGpx(a) {
  try {
    const bytes = await store.fetchOriginalBytes(a.sourceFile)
    if (!bytes) {
      window.alert(t('map.noOriginal'))
      return
    }
    const { convertToGpx } = await import('../utils/gpxConvert')
    const gpx = await convertToGpx(bytes, sourceFileExtension(a.sourceFile), a)
    if (!gpx) {
      window.alert(t('map.noGpsForGpx'))
      return
    }
    triggerBytesDownload(new TextEncoder().encode(gpx), buildGpxFilename(a), mimeForExtension('gpx'))
  } catch (e) {
    console.warn('[activities-heatmap] Falha ao converter o original para GPX:', e)
    window.alert(t('map.convertFailed'))
  }
}

// --- selected activity (bottom panel) ---------------------------------------
// Clicking a route selects it: the line is highlighted and the bottom panel
// shows its details plus an elevation profile. The profile is read on demand
// from the activity's ORIGINAL file (the cached map tracks only hold lat/lon).
const selectedId = ref(null)
const selectedActivity = computed(() =>
  selectedId.value == null ? null : store.activities.find((a) => a.id === selectedId.value) || null,
)
let selectedLatlngs = null // plain (non-reactive) point array, only for the GPX fallback download
const lineById = new Map()

const profileState = shallowRef({ status: 'loading' })
const profileCache = new Map() // activity id -> finished profileState (small LRU)
const PROFILE_CACHE_LIMIT = 20
let profileToken = 0
let hoverMarker = null

function clearHoverMarker() {
  if (hoverMarker && map) map.removeLayer(hoverMarker)
  hoverMarker = null
}

function onProfileHover(pt) {
  if (!map) return
  if (!pt) { clearHoverMarker(); return }
  if (!hoverMarker) {
    hoverMarker = L.circleMarker([pt.lat, pt.lon], {
      radius: 6, color: '#FFFFFF', weight: 2, fillColor: '#1d6fe0', fillOpacity: 1, interactive: false,
    }).addTo(map)
  } else {
    hoverMarker.setLatLng([pt.lat, pt.lon])
  }
  hoverMarker.bringToFront()
}

async function loadProfile(a) {
  const token = ++profileToken
  clearHoverMarker()
  const cached = profileCache.get(a.id)
  if (cached) { profileState.value = cached; return }
  if (!a.sourceFile) {
    profileState.value = { status: 'none', message: t('map.profile.noOriginal') }
    return
  }
  profileState.value = { status: 'loading' }
  try {
    const bytes = await store.fetchOriginalBytes(a.sourceFile)
    if (token !== profileToken) return
    if (!bytes) {
      profileState.value = { status: 'none', message: t('map.noOriginal') }
      return
    }
    const { extractProfile } = await import('../utils/elevationProfile')
    const data = await extractProfile(bytes, sourceFileExtension(a.sourceFile))
    if (token !== profileToken) return
    const state = data
      ? { status: 'ready', data }
      : { status: 'none', message: t('map.profile.noAltitude') }
    profileState.value = state
    profileCache.set(a.id, state)
    if (profileCache.size > PROFILE_CACHE_LIMIT) profileCache.delete(profileCache.keys().next().value)
  } catch (e) {
    if (token !== profileToken) return
    console.warn('[activities-heatmap] Falha ao ler a altimetria:', e)
    profileState.value = { status: 'none', message: t('map.profile.readFailed') }
  }
}

function selectLine(a, line, latlngs, latlng) {
  if (selectedLayer && selectedLayer !== line) {
    selectedLayer.setStyle({ weight: BASE_WEIGHT, opacity: BASE_OPACITY })
  }
  selectedLayer = line
  line.setStyle({ weight: SELECTED_WEIGHT, opacity: SELECTED_OPACITY })
  line.bringToFront()

  const wasOpen = selectedId.value != null
  selectedId.value = a.id
  selectedLatlngs = latlngs
  loadProfile(a)

  // The panel takes space from the map, so on first open make sure the spot
  // that was clicked is still on screen once the map has been resized.
  if (!wasOpen) {
    nextTick(() => {
      map?.invalidateSize({ animate: false })
      if (latlng) map?.panInside(latlng, { padding: [50, 50], animate: false })
    })
  }
}

function closePanel(keepFocus = false) {
  if (!keepFocus && focusId != null) { focusId = null; scheduleDraw() } // drops the extra line if the filters were hiding it
  if (selectedLayer) {
    selectedLayer.setStyle({ weight: BASE_WEIGHT, opacity: BASE_OPACITY })
    selectedLayer = null
  }
  selectedId.value = null
  selectedLatlngs = null
  profileToken++
  clearHoverMarker()
}

function editSelected() {
  if (selectedActivity.value) editingActivity.value = selectedActivity.value
}

function removeSelected() {
  const a = selectedActivity.value
  if (!a) return
  if (window.confirm(t('map.confirmRemove', { name: a.name }))) {
    closePanel()
    store.removeActivity(a.id)
  }
}

// If the activity being shown is deleted some other way (or filtered out of
// the map), there's nothing left to show.
watch(selectedActivity, (a) => { if (selectedId.value != null && !a) closePanel() })

// Geometry isn't kept in memory for the whole dataset any more (see
// stores/activities.js) — it's fetched on demand for exactly the
// activities about to be drawn, which is why this is async now. drawToken
// guards against a slower, older draw() finishing after a newer one
// started (e.g. the user tweaks a filter again before the first fetch
// resolves) — only the most recent call is allowed to actually render.
let drawToken = 0

async function draw() {
  if (!map || !layerGroup) return
  const token = ++drawToken

  const list = store.filtered.filter((a) => a.hasTrack)
  if (focusId != null && !list.some((a) => a.id === focusId)) {
    const f = store.activities.find((a) => a.id === focusId)
    if (f?.hasTrack) list.push(f)
  }
  const tracks = await store.resolveTracks(list.map((a) => a.id))
  if (token !== drawToken) return // superseded by a newer draw() — discard

  layerGroup.clearLayers()
  selectedLayer = null
  lineById.clear()

  const bounds = []

  for (const a of list) {
    const latlngs = tracks.get(a.id)
    if (!latlngs) continue // geometry went missing (shouldn't normally happen) — skip rather than crash

    const line = L.polyline(latlngs, {
      color: store.routeColor,
      weight: BASE_WEIGHT,
      opacity: BASE_OPACITY,
    })
    line.on('mouseover', () => {
      if (selectedLayer === line) return
      line.setStyle({ weight: HOVER_WEIGHT, opacity: HOVER_OPACITY })
      line.bringToFront()
    })
    line.on('mouseout', () => {
      if (selectedLayer === line) return
      line.setStyle({ weight: BASE_WEIGHT, opacity: BASE_OPACITY })
    })
    line.on('click', (e) => {
      // Leaflet would also deliver this click to the map, whose handler
      // closes the panel — stop it here.
      L.DomEvent.stopPropagation(e)
      selectLine(a, line, latlngs, e.latlng)
    })
    lineById.set(a.id, line)
    line.addTo(layerGroup)
    bounds.push(latlngs[0], latlngs[latlngs.length - 1])
  }

  // A redraw (filter change, recolor...) rebuilds every line: re-highlight the
  // selected one, or close the panel if it's no longer on the map.
  if (selectedId.value != null) {
    const kept = lineById.get(selectedId.value)
    if (kept) {
      selectedLayer = kept
      kept.setStyle({ weight: SELECTED_WEIGHT, opacity: SELECTED_OPACITY })
      kept.bringToFront()
      selectedLatlngs = tracks.get(selectedId.value) || selectedLatlngs
    } else {
      closePanel(true)
    }
  }

  if (!hasFitBounds && bounds.length) {
    try {
      const b = L.latLngBounds(bounds)
      map.fitBounds(b.pad(0.15))
    } catch (e) { /* ignore */ }
    hasFitBounds = true
  }

  drawBox()
}

function drawBox() {
  if (!map || !boxLayer) return
  boxLayer.clearLayers()
  const box = store.filters.passageBox
  if (!box) return
  L.rectangle([[box.south, box.west], [box.north, box.east]], {
    color: BOX_COLOR,
    weight: 1.5,
    dashArray: '5 4',
    fillOpacity: 0.06,
    interactive: false,
  }).addTo(boxLayer)
}

// "Ver no mapa" from the activities list: show that activity (even if the
// current filters hide it), select it and zoom to its route.
async function focusOnActivity(id) {
  if (!map) return
  const a = store.activities.find((x) => x.id === id)
  if (!a?.hasTrack) return
  focusId = id
  hasFitBounds = true // don't let the first-draw fit override this view
  await nextTick()
  await new Promise((r) => requestAnimationFrame(r)) // the tab was hidden: let the map get its size back
  map.invalidateSize({ animate: false })
  clearTimeout(redrawTimer)
  await draw()
  let line = lineById.get(id)
  if (!line) { await new Promise((r) => setTimeout(r, 250)); await draw(); line = lineById.get(id) }
  if (!line) return
  selectLine(a, line, line.getLatLngs())
  await nextTick() // the bottom panel resizes the map
  await new Promise((r) => requestAnimationFrame(r))
  map.invalidateSize({ animate: false })
  map.fitBounds(line.getBounds().pad(0.2), { animate: false })
}
watch(() => store.focusRequest, (r) => { if (r) focusOnActivity(r.id) })

function scheduleDraw() {
  clearTimeout(redrawTimer)
  redrawTimer = setTimeout(draw, 150)
}

// --- "passagem" rectangle drawing -----------------------------------------
let drawing = false
let drawStart = null
let liveRect = null

function toggleDrawMode() {
  if (store.drawingArea) store.stopDrawingArea()
  else store.startDrawingArea()
}

function cancelDrawMode() {
  store.stopDrawingArea()
}

function clearBox() {
  store.clearPassageBox()
}

// Pointer events (not Leaflet's mouse events) so the same code works with a
// finger: touch never fires mousedown/mousemove, and the browser would pan
// the page unless touch-action is switched off while drawing.
function latlngOf(e) { return map.mouseEventToLatLng(e) }

function onPointerDown(e) {
  if (!store.drawingArea || !map) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (e.target.closest?.('.leaflet-control')) return
  e.preventDefault()
  drawing = true
  drawStart = latlngOf(e)
  try { mapEl.value.setPointerCapture(e.pointerId) } catch (err) { /* not capturable */ }
  if (liveRect) { map.removeLayer(liveRect); liveRect = null }
}
function onPointerMove(e) {
  if (!drawing || !drawStart) return
  e.preventDefault()
  const b = L.latLngBounds(drawStart, latlngOf(e))
  if (liveRect) liveRect.setBounds(b)
  else liveRect = L.rectangle(b, { color: BOX_COLOR, weight: 2, dashArray: '5 4', fillOpacity: 0.08, interactive: false }).addTo(map)
}
function onPointerUp(e) {
  if (!drawing) return
  drawing = false
  if (drawStart) {
    const b = L.latLngBounds(drawStart, latlngOf(e))
    if (Math.abs(b.getNorth() - b.getSouth()) > 0.0001 && Math.abs(b.getEast() - b.getWest()) > 0.0001) {
      store.filters.passageBox = {
        south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast(),
      }
      store.recomputePassageBoxMatches()
    }
  }
  if (liveRect) { map.removeLayer(liveRect); liveRect = null }
  drawStart = null
  cancelDrawMode()
}
function onPointerCancel() {
  drawing = false
  drawStart = null
  if (liveRect) { map?.removeLayer(liveRect); liveRect = null }
}

onMounted(() => {
  map = L.map(mapEl.value, {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
  }).setView([39.5, -8], 6)

  mapEl.value.classList.toggle('panel-open', !!store.filtersOpen)
  setBaseLayer('gray')
  layerGroup = L.layerGroup().addTo(map)
  boxLayer = L.layerGroup().addTo(map)

  mapEl.value.addEventListener('pointerdown', onPointerDown)
  mapEl.value.addEventListener('pointermove', onPointerMove)
  mapEl.value.addEventListener('pointerup', onPointerUp)
  mapEl.value.addEventListener('pointercancel', onPointerCancel)
  map.on('click', () => closePanel())

  mapEl.value.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'right') map?.invalidateSize({ animate: false })
  })

  // The map's box changes whenever the bottom panel opens/closes/minimizes,
  // the filter panel slides in, or the window is resized.
  mapRO = new ResizeObserver(() => requestAnimationFrame(() => map?.invalidateSize({ animate: false })))
  mapRO.observe(mapEl.value)

  draw()
})

onBeforeUnmount(() => {
  mapRO?.disconnect()
  clearTimeout(redrawTimer)
  map?.remove()
})

watch(() => store.filters, scheduleDraw, { deep: true })
watch(() => store.activities, () => { hasFitBounds = false; scheduleDraw() })
watch(() => store.routeColor, scheduleDraw)
// passageBoxMatches lives outside store.filters (it's computed async — see
// recomputePassageBoxMatches), so the deep watch above won't catch it
// resolving; without this, the map would keep showing the pre-box set of
// routes until some other filter change happened to trigger a redraw.
watch(() => store.passageBoxMatches, scheduleDraw)

// the filter popup can also start drawing mode; keep the map's cursor/drag
// state in sync no matter where drawingArea was toggled from
watch(() => store.drawingArea, (active) => {
  if (!map) return
  if (active) {
    map.dragging.disable()
    map.touchZoom.disable()
    map.getContainer().style.touchAction = 'none'
    map.getContainer().style.cursor = 'crosshair'
  } else {
    drawing = false
    drawStart = null
    if (liveRect) { map.removeLayer(liveRect); liveRect = null }
    map.dragging.enable()
    map.touchZoom.enable()
    map.getContainer().style.touchAction = ''
    map.getContainer().style.cursor = ''
  }
})

// the map container's width changes (CSS) whenever the filter panel opens or
// closes; Leaflet caches its pixel size internally, so without this its click
// / drag coordinates drift out of sync with what's actually on screen.
// We listen for the CSS transition to actually finish rather than guessing a
// timeout — a premature invalidateSize() call leaves Leaflet permanently
// off by a few pixels, breaking clicks until the page is reloaded.
let sizeFallbackTimer = null
watch(() => store.filtersOpen, (open) => {
  mapEl.value?.classList.toggle('panel-open', !!open)
  if (!map) return
  map.invalidateSize({ animate: false })
  clearTimeout(sizeFallbackTimer)
  sizeFallbackTimer = setTimeout(() => map?.invalidateSize({ animate: false }), 400)
})
</script>

<template>
  <div class="heatmap-page">
    <div class="map-area">
    <!-- No dynamic :class here on purpose: Leaflet adds its own classes to this
         element (leaflet-container & co.) and Vue would overwrite them on the
         next class update. "panel-open" is toggled by hand instead. -->
    <div ref="mapEl" class="map"></div>

    <div class="toolbar">
      <button class="tool-btn" :class="{ active: store.drawingArea }" @click="toggleDrawMode">
        <span class="tool-icon">▭</span>
        {{ store.drawingArea ? t('map.drawing') : t('map.filterArea') }}
      </button>
      <button v-if="store.filters.passageBox" class="tool-btn ghost" @click="clearBox">
        {{ t('map.clearArea') }}
      </button>
      <span v-if="store.passageBoxLoading" class="tool-hint mono">{{ t('map.searching') }}</span>
    </div>

    <div class="side-controls">
      <button
        class="icon-btn"
        :class="{ active: store.filtersOpen }"
        :title="t('filter.title')"
        @click="store.toggleFilters()"
      >
        <span class="icon-glyph">☰</span>
        <span v-if="store.activeFilterCount" class="icon-badge mono">{{ store.activeFilterCount }}</span>
      </button>

      <div class="flyout-wrap">
        <button
          class="icon-btn"
          :class="{ active: layerPanelOpen }"
          :title="t('map.layer')"
          @click="layerPanelOpen = !layerPanelOpen; statsPopupOpen = false"
        >
          <span class="icon-glyph">▦</span>
        </button>
        <div v-if="layerPanelOpen" class="flyout layer-flyout">
          <button
            v-for="(cfg, key) in BASE_LAYERS"
            :key="key"
            class="layer-option"
            :class="{ active: activeBaseKey === key }"
            @click="pickBaseLayer(key)"
          >
            {{ t('map.layers.' + key) }}
          </button>
          <label class="layer-option route-color-option" :title="t('map.routeColor')">
            <span>{{ t('map.routeColor') }}</span>
            <input type="color" v-model="store.routeColor" />
          </label>
        </div>
      </div>

      <div class="flyout-wrap">
        <button
          class="icon-btn"
          :class="{ active: statsPopupOpen }"
          :title="t('map.summary')"
          @click="statsPopupOpen = !statsPopupOpen; layerPanelOpen = false"
        >
          <span class="icon-glyph">Σ</span>
        </button>
        <div v-if="statsPopupOpen" class="flyout stats-flyout mono">
          <div>{{ t('map.nActivities', { n: store.filteredStats.count }, store.filteredStats.count) }}</div>
          <div>{{ t('map.withGps', { n: store.filteredStats.withGps }) }}</div>
          <div>{{ store.filteredStats.distance.toFixed(0) }} km</div>
          <div>{{ store.filteredStats.elevation.toFixed(0) }} m {{ t('map.gain') }}</div>
        </div>
      </div>
    </div>

    <div v-if="failureSummary" class="track-notices">
      <div v-if="failureSummary.errorCount > 0" class="track-warning mono" :title="t('map.errorsTitle')">
        ⚠ {{ t('map.errors', { n: failureSummary.errorCount }, failureSummary.errorCount) }}
      </div>
      <div v-if="failureSummary.benignCount > 0" class="track-info mono" :title="t('map.noGpsTitle')">
        ℹ {{ t('map.noGps', { n: failureSummary.benignCount }, failureSummary.benignCount) }}
      </div>
    </div>

    </div>

    <ActivityPanel
      v-if="selectedActivity"
      :activity="selectedActivity"
      :profile-state="profileState"
      :color="store.routeColor"
      @edit="editSelected"
      @remove="removeSelected"
      @download="downloadOriginalForActivity(selectedActivity, selectedLatlngs)"
      @convert="downloadConvertedGpx(selectedActivity)"
      @hover="onProfileHover"
    />

    <EditActivityModal
      v-if="editingActivity"
      :activity="editingActivity"
      @close="editingActivity = null"
    />
  </div>
</template>

<style scoped>
.heatmap-page {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* The map and its overlay controls live here; the bottom panel is a sibling
   below, so opening it shrinks the map instead of covering it. */
.map-area {
  position: relative;
  flex: 1;
  min-height: 0;
}
.map {
  position: absolute;
  inset: 0;
  z-index: 0; /* keep Leaflet's own z-indexed controls below the filter sheet */
  background: var(--bg);
  transition: right 0.2s ease;
}
.map.panel-open {
  right: min(var(--filter-panel-width), 92vw);
}
/* on phones the filters open as a bottom sheet over the map, not beside it */
@media (max-width: 720px) {
  .map.panel-open { right: 0; }
}

.toolbar {
  position: absolute;
  top: 16px;
  left: 60px;
  z-index: 500;
  display: flex;
  gap: 8px;
}
.tool-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12.5px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  box-shadow: 0 4px 14px -6px rgba(30, 25, 15, 0.25);
  backdrop-filter: blur(4px);
}
.tool-btn:hover { border-color: var(--accent); color: var(--accent); }
.tool-btn.active { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.tool-btn.ghost { background: rgba(255,255,255,0.9); }
.tool-icon { font-size: 11px; }
.tool-hint {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 11px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  box-shadow: 0 4px 14px -6px rgba(30, 25, 15, 0.25);
}

/* Left-side icon stack, sitting just below Leaflet's own zoom control
   (which occupies ~10px/10px with ~58px of height at default size). */
.side-controls {
  position: absolute;
  top: 76px;
  left: 10px;
  z-index: 500;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.icon-btn {
  position: relative;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--border);
  color: var(--text-dim);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 14px -6px rgba(30, 25, 15, 0.25);
  backdrop-filter: blur(4px);
}
.icon-btn:hover { border-color: var(--accent); color: var(--accent); }
.icon-btn.active { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.icon-glyph { font-size: 14px; line-height: 1; }
.icon-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  background: var(--accent-strong);
  color: var(--on-accent);
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 10px;
  line-height: 1.4;
}

.flyout-wrap { position: relative; }
.flyout {
  position: absolute;
  top: 0;
  left: 38px;
  z-index: 500;
  background: rgba(255, 255, 255, 0.97);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px -8px rgba(30, 25, 15, 0.3);
  backdrop-filter: blur(4px);
  white-space: nowrap;
}
.layer-flyout {
  display: flex;
  flex-direction: column;
  padding: 4px;
  gap: 2px;
}
.layer-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 12px;
  padding: 7px 10px;
  border-radius: 4px;
  text-align: left;
}
button.layer-option:hover { color: var(--text); background: var(--surface-alt); }
.layer-option.active { background: var(--accent); color: var(--on-accent); }
.route-color-option {
  border-top: 1px solid var(--border);
  margin-top: 2px;
  padding-top: 8px;
  cursor: pointer;
}
.route-color-option input[type='color'] {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: none;
  cursor: pointer;
}
.route-color-option input[type='color']::-webkit-color-swatch-wrapper { padding: 0; }
.route-color-option input[type='color']::-webkit-color-swatch { border: 1px solid var(--border); border-radius: 4px; }

.stats-flyout {
  padding: 10px 14px;
  font-size: 12px;
  color: var(--text-dim);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.track-notices {
  position: absolute;
  bottom: 16px;
  left: 16px;
  z-index: 500;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.track-warning,
.track-info {
  border-radius: var(--radius-md);
  padding: 8px 14px;
  font-size: 11.5px;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 14px -6px rgba(30, 25, 15, 0.2);
}
.track-warning {
  background: rgba(255, 250, 235, 0.97);
  border: 1px solid var(--clay);
  color: var(--clay);
}
.track-info {
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
</style>

<style>
/* Unscoped: Leaflet renders popups and tiles outside Vue's scoped DOM, so
   these rules target the raw HTML Leaflet itself creates. */

/* The "Cinza" (gray) base layer: plain OSM tiles desaturated in the
   browser via CSS, giving a neutral all-gray basemap — the
   routes are what the eye should land on, not the map underneath them. */
.gray-basemap-tiles {
  filter: grayscale(1) brightness(1.12) contrast(0.9);
}
</style>

