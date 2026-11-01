<script setup>
// Desktop feed: a timeline, newest first, grouped by month, with the day on the
// left. Each entry shows everything at once, no clicking: the key numbers, the
// map, and (loaded as the entry comes near the screen) the full details,
// splits and chart. There is plenty of room on a wide screen.
import { ref, computed } from 'vue'
import { useActivitiesStore, colorForType } from '../stores/activities'
import { t, intlLocale, fmtTimeIn } from '../i18n'
import LazyMount from './LazyMount.vue'
import ActivityFull from './ActivityFull.vue'
import FeedMap from './FeedMap.vue'
import { isPaceSport, fmtAvgPace } from '../utils/sport'
import { useInfiniteList } from '../utils/infiniteList'

const emit = defineEmits(['edit', 'remove'])
const store = useActivitiesStore()

const items = computed(() => [...store.activities].sort((a, b) => b.date - a.date))
const { limit, sentinel } = useInfiniteList(computed(() => items.value.length), 30)

const DASH = '—'
const markers = ref({}) // id -> { lat, lon } under the cursor on the chart

function parts(a) {
  const [y, m, d] = String(a.dateLabel || '').split('-').map(Number)
  return y ? new Date(y, m - 1, d) : (a.date || new Date())
}
const rows = computed(() => {
  const out = []
  let lastMonth = ''
  for (const a of items.value.slice(0, limit.value)) {
    const d = parts(a)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (key !== lastMonth) {
      lastMonth = key
      out.push({ kind: 'month', key: 'm' + key, label: d.toLocaleDateString(intlLocale(), { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase()) })
    }
    out.push({
      kind: 'item', key: a.id, a,
      day: d.getDate(),
      dow: d.toLocaleDateString(intlLocale(), { weekday: 'short' }),
    })
  }
  return out
})

function fmtDuration(sec) {
  if (!sec) return DASH
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} ${t('unit.min')}`
}
function startTime(a) {
  const d = a.date
  if (!d || isNaN(d)) return ''
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) return ''
  return fmtTimeIn(d, a.tz)
}
function stats(a) {
  const out = [
    { l: t('act.distance'), v: a.distanceKm != null ? `${a.distanceKm.toFixed(2)} km` : DASH },
    { l: isPaceSport(a.type) ? t('panel.pace') : t('act.col.avgSpeedKmh'), v: fmtAvgPace(a) },
    { l: t('panel.moving'), v: fmtDuration(a.movingTime || a.elapsedTime) },
  ]
  if (a.elevationGain != null) out.push({ l: `${t('panel.elevation')} (m)`, v: `${Math.round(a.elevationGain)} ${t('map.gain')}` })
  if (a.avgHr != null) out.push({ l: t('panel.hr'), v: `${Math.round(a.avgHr)} bpm` })
  return out
}
function tagNames(a) { return (a.tags || []).map((id) => store.tagDefs.find((d) => d.id === id)?.name).filter(Boolean) }
function gearName(a) { return a.gearId ? store.gearDefs.find((g) => g.id === a.gearId)?.name : null }
</script>

<template>
  <div class="timeline">
    <template v-for="r in rows" :key="r.key">
      <h2 v-if="r.kind === 'month'" class="month">{{ r.label }}</h2>

      <section v-else class="entry">
        <div class="rail">
          <span class="day mono">{{ r.day }}</span>
          <span class="dow">{{ r.dow }}</span>
        </div>
        <i class="dot" :style="{ background: colorForType(r.a.type) }"></i>

        <article class="post">
          <div class="main">
            <div class="info">
              <span class="type" :style="{ color: colorForType(r.a.type) }">{{ r.a.type }}</span>
              <h3 class="name">{{ r.a.name }}</h3>
              <span class="when mono">
                {{ r.a.dateLabel }}<template v-if="startTime(r.a)"> · {{ startTime(r.a) }}</template><template v-if="gearName(r.a)"> · {{ gearName(r.a) }}</template>
              </span>
              <p v-if="r.a.description" class="desc">{{ r.a.description }}</p>
              <dl class="stats">
                <div v-for="s in stats(r.a)" :key="s.l"><dt>{{ s.l }}</dt><dd class="mono">{{ s.v }}</dd></div>
              </dl>
              <div v-if="tagNames(r.a).length" class="tags"><span v-for="n in tagNames(r.a)" :key="n">{{ n }}</span></div>
            </div>
            <div class="map"><FeedMap :activity="r.a" interactive :wheel="false" :marker="markers[r.a.id]" /></div>
          </div>

          <LazyMount class="expanded">
            <ActivityFull
              :activity="r.a"
              no-same
              class="inline"
              @edit="emit('edit', $event)"
              @remove="emit('remove', $event)"
              @hover="markers = { ...markers, [r.a.id]: $event }"
            />
          </LazyMount>
        </article>
      </section>
    </template>

    <div ref="sentinel" class="sentinel"></div>
  </div>
</template>

<style scoped>
.timeline { width: 100%; max-width: 1180px; margin: 0 auto; padding-bottom: 48px; }
.month {
  position: sticky; top: 0; z-index: 5;
  margin: 18px 0 10px 98px; padding: 4px 0;
  font-family: var(--font-display); font-size: 17px; font-weight: 500;
  color: var(--text-dim); background: var(--bg);
}
.entry { position: relative; display: flex; gap: 0; margin-bottom: 14px; }
/* the vertical line of the timeline runs through all entries */
.entry::before { content: ''; position: absolute; left: 83px; top: -14px; bottom: 0; width: 2px; background: var(--border); }
.rail { flex: 0 0 74px; display: flex; flex-direction: column; align-items: flex-end; padding-top: 12px; line-height: 1.1; }
.day { font-size: 22px; font-weight: 600; color: var(--text); }
.dow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.dot { position: relative; flex: 0 0 auto; width: 12px; height: 12px; margin: 17px 14px 0 4px; border-radius: 50%; border: 2px solid var(--bg); box-sizing: content-box; z-index: 1; }
.post { flex: 1; min-width: 0; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; transition: border-color 0.15s, box-shadow 0.15s; }
.post:hover { border-color: var(--border-strong); box-shadow: 0 3px 14px -8px var(--shadow); }
.main { display: flex; align-items: stretch; }
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; padding: 14px 18px 12px; }
.type { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
.name { margin: 0; font-size: 21px; font-weight: 500; line-height: 1.2; overflow-wrap: anywhere; }
.when { font-size: 11.5px; color: var(--text-muted); }
.desc { margin: 6px 0 0; font-size: 13px; color: var(--text-dim); line-height: 1.45; white-space: pre-line; }
.stats { display: flex; flex-wrap: wrap; margin: 12px 0 0; }
.stats > div { padding: 0 18px; border-left: 1px solid var(--border); }
.stats > div:first-child { padding-left: 0; border-left: none; }
.stats dt { font-size: 11.5px; color: var(--text-muted); }
.stats dd { margin: 2px 0 0; font-size: 20px; color: var(--text); white-space: nowrap; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 10px; }
.tags span { font-size: 11px; background: var(--surface-alt); border-radius: 10px; padding: 1px 9px; color: var(--text-dim); }
.map { flex: 0 0 min(42%, 440px); min-height: 190px; position: relative; }
.map :deep(.feed-map) { height: 100%; min-height: 190px; }
.expanded { padding: 12px; border-top: 1px solid var(--surface-alt); background: var(--bg); }
.expanded :deep(.activity-panel) { max-height: none; border-top: none; padding: 0; }
@media (max-width: 1000px) { .main { flex-direction: column-reverse; } .map { flex-basis: auto; min-height: 200px; } }
</style>
