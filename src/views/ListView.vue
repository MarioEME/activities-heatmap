<script setup>
// List tab (wide screens): every activity as a plain sortable table.
import { ref, computed, watch } from 'vue'
import { useActivitiesStore, colorForType } from '../stores/activities'
import EditActivityModal from '../components/EditActivityModal.vue'
import Icon from '../components/Icon.vue'
import { fmtAvgPace } from '../utils/sport'
import { useInfiniteList } from '../utils/infiniteList'
import { t, intlLocale } from '../i18n'

const store = useActivitiesStore()
const sortKey = ref('date')
const sortDir = ref(-1)
const editing = ref(null)
const tagNameById = computed(() => new Map(store.tagDefs.map((d) => [d.id, d.name])))
const tagNames = (a) => (a.tags || []).map((id) => tagNameById.value.get(id)).filter(Boolean)
const sourceLabel = (a) => (a.source === 'manual' ? t('common.manualGpx') : 'Strava')

function removeActivity(a) {
  if (window.confirm(t('act.confirmRemove', { name: a.name }))) store.removeActivity(a.id)
}
function sortBy(key) {
  if (key === 'tags') return
  if (sortKey.value === key) sortDir.value *= -1
  else { sortKey.value = key; sortDir.value = key === 'date' ? -1 : 1 }
}

const rows = computed(() => {
  const list = [...store.activities]
  const key = sortKey.value
  const dir = sortDir.value
  list.sort((a, b) => {
    let av = a[key], bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (av instanceof Date) { av = av.getTime(); bv = bv.getTime() }
    if (typeof av === 'string') return av.localeCompare(bv, intlLocale()) * dir
    return (av - bv) * dir
  })
  return list
})
const { limit, sentinel, reset } = useInfiniteList(computed(() => rows.value.length), 80)
const visible = computed(() => rows.value.slice(0, limit.value))
watch([sortKey, sortDir], reset)

function fmtDuration(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`
}
const columns = ['date', 'name', 'type', 'tags', 'source', 'distanceKm', 'elevationGain', 'movingTime', 'elapsedTime', 'avgSpeedKmh']
</script>

<template>
  <div class="list-page">
    <div class="toolbar">
      <h2>{{ t('nav.list') }}</h2>
      <span class="mono count">{{ rows.length }}</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th v-for="c in columns" :key="c" :class="[`col-${c}`, { active: sortKey === c, 'no-sort': c === 'tags' }]" @click="sortBy(c)">
              {{ t('act.col.' + c) }}<span v-if="sortKey === c" class="arrow">{{ sortDir === 1 ? '▲' : '▼' }}</span>
            </th>
            <th class="actions-head"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in visible" :key="a.id">
            <td class="mono muted col-date">{{ a.dateLabel }}</td>
            <td class="name-cell" :title="a.description || a.name">{{ a.name }}</td>
            <td><span class="type-pill" :style="{ '--c': colorForType(a.type) }">{{ a.type }}</span></td>
            <td>
              <span v-if="!tagNames(a).length" class="muted">—</span>
              <span v-for="n in tagNames(a)" :key="n" class="tag-pill">{{ n }}</span>
            </td>
            <td><span class="source-pill" :class="a.source">{{ sourceLabel(a) }}</span></td>
            <td class="mono num">{{ a.distanceKm != null ? a.distanceKm.toFixed(1) + ' km' : '—' }}</td>
            <td class="mono num">{{ a.elevationGain != null ? Math.round(a.elevationGain) + ' m' : '—' }}</td>
            <td class="mono num">{{ fmtDuration(a.movingTime) }}</td>
            <td class="mono num">{{ fmtDuration(a.elapsedTime) }}</td>
            <td class="mono num">{{ fmtAvgPace(a) }}</td>
            <td class="actions-cell">
              <button v-if="a.hasTrack" class="row-icon-btn" :title="t('act.showOnMap')" @click="store.focusOnMap(a.id)"><Icon name="map" :size="16" /></button>
              <button class="row-icon-btn" :title="t('act.editTitle')" @click="editing = a"><Icon name="edit" :size="16" /></button>
              <button class="row-icon-btn" :title="t('act.removeTitle')" @click="removeActivity(a)"><Icon name="trash" :size="16" /></button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!rows.length" class="empty">{{ t('act.empty') }}</p>
    </div>
    <div ref="sentinel" class="sentinel"></div>

    <EditActivityModal v-if="editing" :activity="editing" @close="editing = null" />
  </div>
</template>

<style scoped>
.list-page { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 24px 32px 0; }
.toolbar { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; }
.toolbar h2 { font-size: 22px; }
.count { color: var(--text-muted); font-size: 12.5px; }
.table-wrap { border: 1px solid var(--border); border-radius: var(--radius-md); margin-bottom: 24px; overflow-x: auto; background: var(--surface); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
thead th {
  position: sticky; top: 0; z-index: 1; background: var(--surface); text-align: left; padding: 10px 12px;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted);
  border-bottom: 1px solid var(--border); white-space: nowrap; cursor: pointer; user-select: none;
}
thead th.no-sort { cursor: default; }
thead th.active { color: var(--accent-strong); }
.arrow { margin-left: 4px; font-size: 9px; }
tbody tr { border-bottom: 1px solid var(--surface-alt); }
tbody tr:hover { background: var(--surface-alt); }
td { padding: 7px 12px; color: var(--text-dim); vertical-align: middle; }
.muted { color: var(--text-muted); }
.col-date { white-space: nowrap; }
.name-cell { color: var(--text); font-weight: 500; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.num { text-align: right; white-space: nowrap; }
thead th.col-distanceKm, thead th.col-elevationGain, thead th.col-movingTime, thead th.col-elapsedTime, thead th.col-avgSpeedKmh { text-align: right; }
.type-pill { display: inline-block; font-size: 11px; padding: 1px 9px; border-radius: 10px; color: var(--c); border: 1px solid var(--c); white-space: nowrap; }
.tag-pill { display: inline-block; font-size: 11px; background: var(--surface-alt); border-radius: 10px; padding: 1px 8px; margin-right: 4px; color: var(--text-dim); }
.source-pill { font-size: 11px; color: var(--text-muted); }
.source-pill.strava { color: #FC5200; }
.actions-head { width: 1%; }
.actions-cell { text-align: right; white-space: nowrap; }
.row-icon-btn { background: transparent; border: none; color: var(--text-dim); padding: 5px; border-radius: 4px; cursor: pointer; line-height: 0; }
.row-icon-btn:hover { background: var(--surface-alt); color: var(--accent-strong); }
.empty { padding: 32px; text-align: center; color: var(--text-muted); font-size: 13px; }
</style>
