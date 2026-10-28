<script setup>
// Phones, Map tab: a horizontal strip of small cards under the map, one per
// drawn activity, to pick routes that overlap and are hard to tap on the map.
import { watch, ref, nextTick } from 'vue'
import { t } from '../i18n'
import { colorForType } from '../stores/activities'

const props = defineProps({
  items: { type: Array, required: true },
  selectedId: { default: null },
})
const emit = defineEmits(['select'])
const el = ref(null)

watch(() => props.selectedId, async (id) => {
  if (id == null) return
  await nextTick()
  const card = el.value?.querySelector('.card.selected')
  card?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
})
</script>

<template>
  <div ref="el" class="strip" role="listbox" :aria-label="t('map.listTitle')">
    <button
      v-for="a in items"
      :key="a.id"
      type="button"
      class="card"
      :class="{ selected: a.id === selectedId }"
      role="option"
      :aria-selected="a.id === selectedId"
      @click="emit('select', a)"
    >
      <span class="bar" :style="{ background: colorForType(a.type) }"></span>
      <span class="title">{{ a.name }}</span>
      <span class="when mono">{{ a.dateLabel }}</span>
      <span class="nums mono">
        {{ a.distanceKm != null ? a.distanceKm.toFixed(1) + ' km' : '—' }} ·
        {{ a.elevationGain != null ? Math.round(a.elevationGain) + ' m' : '—' }}
      </span>
    </button>
    <div v-if="!items.length" class="empty">{{ t('map.listEmpty') }}</div>
  </div>
</template>

<style scoped>
.strip {
  display: none;
  flex-shrink: 0;
  gap: 6px;
  padding: 6px 8px;
  overflow-x: auto;
  overflow-y: hidden;
  background: var(--surface);
  border-top: 1px solid var(--border-strong);
  scroll-snap-type: x proximity;
  -webkit-overflow-scrolling: touch;
}
@media (max-width: 720px) { .strip { display: flex; } }
.card {
  position: relative;
  flex: 0 0 158px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 6px 8px 6px 11px;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font: inherit;
  cursor: pointer;
  scroll-snap-align: center;
  content-visibility: auto;
  contain-intrinsic-size: 158px 58px;
}
.card.selected { border-color: var(--accent); background: var(--accent-soft); }
.bar { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; border-radius: 4px 0 0 4px; }
.title { font-size: 12.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.when { font-size: 10.5px; color: var(--text-muted); white-space: nowrap; }
.nums { font-size: 11px; color: var(--text-dim); white-space: nowrap; }
.empty { padding: 10px; font-size: 12px; color: var(--text-muted); }
</style>
