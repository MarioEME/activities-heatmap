<script setup>
// Shown under an expanded row of the activities list: the route on a small
// map and the elevation profile, side by side on wide screens and stacked on
// phones. Self-contained: it loads the route and the profile for ONE activity
// (from the local cache / Dropbox, like the Heatmap's bottom panel) and
// cleans up its own map when the row is collapsed.
import { ref, shallowRef, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import { useActivitiesStore } from '../stores/activities'
import { sourceFileExtension } from '../utils/gpxExport'
import ElevationProfile from './ElevationProfile.vue'
import { t } from '../i18n'

const props = defineProps({ activity: { type: Object, required: true } })

const store = useActivitiesStore()
const mapEl = ref(null)
const mapState = ref(props.activity.hasTrack ? 'loading' : 'none') // loading | ready | none
const profileState = shallowRef({ status: 'loading' })
let map = null
let hoverMarker = null
let ro = null
let dead = false

onMounted(async () => {
  loadProfile()
  if (!props.activity.hasTrack) return

  map = L.map(mapEl.value, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    className: 'gray-basemap-tiles',
  }).addTo(map)
  map.setView([39.5, -8], 6)
  ro = new ResizeObserver(() => requestAnimationFrame(() => map?.invalidateSize({ animate: false })))
  ro.observe(mapEl.value)

  const tracks = await store.resolveTracks([props.activity.id])
  if (dead) return
  const latlngs = tracks.get(props.activity.id)
  if (!latlngs?.length) { mapState.value = 'none'; return }
  const line = L.polyline(latlngs, { color: store.routeColor, weight: 4, opacity: 0.95 }).addTo(map)
  mapState.value = 'ready'
  map.invalidateSize({ animate: false })
  map.fitBounds(line.getBounds().pad(0.12), { animate: false })
})

onBeforeUnmount(() => {
  dead = true
  ro?.disconnect()
  map?.remove()
  map = null
})

async function loadProfile() {
  const a = props.activity
  if (!a.sourceFile) {
    profileState.value = { status: 'none', message: t('map.profile.noOriginal') }
    return
  }
  try {
    const bytes = await store.fetchOriginalBytes(a.sourceFile)
    if (dead) return
    if (!bytes) { profileState.value = { status: 'none', message: t('map.noOriginal') }; return }
    const { extractProfile } = await import('../utils/elevationProfile')
    const data = await extractProfile(bytes, sourceFileExtension(a.sourceFile))
    if (dead) return
    profileState.value = data
      ? { status: 'ready', data }
      : { status: 'none', message: t('map.profile.noAltitude') }
  } catch (e) {
    if (dead) return
    console.warn('[activities-heatmap] Falha ao ler a altimetria:', e)
    profileState.value = { status: 'none', message: t('map.profile.readFailed') }
  }
}

// The profile reports the point under the finger/mouse; mark it on the map.
function onHover(pt) {
  if (!map) return
  if (!pt) { if (hoverMarker) { map.removeLayer(hoverMarker); hoverMarker = null } return }
  if (!hoverMarker) {
    hoverMarker = L.circleMarker([pt.lat, pt.lon], {
      radius: 6, color: '#FFFFFF', weight: 2, fillColor: '#1d6fe0', fillOpacity: 1, interactive: false,
    }).addTo(map)
  } else {
    hoverMarker.setLatLng([pt.lat, pt.lon])
  }
}
</script>

<template>
  <div class="detail-grid">
    <div class="box map-box">
      <div v-show="mapState !== 'none'" ref="mapEl" class="mini-map"></div>
      <div v-if="mapState === 'none'" class="msg">{{ t('act.noGps') }}</div>
    </div>

    <div class="box elev-box">
      <div class="elev-head">
        <strong>{{ t('panel.elevationTitle') }}</strong>
        <span v-if="profileState.data" class="meta mono">{{ t('panel.minMax', { min: Math.round(profileState.data.min), max: Math.round(profileState.data.max) }) }}</span>
      </div>
      <div class="elev-body">
        <ElevationProfile
          v-if="profileState.status === 'ready'"
          :profile="profileState.data"
          :color="store.routeColor"
          @hover="onHover"
        />
        <div v-else class="msg">
          <template v-if="profileState.status === 'loading'">{{ t('panel.loading') }}</template>
          <template v-else>{{ profileState.message || t('panel.noData') }}</template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  padding: 4px 0 6px;
  white-space: normal;
}
.box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 300px;
}
.mini-map { flex: 1; min-height: 0; background: var(--surface-alt); }
.elev-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 0;
  font-size: 12.5px;
  color: var(--text);
}
.meta { font-size: 11px; color: var(--text-muted); }
.elev-body { flex: 1; min-height: 0; padding: 6px 8px 8px; }
.msg {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px;
  font-size: 12.5px;
  color: var(--text-muted);
}
@media (max-width: 720px) {
  .detail-grid { grid-template-columns: minmax(0, 1fr); gap: 10px; }
  .map-box { height: 260px; }
  .elev-box { height: 200px; }
}
</style>
