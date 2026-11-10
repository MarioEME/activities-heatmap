<script setup>
// Phones, Map tab: a horizontal strip of small cards under the map, one per
// drawn activity, to pick routes that overlap and are hard to tap on the map.
import { watch, ref, computed, nextTick } from 'vue'
import { t } from '../i18n'
import MapActivityCard from './MapActivityCard.vue'

const props = defineProps({
  items: { type: Array, required: true },
  selectedId: { default: null },
})
const emit = defineEmits(['select', 'center'])
const el = ref(null)
const STEP = 60
const shown = ref(STEP)
const visible = computed(() => props.items.slice(0, shown.value))
watch(() => props.items, () => { shown.value = STEP })
function onScroll(e) {
  const x = e.target
  if (shown.value < props.items.length && x.scrollLeft + x.clientWidth > x.scrollWidth - 600) shown.value += STEP
}

watch(() => props.selectedId, async (id) => {
  if (id == null) return
  const idx = props.items.findIndex((a) => a.id === id)
  if (idx >= shown.value) shown.value = idx + 10
  await nextTick()
  const card = el.value?.querySelector('.mcard.selected')
  card?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
})
</script>

<template>
  <div ref="el" class="strip" role="listbox" :aria-label="t('map.listTitle')" @scroll.passive="onScroll">
    <MapActivityCard
      v-for="a in visible"
      :key="a.id"
      class="strip-card"
      :activity="a"
      :selected="a.id === selectedId"
      @click="emit('select', a)"
      @dblclick="emit('center', a)"
    />
    <div v-if="!items.length" class="empty">{{ t('map.listEmpty') }}</div>
  </div>
</template>

<style scoped>
.strip {
  display: none;
  flex-shrink: 0;
  gap: 6px;
  padding: 5px 8px;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--surface);
  border-top: 1px solid var(--border-strong);
  scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;
}
@media (max-width: 720px) { .strip { display: flex; } }
.strip .strip-card { flex: 0 0 214px; width: 214px; scroll-snap-align: center; }
.empty { padding: 10px; font-size: 12px; color: var(--text-muted); }
</style>
