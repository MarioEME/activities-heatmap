<script setup>
// Static route map for a feed card. The Leaflet map only exists while the card
// is near the screen (created when it scrolls into view, removed when it is far
// away), so a feed of thousands of activities stays light.
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import L from 'leaflet'
import { useActivitiesStore } from '../stores/activities'
import { t } from '../i18n'

const props = defineProps({
  activity: { type: Object, required: true },
  // expanded card: the map can be panned and zoomed (the others stay static, which keeps the feed light)
  interactive: { type: Boolean, default: false },
  fill: { type: Boolean, default: false }, // take the height of the parent (full-screen detail)
})
const store = useActivitiesStore()
const root = ref(null)
const mapEl = ref(null)
const state = ref(props.activity.hasTrack ? 'idle' : 'none') // idle | ready | none
let map = null
let io = null
let latlngsCache = null
let seq = 0
let zoomCtl = null

function applyInteractive() {
  if (!map) return
  const on = props.interactive
  for (const h of ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom']) map[h][on ? 'enable' : 'disable']()
  if (on && !zoomCtl) { zoomCtl = L.control.zoom({ position: 'topright' }); zoomCtl.addTo(map) }
  if (!on && zoomCtl) { zoomCtl.remove(); zoomCtl = null }
}
watch(() => props.interactive, applyInteractive)

function destroy() {
  seq++
  map?.remove()
  map = null
  zoomCtl = null
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
  applyInteractive()
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
  <div ref="root" class="feed-map" :class="{ live: interactive, fill }">
    <div v-show="state === 'ready'" ref="mapEl" class="m"></div>
    <div v-if="state === 'none'" class="msg">{{ t('act.noGps') }}</div>
  </div>
</template>

<style scoped>
.feed-map { height: 200px; background: var(--surface-alt); position: relative; pointer-events: none; }
.feed-map.live { pointer-events: auto; }
.feed-map.fill { height: 100%; }
.m { position: absolute; inset: 0; }
.msg { height: 100%; display: flex; align-items: center; justify-content: center; font-size: 12.5px; color: var(--text-muted); }
</style>
