<script setup>
// Bottom panel shown when an activity is clicked on the map: the activity's
// details (left on desktop, top on mobile) and its elevation profile (right
// on desktop, bottom on mobile). It goes away when the selection is cleared
// (click on an empty part of the map).
import { computed } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { sourceFileExtension } from '../utils/gpxExport'
import ElevationProfile from './ElevationProfile.vue'
import { t, fmtTimeIn } from '../i18n'
import Icon from './Icon.vue'
import { detailCompact, toggleDetailCompact, detailSideCollapsed, toggleDetailSide } from '../utils/viewPrefs'

const props = defineProps({
  activity: { type: Object, required: true },
  // { status: 'loading' | 'ready' | 'none' | 'error', data?, message? }
  profileState: { type: Object, required: true },
  color: { type: String, default: '#C9752E' },
})
const emit = defineEmits(['edit', 'remove', 'download', 'convert', 'hover'])

const store = useActivitiesStore()

// --- formatting --------------------------------------------------------------
const PACE_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'])

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

function fmtPace(movingTimeSec, distanceKm) {
  if (!movingTimeSec || !distanceKm) return null
  const paceSecPerKm = movingTimeSec / distanceKm
  const m = Math.floor(paceSecPerKm / 60)
  const s = Math.round(paceSecPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')} /km`
}

const rows = computed(() => {
  const a = props.activity
  const r = [[t('panel.date'), a.dateLabel]]
  const start = fmtStartTime(a.date, a.tz)
  if (start) r.push([t('panel.start'), start])
  if (a.distanceKm != null) r.push([t('act.distance'), `${a.distanceKm.toFixed(2)} km`])
  if (a.elevationGain != null) r.push([t('panel.elevation'), `${Math.round(a.elevationGain)} m ${t('map.gain')}`])
  if (a.elapsedTime) r.push([t('panel.elapsed'), fmtDuration(a.elapsedTime)])
  if (a.movingTime && a.movingTime !== a.elapsedTime) r.push([t('panel.moving'), fmtDuration(a.movingTime)])
  if (PACE_TYPES.has(a.type)) {
    const pace = fmtPace(a.movingTime, a.distanceKm)
    if (pace) r.push([t('panel.pace'), pace])
  } else if (a.avgSpeedKmh != null) {
    r.push([t('act.col.avgSpeedKmh'), `${a.avgSpeedKmh.toFixed(1)} km/h`])
  }
  if (a.avgHr != null) r.push([t('panel.hr'), `${Math.round(a.avgHr)} bpm`])
  const gear = a.gearId ? store.gearDefs.find((g) => g.id === a.gearId) : null
  if (gear) r.push([t('nav.gear'), gear.name])
  return r
})

// One-line summary shown when the details are collapsed (phones)
const summary = computed(() => {
  const a = props.activity
  const parts = []
  if (a.distanceKm != null) parts.push(`${a.distanceKm.toFixed(1)} km`)
  if (a.elevationGain != null) parts.push(`${Math.round(a.elevationGain)} m D+`)
  const secs = a.movingTime || a.elapsedTime
  if (secs) parts.push(fmtDuration(secs))
  if (a.avgSpeedKmh != null && !PACE_TYPES.has(a.type)) parts.push(`${a.avgSpeedKmh.toFixed(1)} km/h`)
  return parts.join(' · ')
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

const profileMeta = computed(() => {
  const d = props.profileState.data
  if (!d) return ''
  return t('panel.minMax', { min: Math.round(d.min), max: Math.round(d.max) })
})
</script>

<template>
  <section class="activity-panel" :aria-label="t('panel.label')">
    <!-- Details -->
    <div class="card detail" :class="{ compact: detailCompact, 'side-collapsed': detailSideCollapsed }">
      <header class="card-head">
        <span class="dot" :style="{ background: color }"></span>
        <strong class="title" :title="activity.name">{{ activity.name }}</strong>
        <button
          class="head-btn side-toggle"
          :title="detailSideCollapsed ? t('panel.showDetails') : t('panel.hideDetails')"
          :aria-expanded="!detailSideCollapsed"
          @click="toggleDetailSide"
        >{{ detailSideCollapsed ? '▶' : '◀' }}</button>
        <button
          class="head-btn compact-toggle"
          :title="detailCompact ? t('common.moreDetails') : t('common.lessDetails')"
          :aria-expanded="!detailCompact"
          @click="toggleDetailCompact"
        >{{ detailCompact ? '▾' : '▴' }}</button>
      </header>
      <div class="summary-line mono">{{ summary }}</div>

      <div class="card-body detail-body">
        <div class="type-line">
          <span class="type" :style="{ color }">{{ activity.type }}</span>
          <span class="source">· {{ sourceLabel }}</span>
          <span v-for="n in tagNames" :key="n" class="tag">{{ n }}</span>
        </div>
        <p v-if="activity.description" class="desc">{{ activity.description }}</p>

        <div class="stats">
          <div v-for="[label, val] in rows" :key="label" class="stat">
            <span class="stat-label">{{ label }}</span>
            <span class="stat-val mono">{{ val }}</span>
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

    <!-- Elevation profile -->
    <div class="card elevation">
      <header class="card-head">
        <strong class="title">{{ t('panel.elevationTitle') }}</strong>
        <span v-if="profileMeta" class="meta mono">{{ profileMeta }}</span>
      </header>

      <div class="card-body elev-body">
        <ElevationProfile
          v-if="profileState.status === 'ready'"
          :profile="profileState.data"
          :color="color"
          @hover="emit('hover', $event)"
        />
        <div v-else class="elev-msg">
          <template v-if="profileState.status === 'loading'">{{ t('panel.loading') }}</template>
          <template v-else>{{ profileState.message || t('panel.noData') }}</template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.activity-panel {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: stretch; /* both cards same height while open */
  gap: 10px;
  padding: 10px;
  background: var(--bg);
  border-top: 1px solid var(--border-strong);
  position: relative;
  z-index: 600;
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
.card.detail { flex: 0 0 460px; }
.card.elevation { flex: 1 1 0; }

.card-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 6px 6px 12px;
  min-height: 34px;
}
.card-body { border-top: 1px solid var(--surface-alt); }

.dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-right: 4px; }
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
  max-height: 176px;
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
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 6px 12px;
  margin-bottom: 8px;
}
.stat { display: flex; flex-direction: column; min-width: 0; }
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

.elev-body { height: 176px; padding: 4px 2px 0 0; }
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

.summary-line { display: none; }
.compact-toggle { display: none; }

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
  .card.detail.side-collapsed .side-toggle { order: -1; }
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

/* Phones: stacked, details above, elevation at the very bottom. */
@media (max-width: 720px) {
  .activity-panel {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 6px;
  }
  .card.detail, .card.elevation { flex: 0 0 auto; }
  .detail-body { max-height: 30vh; }
  .elev-body { height: 120px; }

  /* Compact details: just the title row and a one-line summary, leaving the
     room to the map and the elevation profile. */
  .compact-toggle { display: inline-block; }
  .card.detail.compact .detail-body { display: none; }
  .card.detail.compact .summary-line {
    display: block;
    padding: 0 12px 8px;
    font-size: 11.5px;
    color: var(--text-dim);
  }
  .card.detail.compact .card-head { min-height: 30px; }
  .card.detail.compact ~ .card.elevation .elev-body { height: 150px; }
}
</style>
