<script setup>
// Card "same route": other activities that followed this activity's route.
import { ref, computed, watch } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { t } from '../i18n'
import { fmtAvgPace } from '../utils/sport'
// same as the pace shown elsewhere but without the unit (the column header says it)
const rate = (a) => fmtAvgPace(a).replace(/ ?(min\/km|km\/h)$/, '')
import { findSameRoute } from '../utils/similarRoutes'
import Icon from './Icon.vue'
import { sameCollapsed, toggleSameCollapsed } from '../utils/viewPrefs'

const props = defineProps({ activity: { type: Object, required: true } })
const store = useActivitiesStore()
const others = ref([])
let token = 0
watch(() => props.activity.id, async () => {
  const my = ++token
  others.value = []
  // wait a moment so quickly clicking through activities does not start a search for each one
  await new Promise((r) => setTimeout(r, 350))
  if (my !== token) return
  try {
    const r = await findSameRoute(store, props.activity, () => my !== token)
    if (my === token) others.value = r
  } catch (e) { console.warn('[activities-heatmap] percursos iguais:', e) }
}, { immediate: true })

const rows = computed(() => [props.activity, ...others.value].sort((a, b) => b.date - a.date))
function dur(a) {
  const sec = a.movingTime || a.elapsedTime
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.round(sec % 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div v-if="others.length" class="card same-route" :class="{ collapsed: sameCollapsed }">
    <header class="card-head"><strong class="title">{{ t('panel.sameRoute') }}</strong><span class="count mono">{{ rows.length }}</span>
      <span class="fill"></span>
      <button class="head-btn" :title="sameCollapsed ? t('panel.expand') : t('panel.collapse')" :aria-expanded="!sameCollapsed" @click="toggleSameCollapsed">
        <Icon class="ic-d" :name="sameCollapsed ? 'chevron-right' : 'chevron-left'" :size="16" />
        <Icon class="ic-m" :name="sameCollapsed ? 'chevron-down' : 'chevron-up'" :size="16" />
      </button>
    </header>
    <div v-show="!sameCollapsed" class="body">
      <table>
        <thead><tr><th>{{ t('panel.date') }}</th><th class="r">{{ t('panel.duration') }}</th><th class="r">{{ t('panel.pace') }}</th></tr></thead>
        <tbody>
          <tr v-for="a in rows" :key="a.id" :class="{ me: a.id === activity.id }" @click="a.id !== activity.id && store.focusOnMap(a.id)">
            <td class="mono d">{{ a.dateLabel }}</td>
            <td class="r mono">{{ dur(a) }}</td>
            <td class="r mono">{{ rate(a) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); display: flex; flex-direction: column; min-width: 0; }
.card-head { display: flex; align-items: center; gap: 8px; padding: 6px 12px; min-height: 34px; border-bottom: 1px solid var(--surface-alt); }
.title { font-size: 13px; color: var(--text); }
.count { font-size: 11px; color: var(--text-muted); }
.body { max-height: 220px; overflow-y: auto; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { position: sticky; top: 0; background: var(--surface); text-align: left; font-size: 10.5px; font-weight: 600; color: var(--text-muted); padding: 5px 8px; border-bottom: 1px solid var(--surface-alt); }
td { padding: 6px 8px; border-bottom: 1px solid var(--surface-alt); white-space: nowrap; }
.r { text-align: right; }
.nm { max-width: 0; width: 40%; overflow: hidden; text-overflow: ellipsis; }
.d { color: var(--text-muted); font-size: 11px; }
tbody tr { cursor: pointer; }
tbody tr:hover { background: var(--surface-alt); }
tbody tr.me { background: var(--accent-soft); cursor: default; }
@media (max-width: 720px) { .card { flex: 0 0 auto; } }
.fill { flex: 1; }
.head-btn { background: transparent; border: none; color: var(--text-dim); padding: 4px; border-radius: 4px; cursor: pointer; line-height: 0; }
.head-btn:hover { background: var(--surface-alt); color: var(--text); }
.ic-m { display: none; }
@media (min-width: 721px) {
  .card.same-route { flex: 0 0 290px; }
  .card.same-route.collapsed { flex: 0 0 40px; overflow: hidden; }
  .card.same-route.collapsed .card-head { flex-direction: column; align-items: center; padding: 8px 0; gap: 10px; min-height: 0; flex: 1; border-bottom: none; }
  .card.same-route.collapsed .title { writing-mode: vertical-rl; transform: rotate(180deg); }
  .card.same-route.collapsed .count, .card.same-route.collapsed .fill { display: none; }
  .card.same-route.collapsed .title { flex: 1; }
}
@media (max-width: 720px) { .ic-d { display: none; } .ic-m { display: block; } }
</style>
