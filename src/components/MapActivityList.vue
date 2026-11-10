<script setup>
// Desktop sidebar of the Map tab: the activities currently drawn on the map
// (same records as the map, so the filters apply), reduced to date, name,
// distance and climb. Clicking a row selects that route on the map.
import { watch, ref, computed, nextTick } from 'vue'
import { t } from '../i18n'
import Icon from './Icon.vue'
import MapActivityCard from './MapActivityCard.vue'
import { mapListCollapsed, toggleMapList } from '../utils/viewPrefs'

const props = defineProps({
  items: { type: Array, required: true },
  selectedId: { default: null },
})
const emit = defineEmits(['select', 'center'])

const listEl = ref(null)
// thousands of rows would mean thousands of DOM nodes: render 150 and add more while scrolling
const STEP = 150
const shown = ref(STEP)
const visible = computed(() => props.items.slice(0, shown.value))
watch(() => props.items, () => { shown.value = STEP })
function onScroll(e) {
  const el = e.target
  if (shown.value < props.items.length && el.scrollTop + el.clientHeight > el.scrollHeight - 400) shown.value += STEP
}

// a route picked on the map (not in the list) should be visible in the list too
watch(() => props.selectedId, async (id) => {
  if (id == null || mapListCollapsed.value) return
  const idx = props.items.findIndex((a) => a.id === id)
  if (idx >= shown.value) shown.value = idx + 20
  await nextTick()
  listEl.value?.querySelector('.mcard.selected')?.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <div class="map-list-slot" :class="{ collapsed: mapListCollapsed }">
  <aside class="map-list" :class="{ collapsed: mapListCollapsed }" :aria-label="t('map.listTitle')">
    <header class="head">
      <strong class="title">{{ t('map.listTitle') }}</strong>
      <span v-if="!mapListCollapsed" class="count mono">{{ items.length }}</span>
      <button
        class="head-btn"
        :title="mapListCollapsed ? t('map.listShow') : t('map.listHide')"
        :aria-expanded="!mapListCollapsed"
        @click="toggleMapList"
      ><Icon :name="mapListCollapsed ? 'chevron-right' : 'chevron-left'" :size="16" /></button>
    </header>
    <div v-show="!mapListCollapsed" ref="listEl" class="rows" role="listbox" @scroll.passive="onScroll">
      <MapActivityCard
        v-for="a in visible"
        :key="a.id"
        :activity="a"
        :selected="a.id === selectedId"
        @click="emit('select', a)"
        @dblclick="emit('center', a)"
      />
      <div v-if="!items.length" class="empty">{{ t('map.listEmpty') }}</div>
    </div>
  </aside>
  </div>
</template>

<style scoped>
.map-list-slot { position: relative; flex: 0 0 330px; transition: flex-basis 0.18s ease; }
.map-list-slot.collapsed { flex-basis: 40px; }
/* absolutely placed so the list never makes the page taller: it scrolls on its own */
.map-list {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--surface);
  border-right: 1px solid var(--border-strong);
  transition: flex-basis 0.18s ease;
  overflow: hidden;
}
.map-list.collapsed { flex-basis: 40px; }
.head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 6px 8px 12px;
  border-bottom: 1px solid var(--surface-alt);
  flex-shrink: 0;
}
.title { font-size: 13px; color: var(--text); }
.count { font-size: 11px; color: var(--text-muted); flex: 1; }
.head-btn {
  background: transparent;
  border: none;
  color: var(--text-dim);
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 0;
}
.head-btn:hover { background: var(--surface-alt); color: var(--text); }
.collapsed .head {
  flex-direction: column-reverse;
  padding: 8px 0;
  gap: 10px;
  border-bottom: none;
  flex: 1;
}
.collapsed .title { writing-mode: vertical-rl; transform: rotate(180deg); flex: 1; }
.rows { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px; }
.empty { padding: 20px 12px; font-size: 12.5px; color: var(--text-muted); text-align: center; }
@media (max-width: 720px) { .map-list-slot { display: none; } }
</style>
