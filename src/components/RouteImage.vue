<script setup>
// Lightweight "map picture" for the phone feed cards: a few OSM tile <image>s with the
// route drawn over them in SVG (no Leaflet map), built when the card scrolls near the screen.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { routeFrame } from '../utils/routeThumbs'

const props = defineProps({ activity: { type: Object, required: true }, color: { type: String, default: '#7c3aed' } })
const store = useActivitiesStore()
const el = ref(null)
const frame = ref(null)
let io = null

onMounted(() => {
  const load = () => routeFrame(store, props.activity.id).then((f) => { frame.value = f })
  if (!('IntersectionObserver' in window)) return load()
  io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); io = null; load() } }, { rootMargin: '300px' })
  io.observe(el.value)
})
onBeforeUnmount(() => io && io.disconnect())
</script>

<template>
  <div ref="el" class="route-image">
    <svg v-if="frame" :viewBox="`0 0 ${frame.w} ${frame.h}`" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <image v-for="t in frame.tiles" :key="t.url" :href="t.url" :x="t.x" :y="t.y" :width="frame.tile" :height="frame.tile" class="gray-basemap-tiles tiles-osm" />
      <path :d="frame.d" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".85" />
      <path :d="frame.d" fill="none" :stroke="color" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </div>
</template>

<style scoped>
.route-image { aspect-ratio: 360 / 150; background: var(--surface-alt); overflow: hidden; }
.route-image svg { display: block; width: 100%; height: 100%; }
</style>
