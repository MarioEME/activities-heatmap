<script setup>
// Shown under an expanded row of the activities list: the route on a small
// map (the elevation and pace graphs live in the Heatmap tab's panel, so the
// information is not duplicated here). Self-contained: it loads the route for
// ONE activity (from the local cache / Dropbox) and cleans up its own map
// when the row is collapsed.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import { useActivitiesStore } from '../stores/activities'
import { t } from '../i18n'

const props = defineProps({ activity: { type: Object, required: true } })

const store = useActivitiesStore()
const mapEl = ref(null)
const mapState = ref(props.activity.hasTrack ? 'loading' : 'none') // loading | ready | none
let map = null
let ro = null
let dead = false

onMounted(async () => {
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

</script>

<template>
  <div class="detail-grid">
    <div class="box map-box">
      <div v-show="mapState !== 'none'" ref="mapEl" class="mini-map"></div>
      <div v-if="mapState === 'none'" class="msg">{{ t('act.noGps') }}</div>
    </div>

  </div>
</template>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
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
  height: 340px;
}
.mini-map { flex: 1; min-height: 0; background: var(--surface-alt); }
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
  .map-box { height: 260px; }
}
</style>
