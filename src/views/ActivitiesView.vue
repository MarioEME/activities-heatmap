<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useActivitiesStore, colorForType } from '../stores/activities'
import EditActivityModal from '../components/EditActivityModal.vue'
import ActivityDetail from '../components/ActivityDetail.vue'
import { t, intlLocale } from '../i18n'

const store = useActivitiesStore()
const sortKey = ref('date')
const sortDir = ref(-1)
const editingActivity = ref(null)
// On phones the table shrinks to a few columns and tapping a row opens the
// rest of that activity's details under its name (see the media query below;
// on wide screens every column is visible and this is invisible).
const expandedId = ref(null)
function toggleExpanded(id) {
  expandedId.value = expandedId.value === id ? null : id
}
// colspan of the detail row = the number of columns actually shown (phones
// hide most of them, see the media query below).
const isPhone = ref(false)
let mq = null
const onMq = () => { isPhone.value = mq.matches }
onMounted(() => { mq = window.matchMedia('(max-width: 720px)'); onMq(); mq.addEventListener('change', onMq) })
onBeforeUnmount(() => mq?.removeEventListener('change', onMq))
const tagNameById = computed(() => new Map(store.tagDefs.map((d) => [d.id, d.name])))

function sourceLabel(a) {
  return a.source === 'manual' ? t('common.manualGpx') : 'Strava'
}

function removeActivity(a) {
  if (window.confirm(t('act.confirmRemove', { name: a.name }))) {
    store.removeActivity(a.id)
  }
}

function tagNames(a) {
  return (a.tags || []).map((id) => tagNameById.value.get(id)).filter(Boolean)
}

function sortBy(key) {
  if (sortKey.value === key) sortDir.value *= -1
  else { sortKey.value = key; sortDir.value = key === 'date' ? -1 : 1 }
}

const rows = computed(() => {
  const list = [...store.filtered]
  const key = sortKey.value
  const dir = sortDir.value
  list.sort((a, b) => {
    let av = a[key]
    let bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (av instanceof Date) { av = av.getTime(); bv = bv.getTime() }
    if (typeof av === 'string') return av.localeCompare(bv, intlLocale()) * dir
    return (av - bv) * dir
  })
  return list
})

function fmtDuration(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`
}

const columns = [
  { key: 'date' },
  { key: 'name' },
  { key: 'type' },
  { key: 'tags', sortable: false },
  { key: 'source' },
  { key: 'distanceKm' },
  { key: 'elevationGain' },
  { key: 'movingTime' },
  { key: 'avgSpeedKmh' },
  { key: 'hasTrack' },
]
</script>

<template>
  <div class="activities-page">
    <div class="toolbar">
      <h2>{{ t('nav.activities') }}</h2>
      <span class="mono count">{{ t('common.xOfY', { x: rows.length, y: store.activities.length }) }}</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th v-for="col in columns" :key="col.key" @click="col.sortable !== false && sortBy(col.key)" :class="[`col-${col.key}`, { active: sortKey === col.key, 'no-sort': col.sortable === false }]">
              {{ t('act.col.' + col.key) }}
              <span v-if="sortKey === col.key" class="arrow">{{ sortDir === 1 ? '▲' : '▼' }}</span>
            </th>
            <th class="actions-head col-actions"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="a in rows" :key="a.id">
          <tr
            :class="{ expanded: expandedId === a.id }"
            @click="toggleExpanded(a.id)"
          >
            <td class="mono muted col-date">{{ a.dateLabel }}</td>
            <td class="name-cell col-name" :title="a.description || a.name">
              <span class="chev" aria-hidden="true">{{ expandedId === a.id ? '▾' : '▸' }}</span>{{ a.name }}
              <div v-if="expandedId === a.id" class="details" @click.stop>
                <div class="d-chips">
                  <span class="type-pill" :style="{ '--c': colorForType(a.type) }">{{ a.type }}</span>
                  <span class="source-pill" :class="a.source">{{ sourceLabel(a) }}</span>
                  <span v-for="n in tagNames(a)" :key="n" class="tag-pill">{{ n }}</span>
                </div>
                <p v-if="a.description" class="d-desc">{{ a.description }}</p>
                <div class="d-stats">
                  <div><span class="d-label">{{ t('act.distance') }}</span><span class="mono">{{ a.distanceKm != null ? a.distanceKm.toFixed(1) + ' km' : '—' }}</span></div>
                  <div><span class="d-label">{{ t('act.col.elevationGain') }}</span><span class="mono">{{ a.elevationGain != null ? Math.round(a.elevationGain) + ' m' : '—' }}</span></div>
                  <div><span class="d-label">{{ t('act.col.movingTime') }}</span><span class="mono">{{ fmtDuration(a.movingTime) }}</span></div>
                  <div><span class="d-label">{{ t('act.col.avgSpeedKmh') }}</span><span class="mono">{{ a.avgSpeedKmh != null ? a.avgSpeedKmh.toFixed(1) + ' km/h' : '—' }}</span></div>
                  <div><span class="d-label">GPS</span><span class="mono">{{ a.hasTrack ? t('common.yes') : t('common.no') }}</span></div>
                </div>
                <div class="d-actions">
                  <button class="d-btn" @click="editingActivity = a">✏️ {{ t('common.edit') }}</button>
                  <button class="d-btn" @click="removeActivity(a)">🗑️ {{ t('common.remove') }}</button>
                </div>
              </div>
            </td>
            <td class="col-type">
              <span class="type-pill" :style="{ '--c': colorForType(a.type) }">{{ a.type }}</span>
            </td>
            <td class="col-tags">
              <span v-if="!tagNames(a).length" class="muted">—</span>
              <span v-for="n in tagNames(a)" :key="n" class="tag-pill">{{ n }}</span>
            </td>
            <td class="col-source">
              <span class="source-pill" :class="a.source">{{ sourceLabel(a) }}</span>
            </td>
            <td class="mono col-distanceKm">{{ a.distanceKm != null ? a.distanceKm.toFixed(1) + ' km' : '—' }}</td>
            <td class="mono col-elevationGain">{{ a.elevationGain != null ? Math.round(a.elevationGain) + ' m' : '—' }}</td>
            <td class="mono col-movingTime">{{ fmtDuration(a.movingTime) }}</td>
            <td class="mono col-avgSpeedKmh">{{ a.avgSpeedKmh != null ? a.avgSpeedKmh.toFixed(1) + ' km/h' : '—' }}</td>
            <td class="gps-cell col-hasTrack">
              <span v-if="a.hasTrack" class="gps-yes" :title="t('act.hasGps')">●</span>
              <span v-else class="gps-no" :title="t('act.noGps')">–</span>
            </td>
            <td class="actions-cell col-actions">
              <button class="row-icon-btn" :title="t('act.editTitle')" @click.stop="editingActivity = a">✏️</button>
              <button class="row-icon-btn" :title="t('act.removeTitle')" @click.stop="removeActivity(a)">🗑️</button>
            </td>
          </tr>
          <tr v-if="expandedId === a.id" class="detail-row">
            <td :colspan="isPhone ? 3 : columns.length + 1">
              <ActivityDetail :activity="a" :key="a.id" />
            </td>
          </tr>
          </template>
        </tbody>
      </table>
      <p v-if="rows.length === 0" class="empty">{{ t('act.empty') }}</p>
    </div>

    <EditActivityModal
      v-if="editingActivity"
      :activity="editingActivity"
      @close="editingActivity = null"
    />
  </div>
</template>

<style scoped>
.activities-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 24px 32px 0;
}
.toolbar {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.toolbar h2 { font-size: 22px; }
.count { color: var(--text-muted); font-size: 12.5px; }

.table-wrap {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin-bottom: 24px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
thead th {
  position: sticky;
  top: 0;
  background: var(--surface);
  text-align: left;
  padding: 10px 14px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  cursor: pointer;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  user-select: none;
}
thead th.active { color: var(--accent-strong); }
.arrow { font-size: 9px; margin-left: 2px; }

tbody tr { border-bottom: 1px solid var(--surface-alt); }
tbody tr:hover { background: var(--surface-alt); }
td {
  padding: 9px 14px;
  color: var(--text-dim);
  white-space: nowrap;
}
.name-cell {
  color: var(--text);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.muted { color: var(--text-muted); }
thead th.no-sort { cursor: default; }
.tag-pill {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  margin-right: 4px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--surface-alt);
  color: var(--text-dim);
}

.type-pill {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 20px;
  color: var(--c);
  border: 1px solid var(--c);
  background: color-mix(in srgb, var(--c) 12%, transparent);
}

.gps-cell { text-align: center; }
.gps-yes { color: var(--accent-strong); }
.gps-no { color: var(--text-muted); }

.source-pill {
  display: inline-block;
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 20px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  background: var(--surface-alt);
}
.source-pill.strava { color: #FC5200; border-color: #FC5200; background: rgba(252, 82, 0, 0.08); }
.source-pill.manual { color: var(--text-dim); }

.actions-head { width: 1%; }
.actions-cell {
  white-space: nowrap;
  text-align: right;
}
.row-icon-btn {
  background: transparent;
  border: none;
  font-size: 13px;
  padding: 4px 6px;
  border-radius: 4px;
  line-height: 1;
}
.row-icon-btn:hover { background: var(--surface-alt); }

.empty {
  padding: 40px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* Wide screens: the details block and chevron are only for phones. */
/* Wide screens: the stats block is only for phones (every column is visible
   there); clicking a row opens the map + elevation profile under it. */
.details { display: none; }
.chev { display: inline-block; width: 14px; color: var(--text-muted); font-size: 10px; }
tbody tr { cursor: pointer; }
tbody tr.expanded { background: var(--surface-alt); }
tbody tr.detail-row { cursor: default; background: var(--surface-alt); }
tbody tr.detail-row:hover { background: var(--surface-alt); }
tbody tr.detail-row td { padding: 6px 14px 14px; white-space: normal; }

/* Phones: no sideways scrolling. Only date, name and distance stay as
   columns; tapping a row shows everything else under the name. */
@media (max-width: 720px) {
  .activities-page { padding: 14px 10px 0; }
  .toolbar { margin-bottom: 10px; }
  .table-wrap { margin-bottom: 12px; overflow-x: hidden; }
  table { table-layout: fixed; font-size: 13px; }

  .col-type, .col-tags, .col-source, .col-elevationGain,
  .col-movingTime, .col-avgSpeedKmh, .col-hasTrack, .col-actions { display: none; }

  th.col-date { width: 88px; }
  th.col-distanceKm { width: 72px; }
  thead th { padding: 9px 8px; letter-spacing: 0.04em; }
  td { padding: 10px 8px; }
  td.col-date { font-size: 12px; vertical-align: top; }
  td.col-distanceKm { font-size: 12.5px; vertical-align: top; text-align: right; }
  th.col-distanceKm { text-align: right; }

  .name-cell {
    max-width: none;
    white-space: normal;
    overflow: visible;
    overflow-wrap: anywhere;
    vertical-align: top;
  }
  .details { display: block; margin-top: 8px; cursor: default; }
  .d-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  .d-chips .tag-pill { margin-right: 0; }
  .d-desc { margin: 0 0 8px; font-size: 12px; color: var(--text-dim); line-height: 1.45; white-space: pre-line; }
  .d-stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px 10px;
    margin-bottom: 10px;
  }
  .d-stats > div { display: flex; flex-direction: column; min-width: 0; }
  .d-label { font-size: 10.5px; color: var(--text-muted); }
  .d-stats .mono { font-size: 12.5px; color: var(--text); }
  .d-actions { display: flex; gap: 8px; }
  .d-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 12px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
  }
  .d-btn:hover { border-color: var(--accent); color: var(--accent-strong); }
  tbody tr.detail-row td { padding: 4px 8px 12px; }
}
</style>
