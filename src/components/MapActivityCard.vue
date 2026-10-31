<script setup>
// One activity as a card with a small drawing of its route: used by the
// vertical list (desktop) and the horizontal strip (phones) of the Map tab.
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useActivitiesStore, colorForType } from '../stores/activities'
import { routeThumb } from '../utils/routeThumbs'

const props = defineProps({ activity: { type: Object, required: true }, selected: Boolean })
const store = useActivitiesStore()
const el = ref(null)
const path = ref(null)
let io = null

onMounted(() => {
  if (!props.activity.hasTrack) return
  io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return
    io.disconnect()
    io = null
    routeThumb(store, props.activity.id).then((p) => { path.value = p })
  }, { rootMargin: '200px' })
  io.observe(el.value)
})
onBeforeUnmount(() => io?.disconnect())
</script>

<template>
  <button ref="el" type="button" class="mcard" :class="{ selected }" role="option" :aria-selected="selected" :title="activity.name">
    <span class="thumb" aria-hidden="true">
      <svg v-if="path" viewBox="0 0 100 100"><path :d="path" fill="none" :stroke="colorForType(activity.type)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </span>
    <span class="txt">
      <span class="name">{{ activity.name }}</span>
      <span class="when mono">{{ activity.dateLabel }}</span>
      <span class="nums mono">
        {{ activity.distanceKm != null ? activity.distanceKm.toFixed(1) + ' km' : '—' }} ·
        {{ activity.elevationGain != null ? Math.round(activity.elevationGain) + ' D+' : '—' }}
      </span>
    </span>
  </button>
</template>

<style scoped>
.mcard {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px 7px 7px;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font: inherit;
  color: var(--text);
  cursor: pointer;
  /* long lists: only lay out what is on screen */
  content-visibility: auto;
  contain-intrinsic-size: auto 66px;
}
.mcard:hover { background: var(--surface-alt); }
.mcard.selected { border-color: var(--accent); background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
.thumb {
  flex: 0 0 52px;
  width: 52px;
  height: 52px;
  border-radius: var(--radius-sm);
  background: var(--surface-alt);
  overflow: hidden;
}
.thumb svg { display: block; width: 100%; height: 100%; }
.txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.name { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.when { font-size: 10.5px; color: var(--text-muted); white-space: nowrap; }
.nums { font-size: 11px; color: var(--text-dim); white-space: nowrap; }
</style>
