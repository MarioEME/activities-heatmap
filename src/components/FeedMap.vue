<script setup>
// Static route map for a feed card. The Leaflet map only exists while the card
// is near the screen (created when it scrolls into view, removed when it is far
// away), so a feed of thousands of activities stays light.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import { useActivitiesStore } from '../stores/activities'
import { t } from '../i18n'

const props = defineProps({ activity: { type: Object, required: true } })
const store = useActivitiesStore()
const root = ref(null)
const mapEl = ref(null)
const state = ref(props.activity.hasTrack ? 'idle' : 'none') // idle | ready | none
let map = null
let io = null
let latlngsCache = null
let seq = 0

function destroy() {
  seq++
  map?.remove()
  map = null
  if (state.value === 'ready') state.value = 'idle'
}

async function create() {
  if (map || state.value === 'none') return
  const my = ++seq
  if (!latlngsCache) {
    const tr = await store.resolveTracks([props.activity.id])
    latlngsCache = tr.get(props.activity.id) || null
  }
  if (my !== seq || map) return
  if (!latlngsCache?.length) { state.value = 'none'; return }
  state.value = 'ready'
  await new Promise((r) => requestAnimationFrame(r))
  if (my !== seq || !mapEl.value) return
  map = L.map(mapEl.value, {
    zoomControl: false, attributionControl: false, dragging: false, touchZoom: false,
    doubleClickZoom: false, scrollWheelZoom: false, boxZoom: false, keyboard: false, tap: false,
  })
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'gray-basemap-tiles' }).addTo(map)
  const line = L.polyline(latlngsCache, { color: store.routeColor, weight: 3.5, opacity: 0.95 }).addTo(map)
  map.invalidateSize({ animate: false })
  map.fitBounds(line.getBounds().pad(0.15), { animate: false })
}

onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') { create(); return }
  io = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? create() : destroy()
  }, { rootMargin: '250px 0px' })
  io.observe(root.value)
})
onBeforeUnmount(() => { io?.disconnect(); destroy() })
</script>

<template>
  <div ref="root" class="feed-map">
    <div v-show="state === 'ready'" ref="mapEl" class="m"></div>
    <div v-if="state === 'none'" class="msg">{{ t('act.noGps') }}</div>
  </div>
</template>

<style scoped>
.feed-map { height: 200px; background: var(--surface-alt); position: relative; pointer-events: none; }
.m { position: absolute; inset: 0; }
.msg { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 12.5px; color: var(--text-muted); }
</style>
