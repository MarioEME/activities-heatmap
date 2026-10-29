<script setup>
// Phones, List tab: a feed of cards instead of a table. Each card shows a small
// route thumbnail plus the basics; tapping it opens the full details and the
// elevation / pace chart in place.
import { ref, computed, watch } from 'vue'
import { useActivitiesStore, colorForType } from '../stores/activities'
import { t, fmtTimeIn } from '../i18n'
import Icon from './Icon.vue'
import ActivityChart from './ActivityChart.vue'
import FeedMap from './FeedMap.vue'
import { chartElev, toggleChartElev, chartPace, toggleChartPace, chartBands, toggleChartBands } from '../utils/viewPrefs'
import { isPaceSport, fmtAvgPace } from '../utils/sport'
import { loadActivitySeries } from '../utils/activitySeries'
import { useInfiniteList } from '../utils/infiniteList'

const emit = defineEmits(['edit', 'remove'])
const store = useActivitiesStore()

// all activities (independent of the map filters), newest first, rendered as you scroll
const items = computed(() => [...store.activities].sort((a, b) => b.date - a.date))
const { limit, sentinel } = useInfiniteList(computed(() => items.value.length))
const visible = computed(() => items.value.slice(0, limit.value))
const marker = ref(null) // point under the finger on the chart, shown on the detail map
// "See more" opens the activity full screen (half map, half details) on top of
// the list; the list underneath stays exactly as it was.
const detailId = ref(null)
const detailActivity = computed(() => (detailId.value == null ? null : items.value.find((x) => x.id === detailId.value) || null))
const series = ref({ profile: { status: 'loading' }, pace: { status: 'loading' } })
let token = 0
watch(detailActivity, (a) => { if (detailId.value != null && !a) detailId.value = null })

function closeDetail() { detailId.value = null; marker.value = null; token++ }

async function toggle(a) {
  detailId.value = a.id
  const my = ++token
  series.value = { profile: { status: 'loading' }, pace: { status: 'loading' } }
  const s = await loadActivitySeries(store, a)
  if (my === token) series.value = s
}

// --- formatting ----------------------------------------------------------------
const DASH = '—'
const BAND_COLORS = ['#9fd3f5', '#1ea7ef', '#0b5d9b']
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
function gearName(a) { return a.gearId ? store.gearDefs.find((g) => g.id === a.gearId)?.name : null }
function tagNames(a) {
  return (a.tags || []).map((id) => store.tagDefs.find((d) => d.id === id)?.name).filter(Boolean)
}
function detailRows(a) {
  return [
    [t('panel.date'), a.dateLabel || DASH],
    [t('panel.start'), startTime(a) || DASH],
    [t('panel.moving'), fmtDuration(a.movingTime)],
    [t('panel.elapsed'), fmtDuration(a.elapsedTime)],
    [t('act.distance'), a.distanceKm != null ? `${a.distanceKm.toFixed(2)} km` : DASH],
    [`${t('panel.elevation')} (m)`, a.elevationGain != null ? `${Math.round(a.elevationGain)} ${t('map.gain')}` : DASH],
    [isPaceSport(a.type) ? t('panel.pace') : t('act.col.avgSpeedKmh'), fmtAvgPace(a)],
    [t('panel.hr'), a.avgHr != null ? `${Math.round(a.avgHr)} bpm` : DASH],
  ]
}
</script>

<template>
  <div class="feed">
    <article v-for="a in visible" :key="a.id" class="post">
      <div class="top" role="button" tabindex="0" @click="toggle(a)" @keydown.enter="toggle(a)">
        <span class="type" :style="{ color: colorForType(a.type) }">{{ a.type }}</span>
        <h3 class="name">{{ a.name }}</h3>
        <span class="when mono">{{ a.dateLabel }}<template v-if="startTime(a)"> · {{ startTime(a) }}</template></span>
        <div class="nums mono">
          <span>{{ a.distanceKm != null ? a.distanceKm.toFixed(1) + ' km' : DASH }}</span>
          <span>{{ a.elevationGain != null ? Math.round(a.elevationGain) + ' D+' : DASH }}</span>
          <span>{{ fmtAvgPace(a) }}</span>
        </div>
      </div>

      <FeedMap :activity="a" />

      <button type="button" class="expander" @click="toggle(a)">
        <span>{{ t('feed.more') }}</span>
        <Icon name="chevron-right" :size="16" />
      </button>
    </article>

    <div ref="sentinel" class="sentinel"></div>

    <Teleport to="body">
      <div v-if="detailActivity" class="sheet" role="dialog" :aria-label="detailActivity.name">
        <header class="sheet-head">
          <button class="sheet-back" :aria-label="t('common.close')" @click="closeDetail"><Icon name="chevron-left" :size="20" /></button>
          <div class="sheet-title">
            <span class="type" :style="{ color: colorForType(detailActivity.type) }">{{ detailActivity.type }}</span>
            <strong>{{ detailActivity.name }}</strong>
          </div>
        </header>
        <div class="sheet-map"><FeedMap :key="detailActivity.id" :activity="detailActivity" interactive fill :marker="marker" /></div>
        <div class="sheet-body">
          <div v-if="tagNames(detailActivity).length" class="tags"><span v-for="n in tagNames(detailActivity)" :key="n">{{ n }}</span></div>
          <p v-if="detailActivity.description" class="desc">{{ detailActivity.description }}</p>
          <div class="grid">
            <div v-for="[l, v] in detailRows(detailActivity)" :key="l"><span class="l">{{ l }}</span><span class="v mono">{{ v }}</span></div>
            <div class="wide"><span class="l">{{ t('nav.gear') }}</span><span class="v mono">{{ gearName(detailActivity) || DASH }}</span></div>
          </div>
          <div class="chart">
            <ActivityChart
              :profile-state="series.profile"
              :pace-state="series.pace"
              :mode="isPaceSport(detailActivity.type) ? 'pace' : 'speed'"
              :color="colorForType(detailActivity.type)"
              @hover="marker = $event"
            />
          </div>
          <div v-if="series.profile.status === 'ready' || series.pace.status === 'ready'" class="legend">
            <button v-if="series.profile.status === 'ready'" type="button" class="chip" :class="{ off: !(chartElev || series.pace.status !== 'ready') }" :disabled="series.pace.status !== 'ready'" @click="toggleChartElev">
              <span class="sw" :style="{ background: colorForType(detailActivity.type) }"></span>{{ t('panel.elevationTitle') }}
            </button>
            <button v-if="series.pace.status === 'ready'" type="button" class="chip" :class="{ off: !(chartPace || series.profile.status !== 'ready') }" :disabled="series.profile.status !== 'ready'" @click="toggleChartPace">
              <span class="sw line"></span>{{ isPaceSport(detailActivity.type) ? t('panel.paceTitle') : t('panel.speedTitle') }}
            </button>
            <button v-if="series.profile.status === 'ready'" type="button" class="chip" :class="{ off: !chartBands }" @click="toggleChartBands">
              <span class="sw-row" aria-hidden="true"><span v-for="c in BAND_COLORS" :key="c" class="sw" :style="{ background: c }"></span></span>{{ t('panel.slope') }}
            </button>
          </div>
          <div class="actions">
            <button v-if="detailActivity.hasTrack" class="btn-i" :title="t('act.showOnMap')" :aria-label="t('act.showOnMap')" @click="closeDetail(); store.focusOnMap(detailActivity.id)"><Icon name="map" :size="18" /></button>
            <button class="btn-i" :title="t('common.edit')" :aria-label="t('common.edit')" @click="emit('edit', detailActivity)"><Icon name="edit" :size="18" /></button>
            <button class="btn-i" :title="t('common.remove')" :aria-label="t('common.remove')" @click="emit('remove', detailActivity)"><Icon name="trash" :size="18" /></button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.feed { display: flex; flex-direction: column; gap: 12px; padding-bottom: 24px; }
.post {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  content-visibility: auto;
  contain-intrinsic-size: auto 330px;
}
.top { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px 8px; cursor: pointer; }
.type { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; }
.name { margin: 0; font-size: 15px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; line-height: 1.25; }
.when { font-size: 11px; color: var(--text-muted); }
.nums { display: flex; flex-wrap: wrap; gap: 2px 12px; margin-top: 4px; font-size: 12.5px; color: var(--text-dim); }
.expander {
  width: 100%; display: flex; align-items: center; justify-content: center; gap: 4px;
  background: transparent; border: none; border-top: 1px solid var(--surface-alt);
  padding: 8px; font-size: 12px; color: var(--text-dim); cursor: pointer;
}
.sheet {
  position: fixed; left: 0; right: 0; bottom: 0; top: var(--navbar-h); z-index: 950;
  display: flex; flex-direction: column; background: var(--bg);
}
.sheet-head { display: flex; align-items: center; gap: 4px; padding: 4px 8px 4px 4px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.sheet-back { background: transparent; border: none; color: var(--text-dim); padding: 8px; cursor: pointer; line-height: 0; }
.sheet-title { display: flex; flex-direction: column; min-width: 0; }
.sheet-title strong { font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.sheet-map { flex: 0 0 50%; min-height: 0; position: relative; }
.sheet-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px calc(16px + var(--bottom-bar)); background: var(--surface); border-top: 1px solid var(--border-strong); }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.tags span { font-size: 11px; background: var(--surface-alt); border-radius: 10px; padding: 1px 8px; color: var(--text-dim); }
.desc { margin: 0 0 8px; font-size: 12px; color: var(--text-dim); line-height: 1.45; white-space: pre-line; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; margin-bottom: 10px; }
.grid > div { display: flex; flex-direction: column; min-width: 0; }
.grid .wide { grid-column: 1 / -1; }
.l { font-size: 10.5px; color: var(--text-muted); }
.v { font-size: 12.5px; color: var(--text); overflow-wrap: anywhere; }
.chart { height: 190px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; background: var(--surface);
  border: 1px solid var(--border-strong); border-radius: 20px; padding: 2px 10px;
  font-size: 11px; color: var(--text); cursor: pointer;
}
.chip:disabled { cursor: default; }
.chip.off { color: var(--text-muted); background: var(--surface-alt); }
.chip.off .sw, .chip.off .sw-row { opacity: 0.35; }
.sw { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.sw.line { height: 3px; width: 12px; background: #2f80ed; }
.sw-row { display: inline-flex; gap: 2px; }
.actions { display: flex; gap: 8px; border-top: 1px solid var(--surface-alt); padding-top: 8px; }
.btn-i {
  display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 36px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text-dim);
  padding: 0; border-radius: var(--radius-sm); cursor: pointer;
}
.btn-i:hover { border-color: var(--accent); color: var(--accent-strong); }
</style>
