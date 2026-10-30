<script setup>
// Bottom panel shown when an activity is clicked on the map: the activity's
// details (left on desktop, top on mobile) and its elevation profile (right
// on desktop, bottom on mobile). It goes away when the selection is cleared
// (click on an empty part of the map).
import { computed } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { sourceFileExtension } from '../utils/gpxExport'
import ActivityChart from './ActivityChart.vue'
import RouteMatches from './RouteMatches.vue'
import { t, fmtTimeIn } from '../i18n'
import Icon from './Icon.vue'
import { isPaceSport, fmtAvgPace } from '../utils/sport'
import { detailCompact, toggleDetailCompact, detailSideCollapsed, toggleDetailSide, elevCollapsed, toggleElevCollapsed, splitsCollapsed, toggleSplitsCollapsed, setSelectedColor, chartElev, toggleChartElev, chartPace, toggleChartPace, chartBands, toggleChartBands } from '../utils/viewPrefs'

const props = defineProps({
  activity: { type: Object, required: true },
  // { status: 'loading' | 'ready' | 'none' | 'error', data?, message? }
  profileState: { type: Object, required: true },
  // same shape, for the pace/speed series
  paceState: { type: Object, default: () => ({ status: 'none' }) },
  // per-km splits: [{ km, dist, time, pace, gap, elev }] or null
  splits: { type: Array, default: null },
  color: { type: String, default: '#C9752E' },
})
const emit = defineEmits(['edit', 'remove', 'download', 'convert', 'hover'])

const store = useActivitiesStore()

// chart series toggles (shown in the card's title bar)
const hasElev = computed(() => props.profileState.status === 'ready')
const hasPace = computed(() => props.paceState.status === 'ready')
const both = computed(() => hasElev.value && hasPace.value)
const elevOn = computed(() => hasElev.value && (chartElev.value || !hasPace.value))
const paceOn = computed(() => hasPace.value && (chartPace.value || !hasElev.value))
function onToggleElev() { if (!both.value) return; if (chartElev.value && !chartPace.value) toggleChartPace(); toggleChartElev() }
function onTogglePace() { if (!both.value) return; if (chartPace.value && !chartElev.value) toggleChartElev(); toggleChartPace() }
const BAND_COLORS = ['#9fd3f5', '#1ea7ef', '#0b5d9b']

// running and walking read better as a pace (min/km), everything else as a speed
const paceMode = computed(() => (isPaceSport(props.activity.type) ? 'pace' : 'speed'))

const showGap = computed(() => paceMode.value === 'pace' && props.splits?.some((s) => s.gap != null))
// pace (s/km) as m:ss, or km/h for the other sports
function splitRate(secPerKm) {
  if (!(secPerKm > 0)) return '—'
  if (paceMode.value !== 'pace') return `${(3600 / secPerKm).toFixed(1)}`
  const s = Math.round(secPerKm)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// --- formatting --------------------------------------------------------------

function fmtDuration(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} ${t('unit.min')}`
}

// Start time of day in the time zone of the PLACE the activity happened (its
// `tz`); an activity whose date has no time part (exactly midnight UTC) is
// treated as date-only rather than showing a made-up 00:00.
function fmtStartTime(date, tz) {
  if (!date || isNaN(date)) return null
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0) return null
  return fmtTimeIn(date, tz)
}


// Fixed slots, always in the same place: a missing value is shown as "—" so
// nothing jumps around from one activity to the next.
const DASH = '—'
const rows = computed(() => {
  const a = props.activity
  const pace = isPaceSport(a.type)
  const gear = a.gearId ? store.gearDefs.find((g) => g.id === a.gearId) : null
  return [
    { label: t('panel.date'), val: a.dateLabel || DASH },
    { label: t('panel.start'), val: fmtStartTime(a.date, a.tz) || DASH },
    { label: t('panel.moving'), val: fmtDuration(a.movingTime) },
    { label: t('panel.elapsed'), val: fmtDuration(a.elapsedTime) },
    { label: t('act.distance'), val: a.distanceKm != null ? `${a.distanceKm.toFixed(2)} km` : DASH },
    { label: `${t('panel.elevation')} (m)`, val: a.elevationGain != null ? `${Math.round(a.elevationGain)} ${t('map.gain')}` : DASH },
    { label: pace ? t('panel.pace') : t('act.col.avgSpeedKmh'), val: fmtAvgPace(a) },
    { label: t('panel.hr'), val: a.avgHr != null ? `${Math.round(a.avgHr)} bpm` : DASH },
    { label: t('nav.gear'), val: gear ? gear.name : DASH, wide: true },
  ]
})


const tagNames = computed(() =>
  (props.activity.tags || [])
    .map((id) => store.tagDefs.find((t) => t.id === id)?.name)
    .filter(Boolean),
)
const sourceLabel = computed(() => (props.activity.source === 'manual' ? t('common.manualGpx') : 'Strava'))
const stravaUrl = computed(() =>
  /^\d+$/.test(String(props.activity.id)) ? `https://www.strava.com/activities/${props.activity.id}` : null,
)
const origExt = computed(() => (props.activity.sourceFile ? sourceFileExtension(props.activity.sourceFile) : null))
// Download buttons, shown as "fit | gpx": the original file's extension, then
// GPX (converted from FIT/TCX). A GPX original is just one "gpx" button; an
// activity with no original at all falls back to a GPX rebuilt from the
// stored track.
const showConvert = computed(() => props.activity.hasTrack && origExt.value && origExt.value !== 'gpx')
const originalLabel = computed(() => origExt.value || 'gpx')
const originalTitle = computed(() =>
  origExt.value
    ? t('panel.origTitle', { ext: origExt.value })
    : t('panel.noOrigTitle'),
)
</script>

<template>
  <section class="activity-panel" :aria-label="t('panel.label')">
    <!-- Details -->
    <div class="card detail" :class="{ compact: detailCompact, 'side-collapsed': detailSideCollapsed }">
      <header class="card-head">
        <label class="dot" :style="{ background: color }" :title="t('panel.routeColor')">
          <input type="color" class="dot-input" :value="color" @input="setSelectedColor($event.target.value)" />
        </label>
        <strong class="title" :title="activity.name">{{ activity.name }}</strong>
        <button
          class="head-btn side-toggle"
          :title="detailSideCollapsed ? t('panel.showDetails') : t('panel.hideDetails')"
          :aria-expanded="!detailSideCollapsed"
          @click="toggleDetailSide"
        ><Icon :name="detailSideCollapsed ? 'chevron-right' : 'chevron-left'" :size="16" /></button>
        <button
          class="head-btn compact-toggle"
          :title="detailCompact ? t('common.moreDetails') : t('common.lessDetails')"
          :aria-expanded="!detailCompact"
          @click="toggleDetailCompact"
        ><Icon :name="detailCompact ? 'chevron-down' : 'chevron-up'" :size="16" /></button>
      </header>

      <div class="card-body detail-body">
        <div class="type-line">
          <span class="type" :style="{ color }">{{ activity.type }}</span>
          <span class="source">· {{ sourceLabel }}</span>
          <span v-for="n in tagNames" :key="n" class="tag">{{ n }}</span>
        </div>
        <p v-if="activity.description" class="desc">{{ activity.description }}</p>

        <div class="stats">
          <div v-for="r in rows" :key="r.label" class="stat" :class="{ wide: r.wide }">
            <span class="stat-label">{{ r.label }}</span>
            <span class="stat-val mono" :title="r.val">{{ r.val }}</span>
          </div>
        </div>

        <div class="links">
          <a
            v-if="stravaUrl"
            class="link"
            :href="stravaUrl"
            target="_blank"
            rel="noopener noreferrer"
            :title="t('panel.openStrava')"
          >Strava ↗</a>
          <button
            v-if="activity.hasTrack"
            type="button"
            class="link"
            :title="originalTitle"
            @click="emit('download')"
          >⬇ {{ originalLabel }}</button>
          <button
            v-if="showConvert"
            type="button"
            class="link"
            :title="t('panel.convertTitle', { ext: origExt })"
            @click="emit('convert')"
          >⬇ gpx</button>
          <span class="link-actions">
            <button class="act-btn" :title="t('panel.editTitle')" :aria-label="t('panel.editTitle')" @click="emit('edit')"><Icon name="edit" :size="16" /></button>
            <button class="act-btn" :title="t('panel.removeTitle')" :aria-label="t('panel.removeTitle')" @click="emit('remove')"><Icon name="trash" :size="16" /></button>
          </span>
        </div>
      </div>
    </div>

    <!-- Splits (per km) -->
    <div v-if="splits && splits.length" class="card splits" :class="{ collapsed: splitsCollapsed }">
      <header class="card-head">
        <strong class="title">{{ t('panel.splits') }}</strong>
        <span class="chips-fill"></span>
        <button class="head-btn" :title="splitsCollapsed ? t('panel.expand') : t('panel.collapse')" :aria-expanded="!splitsCollapsed" @click="toggleSplitsCollapsed">
          <Icon class="ic-d" :name="splitsCollapsed ? 'chevron-right' : 'chevron-left'" :size="16" />
          <Icon class="ic-m" :name="splitsCollapsed ? 'chevron-down' : 'chevron-up'" :size="16" />
        </button>
      </header>
      <div v-show="!splitsCollapsed" class="splits-body">
        <table>
          <thead>
            <tr>
              <th>{{ t('panel.splitKm') }}</th>
              <th>{{ paceMode === 'pace' ? t('panel.pace') : t('panel.speedTitle') }}</th>
              <th v-if="showGap">{{ t('panel.gap') }}</th>
              <th>{{ t('panel.splitElev') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in splits" :key="s.km">
              <td>{{ s.dist >= 999.5 ? s.km : (s.dist / 1000).toFixed(1) }}</td>
              <td class="mono">{{ splitRate(s.pace) }}</td>
              <td v-if="showGap" class="mono">{{ s.gap != null ? splitRate(s.gap) : '—' }}</td>
              <td class="mono">{{ s.elev != null ? (s.elev > 0 ? '+' : '') + Math.round(s.elev) : '—' }}<small v-if="s.elev != null"> m</small></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Elevation + pace in one chart -->
    <div class="card chart" :class="{ collapsed: elevCollapsed }">
      <header class="card-head">
        <strong class="title chart-title">{{ t('panel.chartTitle') }}</strong>
        <div v-if="!elevCollapsed && (hasElev || hasPace)" class="chips chips-d">
          <button v-if="hasElev" type="button" class="chip" :class="{ off: !elevOn }" :aria-pressed="elevOn" :disabled="!both" :title="t('panel.chartToggle')" @click="onToggleElev">
            <span class="sw" :style="{ background: color }"></span>{{ t('panel.elevationTitle') }}
          </button>
          <button v-if="hasPace" type="button" class="chip" :class="{ off: !paceOn }" :aria-pressed="paceOn" :disabled="!both" :title="t('panel.chartToggle')" @click="onTogglePace">
            <span class="sw line"></span>{{ paceMode === 'pace' ? t('panel.paceTitle') : t('panel.speedTitle') }}
          </button>
          <button v-if="hasElev && elevOn" type="button" class="chip" :class="{ off: !chartBands }" :aria-pressed="chartBands" :title="t('panel.slopeToggle')" @click="toggleChartBands">
            <span class="sw-row" aria-hidden="true"><span v-for="c in BAND_COLORS" :key="c" class="sw" :style="{ background: c }"></span></span>{{ t('panel.slope') }}
          </button>
        </div>
        <span v-else class="chips-fill"></span>
        <button
          class="head-btn"
          :title="elevCollapsed ? t('panel.expand') : t('panel.collapse')"
          :aria-expanded="!elevCollapsed"
          @click="toggleElevCollapsed"
        >
          <!-- desktop: fold to the left (like the details); phones: fold up -->
          <Icon class="ic-d" :name="elevCollapsed ? 'chevron-right' : 'chevron-left'" :size="16" />
          <Icon class="ic-m" :name="elevCollapsed ? 'chevron-down' : 'chevron-up'" :size="16" />
        </button>
      </header>
      <div v-show="!elevCollapsed" class="card-body chart-body">
        <ActivityChart
          :profile-state="profileState"
          :pace-state="paceState"
          :mode="paceMode"
          :color="color"
          @hover="emit('hover', $event)"
        />
      </div>
      <div v-if="!elevCollapsed && (hasElev || hasPace)" class="chips chips-m">
        <button v-if="hasElev" type="button" class="chip" :class="{ off: !elevOn }" :aria-pressed="elevOn" :disabled="!both" :title="t('panel.chartToggle')" @click="onToggleElev">
          <span class="sw" :style="{ background: color }"></span>{{ t('panel.elevationTitle') }}
        </button>
        <button v-if="hasPace" type="button" class="chip" :class="{ off: !paceOn }" :aria-pressed="paceOn" :disabled="!both" :title="t('panel.chartToggle')" @click="onTogglePace">
          <span class="sw line"></span>{{ paceMode === 'pace' ? t('panel.paceTitle') : t('panel.speedTitle') }}
        </button>
        <button v-if="hasElev && elevOn" type="button" class="chip" :class="{ off: !chartBands }" :aria-pressed="chartBands" :title="t('panel.slopeToggle')" @click="toggleChartBands">
          <span class="sw-row" aria-hidden="true"><span v-for="c in BAND_COLORS" :key="c" class="sw" :style="{ background: c }"></span></span>{{ t('panel.slope') }}
        </button>
      </div>
    </div>
      <RouteMatches v-if="activity.hasTrack" :activity="activity" />
  </section>
</template>

<style scoped>
.activity-panel {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-start; /* a folded card stays next to the details, on the left */
  align-items: stretch; /* both cards same height while open */
  gap: 10px;
  padding: 10px;
  background: var(--bg);
  border-top: 1px solid var(--border-strong);
  position: relative;
  z-index: 600;
  /* with every card expanded the map must keep room: scroll the panel instead */
  max-height: 52vh;
  overflow-y: auto;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 14px -8px rgba(30, 25, 15, 0.25);
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.card.detail { flex: 0 0 400px; }
.card.chart { flex: 1 1 280px; min-width: 260px; }
.card.collapsed .card-body { display: none; }
.ic-m { display: none; }

.card-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 6px 6px 12px;
  min-height: 34px;
}
.card-body { border-top: 1px solid var(--surface-alt); }

.dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; margin-right: 4px; }
.title {
  flex: 1;
  min-width: 0;
  font-size: 13.5px;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta { color: var(--text-muted); font-size: 11px; white-space: nowrap; margin-right: 4px; }
.head-btn {
  flex-shrink: 0;
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 13px;
  line-height: 1;
  min-width: 26px;
  height: 26px;
  padding: 0 4px;
  border-radius: 4px;
}
.head-btn:hover { background: var(--surface-alt); color: var(--text); }

.detail-body {
  padding: 8px 12px 10px;
  flex: 1;
  min-height: 0;
  max-height: 300px;
  overflow-y: auto;
}
.type-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  font-size: 11px;
  margin-bottom: 6px;
}
.type { text-transform: uppercase; letter-spacing: 0.04em; }
.source { color: var(--text-muted); }
.tag {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 20px;
  border: 1px solid var(--border-strong);
  color: var(--text-dim);
  background: var(--surface-alt);
}
.desc {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-dim);
  line-height: 1.45;
  white-space: pre-line;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px 12px;
  margin-bottom: 8px;
}
.stat.wide { grid-column: 1 / -1; }
.stat { display: flex; flex-direction: column; min-width: 0; }
.stat.wide .stat-val { white-space: normal; }
@media (max-width: 720px) { .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.stat-label { font-size: 10.5px; color: var(--text-muted); }
.stat-val { font-size: 12.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  border-top: 1px solid var(--surface-alt);
  padding-top: 8px;
}
/* "Strava | fit | gpx" — thin dividers between the entries */
.link-actions { margin-left: auto; display: flex; gap: 2px; }
.links > .link-actions { border-left: none; padding-left: 0; }
.act-btn {
  background: transparent;
  border: none;
  color: var(--text-dim);
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 0;
}
.act-btn:hover { background: var(--surface-alt); color: var(--accent-strong); }
.links > * + * {
  border-left: 1px solid var(--border-strong);
  padding-left: 12px;
}
.link {
  font-size: 12px;
  color: var(--accent-strong);
  text-decoration: none;
  background: transparent;
  border: none;
  padding: 0;
  font-family: inherit;
  text-align: left;
  line-height: 1.2;
}
.link:hover { text-decoration: underline; }

.chart-title { flex: 0 0 auto; }
.chips, .chips-fill { flex: 1; min-width: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding-left: 6px; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 20px;
  padding: 1px 9px;
  font-size: 11px;
  color: var(--text);
  cursor: pointer;
}
.chip:hover:not(:disabled) { border-color: var(--accent); }
.chip:disabled { cursor: default; }
.chip.off { color: var(--text-muted); background: var(--surface-alt); }
.chip.off .sw, .chip.off .sw-row { opacity: 0.35; }
.sw { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.sw.line { height: 3px; width: 12px; background: #2f80ed; }
.sw-row { display: inline-flex; gap: 2px; }
.chart-body { height: 190px; padding: 6px 6px 4px 2px; }
.elev-msg {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-muted);
}

.compact-toggle { display: none; }

/* Desktop: the chart card also folds to a thin strip on the left */
@media (min-width: 721px) {
  .card.chart { transition: flex-basis 0.18s ease; }
  .card.chart.collapsed { flex: 0 0 40px; overflow: hidden; }
  .card.collapsed .card-head {
    flex-direction: column;
    align-items: center;
    padding: 8px 0;
    gap: 10px;
    min-height: 0;
    flex: 1;
  }
  .card.collapsed .title {
    flex: 1;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    max-height: 100%;
  }
  .card.collapsed .meta { display: none; }
}

/* Desktop: fold the details card into a thin strip on the left (like a
   browser's side tab), giving the elevation profile the full width. */
@media (min-width: 721px) {
  .card.detail { transition: flex-basis 0.18s ease; }
  .card.detail.side-collapsed { flex: 0 0 40px; overflow: hidden; }
  .card.detail.side-collapsed .card-head {
    flex-direction: column;
    align-items: center;
    padding: 8px 0;
    gap: 10px;
    min-height: 0;
    flex: 1;
  }
  .card.detail.side-collapsed .card-head > .head-btn:not(.side-toggle) { display: none; }
  .card.detail.side-collapsed .dot { margin: 0; order: 0; }
  .card.detail.side-collapsed .title {
    flex: 1;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    max-height: 100%;
  }
  .card.detail.side-collapsed .detail-body { display: none; }
}
@media (max-width: 720px) { .side-toggle { display: none; } }

/* Phones: stacked, details above, then the chart. */
@media (max-width: 720px) {
  .ic-d { display: none; }
  .ic-m { display: block; }
  .card.chart { flex: 0 0 auto; }
  .activity-panel {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 6px;
  }
  .card.detail { flex: 0 0 auto; }
  /* The panel scrolls inside (it never takes more than 55% of the screen, so the map stays);
     the extra room at the end is the height of a card title, so the browser's bottom bar
     does not cover the chart. */
  .activity-panel {
    flex: 1 1 auto;
    min-height: 0;
    max-height: none;
  }
  .detail-body { max-height: 30vh; }
  .chart-body { height: 150px; }

  /* Compact details: only the title row, leaving the room to the map and the chart. */
  .compact-toggle { display: inline-block; }
  .card.detail.compact .detail-body { display: none; }
  .card.detail.compact .card-head { min-height: 30px; }
}
.dot { position: relative; cursor: pointer; }
.dot-input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; padding: 0; border: none; }
.chips-m { display: none; }
@media (max-width: 720px) {
  .chips-d { display: none; }
  .chips-fill { flex: 1; }
  .chips-m { display: flex; padding: 2px 10px 10px; }
}
.card.splits { flex: 0 0 220px; position: relative; min-height: 140px; }
.card.splits.collapsed { min-height: 0; }
.card.splits.collapsed .chips-fill { display: none; }
@media (min-width: 721px) { .card.splits.collapsed { flex: 0 0 40px; overflow: hidden; } .activity-panel { overflow-x: auto; } }
.splits-body { position: absolute; left: 0; right: 0; bottom: 0; top: 34px; overflow-y: auto; }
.splits-body table { width: 100%; border-collapse: collapse; font-size: 12.5px; text-align: center; }
.splits-body th { position: sticky; top: 0; background: var(--surface); font-size: 10.5px; font-weight: 600; color: var(--text-muted); padding: 4px 4px; border-bottom: 1px solid var(--surface-alt); }
.splits-body td { padding: 5px 4px; border-bottom: 1px solid var(--surface-alt); }
.splits-body small { font-size: 10px; color: var(--text-muted); }
@media (max-width: 720px) {
  .card.splits { flex: 0 0 auto; min-height: 0; }
  .splits-body { position: static; max-height: 230px; }
}
</style>
