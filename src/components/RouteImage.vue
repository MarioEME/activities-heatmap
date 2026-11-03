<script setup>
// Lightweight route picture for the phone feed cards: just an SVG path (no map
// tiles, no Leaflet), loaded when the card scrolls near the screen.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { routeThumb } from '../utils/routeThumbs'

const props = defineProps({ activity: { type: Object, required: true }, color: { type: String, default: '#7c3aed' } })
const store = useActivitiesStore()
const el = ref(null)
const path = ref(null)
let io = null

onMounted(() => {
  const load = () => routeThumb(store, props.activity.id).then((p) => { path.value = p })
  if (!('IntersectionObserver' in window)) return load()
  io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); io = null; load() } }, { rootMargin: '300px' })
  io.observe(el.value)
})
onBeforeUnmount(() => io && io.disconnect())
</script>

<template>
  <div ref="el" class="route-image">
    <svg v-if="path" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path :d="path" fill="none" :stroke="color" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
    </svg>
  </div>
</template>

<style scoped>
.route-image { height: 150px; background: var(--surface-alt); display: flex; align-items: center; justify-content: center; }
.route-image svg { height: 100%; width: auto; max-width: 100%; padding: 6px; box-sizing: border-box; }
</style>
