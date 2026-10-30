<script setup>
// Desktop sidebar of the Map tab: the activities currently drawn on the map
// (same records as the map, so the filters apply), reduced to date, name,
// distance and climb. Clicking a row selects that route on the map.
import { watch, ref, nextTick } from 'vue'
import { t } from '../i18n'
import Icon from './Icon.vue'
import { mapListCollapsed, toggleMapList } from '../utils/viewPrefs'

const props = defineProps({
  items: { type: Array, required: true },
  selectedId: { default: null },
})
const emit = defineEmits(['select'])

const listEl = ref(null)

// a route picked on the map (not in the list) should be visible in the list too
watch(() => props.selectedId, async (id) => {
  if (id == null || mapListCollapsed.value) return
  await nextTick()
  listEl.value?.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' })
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
    <div v-show="!mapListCollapsed" ref="listEl" class="rows" role="listbox">
      <div class="cols mono">
        <span>{{ t('act.col.date') }}</span>
        <span>{{ t('act.col.name') }}</span>
        <span class="num">km</span>
        <span class="num">D+</span>
      </div>
      <button
        v-for="a in items"
        :key="a.id"
        type="button"
        class="row"
        :class="{ selected: a.id === selectedId }"
        role="option"
        :aria-selected="a.id === selectedId"
        :title="a.name"
        @click="emit('select', a)"
      >
        <span class="date mono">{{ a.dateLabel }}</span>
        <span class="name">{{ a.name }}</span>
        <span class="num mono">{{ a.distanceKm != null ? a.distanceKm.toFixed(1) : '—' }}</span>
        <span class="num mono">{{ a.elevationGain != null ? Math.round(a.elevationGain) : '—' }}</span>
      </button>
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
  flex-direction: column;
  padding: 8px 0;
  gap: 10px;
  border-bottom: none;
  flex: 1;
}
.collapsed .title { writing-mode: vertical-rl; transform: rotate(180deg); flex: 1; }
.rows { flex: 1; min-height: 0; overflow-y: auto; }
.cols, .row {
  display: grid;
  grid-template-columns: 74px minmax(0, 1fr) 42px 42px;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  width: 100%;
}
.cols {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--surface);
  font-size: 10.5px;
  color: var(--text-muted);
  height: 24px;
  border-bottom: 1px solid var(--surface-alt);
}
.row {
  height: 30px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--surface-alt);
  font: inherit;
  font-size: 12px;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  /* long lists: only lay out what is on screen */
  content-visibility: auto;
  contain-intrinsic-size: auto 30px;
}
.row:hover { background: var(--surface-alt); }
.row.selected { background: var(--accent-soft); box-shadow: inset 3px 0 0 var(--accent); }
.date { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num { text-align: right; font-size: 11.5px; color: var(--text-dim); }
.empty { padding: 20px 12px; font-size: 12.5px; color: var(--text-muted); text-align: center; }
@media (max-width: 720px) { .map-list-slot { display: none; } }
</style>
