<script setup>
import { ref, computed } from 'vue'
import { useActivitiesStore, colorForType } from '../stores/activities'
import { t, fmtDate, fmtTime } from '../i18n'

const store = useActivitiesStore()
// Phones: only date and name stay as columns; tapping a row shows the rest
// (and the restore button) under the name. Invisible on wide screens.
const expandedId = ref(null)
function toggleExpanded(id) {
  expandedId.value = expandedId.value === id ? null : id
}

const rows = computed(() => {
  return [...store.trash].sort((a, b) => {
    const at = a.deletedAt ? new Date(a.deletedAt).getTime() : 0
    const bt = b.deletedAt ? new Date(b.deletedAt).getTime() : 0
    return bt - at
  })
})

function sourceLabel(a) {
  return a.source === 'manual' ? t('common.manualGpx') : 'Strava'
}

function deletedLabel(a) {
  if (!a.deletedAt) return '—'
  const d = new Date(a.deletedAt)
  return `${fmtDate(d)} ${fmtTime(d)}`
}

function restore(a) {
  store.restoreActivity(a.id)
}
</script>

<template>
  <div class="trash-page">
    <div class="toolbar">
      <h2>{{ t('nav.trash') }}</h2>
      <span class="mono count">{{ t('trash.count', { n: rows.length }, rows.length) }}</span>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="col-deleted">{{ t('trash.removedAt') }}</th>
            <th class="col-date">{{ t('act.col.date') }}</th>
            <th class="col-name">{{ t('act.col.name') }}</th>
            <th class="col-type">{{ t('act.col.type') }}</th>
            <th class="col-source">{{ t('act.col.source') }}</th>
            <th class="actions-head col-actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="a in rows"
            :key="a.id"
            :class="{ expanded: expandedId === a.id }"
            @click="toggleExpanded(a.id)"
          >
            <td class="mono muted col-deleted">{{ deletedLabel(a) }}</td>
            <td class="mono muted col-date">{{ a.dateLabel }}</td>
            <td class="name-cell col-name" :title="a.description || a.name">
              <span class="chev" aria-hidden="true">{{ expandedId === a.id ? '▾' : '▸' }}</span>{{ a.name }}
              <div v-if="expandedId === a.id" class="details" @click.stop>
                <div class="d-chips">
                  <span class="type-pill" :style="{ '--c': colorForType(a.type) }">{{ a.type }}</span>
                  <span class="source-pill" :class="a.source">{{ sourceLabel(a) }}</span>
                </div>
                <p v-if="a.description" class="d-desc">{{ a.description }}</p>
                <div class="d-stats">
                  <div><span class="d-label">{{ t('trash.removedAt') }}</span><span class="mono">{{ deletedLabel(a) }}</span></div>
                </div>
                <button class="restore-btn" @click="restore(a)">↺ {{ t('trash.restore') }}</button>
              </div>
            </td>
            <td class="col-type">
              <span class="type-pill" :style="{ '--c': colorForType(a.type) }">{{ a.type }}</span>
            </td>
            <td class="col-source">
              <span class="source-pill" :class="a.source">{{ sourceLabel(a) }}</span>
            </td>
            <td class="actions-cell col-actions">
              <button class="restore-btn" @click.stop="restore(a)">↺ {{ t('trash.restore') }}</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="rows.length === 0" class="empty">{{ t('trash.empty') }}</p>
    </div>
  </div>
</template>

<style scoped>
.trash-page {
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
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

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

.type-pill {
  display: inline-block;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 20px;
  color: var(--c);
  border: 1px solid var(--c);
  background: color-mix(in srgb, var(--c) 12%, transparent);
}

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
.actions-cell { text-align: right; }
.restore-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: var(--radius-sm);
}
.restore-btn:hover { border-color: var(--accent); background: var(--accent-soft); }

.empty {
  padding: 40px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* Wide screens: the details block and chevron are only for phones. */
.details, .chev { display: none; }

@media (max-width: 720px) {
  .trash-page { padding: 14px 10px 0; }
  .toolbar { margin-bottom: 10px; flex-wrap: wrap; gap: 2px 12px; }
  .table-wrap { margin-bottom: 12px; overflow-x: hidden; }
  table { table-layout: fixed; }

  .col-deleted, .col-type, .col-source, .col-actions { display: none; }
  th.col-date { width: 88px; }
  thead th { padding: 9px 8px; letter-spacing: 0.04em; }
  td { padding: 10px 8px; vertical-align: top; }
  td.col-date { font-size: 12px; }

  tbody tr { cursor: pointer; }
  tbody tr.expanded { background: var(--surface-alt); }
  .name-cell { max-width: none; white-space: normal; overflow: visible; overflow-wrap: anywhere; }
  .chev { display: inline-block; width: 14px; color: var(--text-muted); font-size: 10px; }

  .details { display: block; margin-top: 8px; cursor: default; }
  .d-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  .d-desc { margin: 0 0 8px; font-size: 12px; color: var(--text-dim); line-height: 1.45; white-space: pre-line; }
  .d-stats { margin-bottom: 10px; }
  .d-stats > div { display: flex; flex-direction: column; }
  .d-label { font-size: 10.5px; color: var(--text-muted); }
  .d-stats .mono { font-size: 12.5px; color: var(--text); }
}
</style>
