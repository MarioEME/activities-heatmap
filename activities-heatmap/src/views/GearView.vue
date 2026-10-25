<script setup>
import { ref, computed } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { t, intlLocale, fmtDate as fmtLocDate, fmtTime } from '../i18n'

const store = useActivitiesStore()
const showAll = ref(false)
const sortKey = ref('lastUsed')
const sortDir = ref(-1)

const newName = ref('')
const message = ref('')
const recalculating = ref(false)
// id -> text being typed, so a half-edited name doesn't write through on every keystroke
const drafts = ref({})
// Phones: the table keeps name / activities / distance and tapping a row shows
// the rest under the name (see the media query below; invisible on wide screens).
const expandedId = ref(null)
function toggleExpanded(id) {
  expandedId.value = expandedId.value === id ? null : id
}

function say(text) {
  message.value = text
  setTimeout(() => { if (message.value === text) message.value = '' }, 4000)
}

function sortBy(key) {
  if (sortKey.value === key) sortDir.value *= -1
  else { sortKey.value = key; sortDir.value = key === 'name' ? 1 : -1 }
}

const rows = computed(() => {
  const all = store.gearRows
  const list = showAll.value ? all : all.filter((g) => g.active)
  const key = sortKey.value
  const dir = sortDir.value
  return [...list].sort((a, b) => {
    let av = a[key]
    let bv = b[key]
    if (av instanceof Date || bv instanceof Date) {
      av = av ? av.getTime() : 0
      bv = bv ? bv.getTime() : 0
    }
    if (typeof av === 'string') return av.localeCompare(bv, intlLocale()) * dir
    return ((av ?? 0) - (bv ?? 0)) * dir
  })
})

const retiredCount = computed(() => store.gearRows.filter((g) => !g.active).length)

// "totals not calculated yet" / "out of date" / "calculated on …"
const totalsStatus = computed(() => {
  if (!store.gearDefs.length) return null
  const at = store.gearMeta.recalculatedAt
  if (!at) return { stale: true, text: t('gear.statusNone') }
  if (store.gearMeta.dirty) return { stale: true, text: t('gear.statusStale') }
  const d = new Date(at)
  return {
    stale: false,
    text: t('gear.statusAt', { when: `${fmtLocDate(d)} ${fmtTime(d)}` }),
  }
})

async function recalculate() {
  recalculating.value = true
  try {
    await store.recalculateGear()
  } finally {
    recalculating.value = false
  }
}

async function add() {
  const name = newName.value.trim()
  if (!name) return
  if (store.gearDefs.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
    say(t('gear.exists', { name }))
    return
  }
  await store.addGear(name)
  newName.value = ''
  showAll.value = true // a brand-new item has no activities yet; make sure it is visible
}

async function commitRename(g) {
  const draft = drafts.value[g.id]
  delete drafts.value[g.id]
  if (draft == null || draft.trim() === g.name) return
  const ok = await store.renameGear(g.id, draft)
  if (!ok) say(draft.trim() ? t('gear.exists', { name: draft.trim() }) : t('gear.emptyName'))
}

function cancelRename(g) {
  delete drafts.value[g.id]
}

async function remove(g) {
  const used = store.activities.filter((a) => a.gearId === g.id).length
  const detail = used
    ? t('gear.deleteUsed', { n: used }, used)
    : t('gear.deleteUnused')
  if (window.confirm(t('gear.confirmDelete', { name: g.name, detail }))) {
    await store.deleteGear(g.id)
  }
}

function fmtDuration(sec) {
  if (sec == null) return '—'
  if (!sec) return `0${t('unit.min')}`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}${t('unit.min')}`
}
function fmtDate(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : '—'
}
const fmtCount = (v) => (v == null ? '—' : v)
const fmtKm = (v) => (v == null ? '—' : `${v.toFixed(0)} km`)
const fmtM = (v) => (v == null ? '—' : `${Math.round(v)} m`)

const columns = ['name', 'count', 'distanceKm', 'movingTime', 'elevationGain', 'lastUsed']
</script>

<template>
  <div class="gear-page">
    <div class="toolbar">
      <h2>{{ t('nav.gear') }}</h2>
      <span class="mono count">{{ t('common.xOfY', { x: rows.length, y: store.gearDefs.length }) }}</span>
      <label class="show-all-toggle">
        <input type="checkbox" v-model="showAll" />
        <span>{{ t('gear.showAll') }}{{ retiredCount ? ` (${t('gear.moreInactive', { n: retiredCount })})` : '' }}</span>
      </label>
    </div>

    <div class="actions-bar">
      <form class="add-row" @submit.prevent="add">
        <input v-model="newName" type="text" maxlength="60" :placeholder="t('gear.newPlaceholder')" :aria-label="t('gear.newLabel')" />
        <button class="btn" type="submit" :disabled="!newName.trim()">{{ t('gear.add') }}</button>
      </form>
      <div class="recalc">
        <button
          class="btn"
          :class="{ primary: totalsStatus?.stale }"
          :disabled="recalculating || !store.gearDefs.length"
          :title="t('gear.recalcTitle')"
          @click="recalculate"
        >{{ recalculating ? t('gear.calculating') : '↻ ' + t('gear.recalc') }}</button>
        <span v-if="totalsStatus" class="mono totals-status" :class="{ stale: totalsStatus.stale }">{{ totalsStatus.text }}</span>
      </div>
    </div>
    <p v-if="message" class="message">{{ message }}</p>

    <div class="table-wrap">
      <table v-if="rows.length">
        <thead>
          <tr>
            <th v-for="col in columns" :key="col" @click="sortBy(col)" :class="[`col-${col}`, { active: sortKey === col }]">
              {{ t('gear.col.' + col) }}
              <span v-if="sortKey === col" class="arrow">{{ sortDir === 1 ? '▲' : '▼' }}</span>
            </th>
            <th class="actions-head col-actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="g in rows"
            :key="g.id"
            :class="{ expanded: expandedId === g.id }"
            @click="toggleExpanded(g.id)"
          >
            <td class="name-cell col-name">
              <div class="name-line">
                <span class="chev" aria-hidden="true">{{ expandedId === g.id ? '▾' : '▸' }}</span>
                <input
                  class="name-input"
                  type="text"
                  maxlength="60"
                  :value="drafts[g.id] ?? g.name"
                  :aria-label="t('gear.nameOf', { name: g.name })"
                  @click.stop
                  @input="drafts[g.id] = $event.target.value"
                  @keydown.enter.prevent="$event.target.blur()"
                  @keydown.esc.prevent="cancelRename(g); $event.target.blur()"
                  @blur="commitRename(g)"
                />
                <span v-if="!g.active" class="retired-badge badge-wide">{{ t('gear.inactive') }}</span>
              </div>
              <div v-if="expandedId === g.id" class="details" @click.stop>
                <span v-if="!g.active" class="retired-badge">{{ t('gear.inactive') }}</span>
                <div class="d-stats">
                  <div><span class="d-label">{{ t('gear.col.movingTime') }}</span><span class="mono">{{ fmtDuration(g.movingTime) }}</span></div>
                  <div><span class="d-label">{{ t('gear.col.elevationGain') }}</span><span class="mono">{{ fmtM(g.elevationGain) }}</span></div>
                  <div class="wide"><span class="d-label">{{ t('gear.col.lastUsed') }}</span><span class="mono">{{ fmtDate(g.lastUsed) }}</span></div>
                </div>
                <button class="d-btn" @click="remove(g)">🗑️ {{ t('gear.delete') }}</button>
              </div>
            </td>
            <td class="mono col-count">{{ fmtCount(g.count) }}</td>
            <td class="mono col-distanceKm">{{ fmtKm(g.distanceKm) }}</td>
            <td class="mono col-movingTime">{{ fmtDuration(g.movingTime) }}</td>
            <td class="mono col-elevationGain">{{ fmtM(g.elevationGain) }}</td>
            <td class="mono muted col-lastUsed">{{ fmtDate(g.lastUsed) }}</td>
            <td class="actions-cell col-actions">
              <button class="row-icon-btn" :title="t('gear.deleteTitle')" @click.stop="remove(g)">🗑️</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">
        {{ store.gearDefs.length ? t('gear.emptyInactive') : t('gear.emptyNone') }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.gear-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 24px 32px 0;
}
.toolbar {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 12px;
}
.toolbar h2 { font-size: 22px; }
.count { color: var(--text-muted); font-size: 12.5px; }
.show-all-toggle {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-dim);
  cursor: pointer;
}

.actions-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  margin-bottom: 8px;
}
.add-row { display: flex; gap: 8px; flex: 1 1 260px; max-width: 420px; }
.add-row input,
.name-input {
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
  font-size: 13.5px;
  font-family: inherit;
  padding: 8px 11px;
}
.add-row input { flex: 1; min-width: 0; }
.add-row input:focus,
.name-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--surface-alt);
}
.recalc { display: flex; align-items: center; gap: 12px; }
.totals-status { font-size: 11.5px; color: var(--text-muted); }
.totals-status.stale { color: var(--accent-strong); }
.message { font-size: 12.5px; color: var(--danger); margin: 0 0 8px; }

.btn {
  padding: 8px 14px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text-dim);
  white-space: nowrap;
}
.btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent-strong); }
.btn.primary { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.btn.primary:hover:not(:disabled) { background: var(--accent-strong); color: var(--on-accent); }
.btn:disabled { opacity: 0.55; cursor: default; }

.table-wrap {
  flex: 1;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  margin: 8px 0 24px;
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
thead th.col-actions { cursor: default; }
.arrow { font-size: 9px; margin-left: 2px; }

tbody tr { border-bottom: 1px solid var(--surface-alt); }
tbody tr:hover { background: var(--surface-alt); }
td {
  padding: 6px 14px;
  color: var(--text-dim);
  white-space: nowrap;
}
.name-cell { color: var(--text); min-width: 220px; }
.muted { color: var(--text-muted); }

/* The name is edited in place: looks like text until hovered/focused. */
.name-line { display: flex; align-items: center; gap: 6px; }
.name-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border-color: transparent;
  text-overflow: ellipsis;
}
.name-input:hover { border-color: var(--border); }

.retired-badge {
  flex-shrink: 0;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  background: var(--surface-alt);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 1px 8px;
}

.actions-head { width: 1%; }
.actions-cell { text-align: right; white-space: nowrap; }
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
.details, .chev { display: none; }

/* Phones: no sideways scrolling — name, activities and distance stay as
   columns, tapping a row shows the rest under the name. */
@media (max-width: 720px) {
  .gear-page { padding: 14px 10px 0; }
  .toolbar { flex-wrap: wrap; gap: 4px 12px; margin-bottom: 8px; }
  .show-all-toggle { margin-left: 0; flex: 0 0 100%; }
  .actions-bar { gap: 8px; }
  .add-row { flex: 1 1 100%; max-width: none; }
  .table-wrap { margin-bottom: 12px; overflow-x: hidden; }
  table { table-layout: fixed; }

  .col-movingTime, .col-elevationGain, .col-lastUsed, .col-actions { display: none; }
  th.col-count { width: 92px; text-align: right; }
  th.col-distanceKm { width: 88px; text-align: right; }
  thead th { padding: 9px 8px; letter-spacing: 0.02em; font-size: 10.5px; }
  td { padding: 8px 8px; vertical-align: top; }
  td.col-count, td.col-distanceKm { text-align: right; font-size: 12.5px; padding-top: 14px; }
  .name-cell { min-width: 0; white-space: normal; }

  tbody tr { cursor: pointer; }
  tbody tr.expanded { background: var(--surface-alt); }
  .chev { display: inline-block; width: 14px; color: var(--text-muted); font-size: 10px; flex-shrink: 0; }
  .name-input { padding: 6px 4px; }
  .badge-wide { display: none; } /* on phones the badge moves into the details so the name keeps its width */

  .details { display: block; margin: 6px 0 4px 14px; cursor: default; }
  .d-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 10px; margin-bottom: 10px; }
  .d-stats > div { display: flex; flex-direction: column; min-width: 0; }
  .d-stats > .wide { grid-column: 1 / -1; }
  .details .retired-badge { display: inline-block; margin-bottom: 8px; }
  .d-label { font-size: 10.5px; color: var(--text-muted); }
  .d-stats .mono { font-size: 12.5px; color: var(--text); }
  .d-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text-dim);
    font-size: 12px;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
  }
}
</style>
