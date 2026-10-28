<script setup>
// Phones, List tab: a feed of cards instead of a table. Each card shows a small
// route thumbnail plus the basics; tapping it opens the full details and the
// elevation / pace chart in place.
import { ref, computed, onBeforeUnmount } from 'vue'
import { useActivitiesStore, colorForType } from '../stores/activities'
import { t, fmtTimeIn } from '../i18n'
import Icon from './Icon.vue'
import ActivityChart from './ActivityChart.vue'
import { isPaceSport, fmtAvgPace } from '../utils/sport'
import { loadActivitySeries } from '../utils/activitySeries'

const emit = defineEmits(['edit', 'remove'])
const store = useActivitiesStore()

const items = computed(() => [...store.filtered].sort((a, b) => b.date - a.date))
const expandedId = ref(null)
const series = ref({ profile: { status: 'loading' }, pace: { status: 'loading' } })
let token = 0

async function toggle(a) {
  if (expandedId.value === a.id) { expandedId.value = null; return }
  expandedId.value = a.id
  const my = ++token
  series.value = { profile: { status: 'loading' }, pace: { status: 'loading' } }
  const s = await loadActivitySeries(store, a)
  if (my === token) series.value = s
}

// --- thumbnails: drawn only for cards that scroll into view ------------------
const thumbs = ref({}) // id -> { d: svg path } | null (no route)
const pending = new Set()
const io = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        io.unobserve(e.target)
        loadThumb(e.target.dataset.id)
      }
    }, { rootMargin: '300px 0px' })
  : null
onBeforeUnmount(() => io?.disconnect())
function observe(el) { if (el && io) io.observe(el) }

async function loadThumb(id) {
  if (id in thumbs.value || pending.has(id)) return
  const a = store.activities.find((x) => String(x.id) === id)
  if (!a?.hasTrack) { thumbs.value = { ...thumbs.value, [id]: null }; return }
  pending.add(id)
  try {
    const tr = (await store.resolveTracks([a.id])).get(a.id)
    thumbs.value = { ...thumbs.value, [id]: tr?.length ? pathFor(tr) : null }
  } catch (e) {
    thumbs.value = { ...thumbs.value, [id]: null }
  } finally { pending.delete(id) }
}

const W = 96, H = 72, PAD = 5
function pathFor(latlngs) {
  const step = Math.max(1, Math.ceil(latlngs.length / 90))
  const pts = []
  for (let i = 0; i < latlngs.length; i += step) pts.push(latlngs[i])
  pts.push(latlngs[latlngs.length - 1])
  let minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity
  for (const [la, lo] of pts) { minLa = Math.min(minLa, la); maxLa = Math.max(maxLa, la); minLo = Math.min(minLo, lo); maxLo = Math.max(maxLo, lo) }
  const kx = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180) // keep the aspect ratio
  const w = Math.max((maxLo - minLo) * kx, 1e-9), h = Math.max(maxLa - minLa, 1e-9)
  const s = Math.min((W - 2 * PAD) / w, (H - 2 * PAD) / h)
  const ox = (W - w * s) / 2, oy = (H - h * s) / 2
  return pts.map(([la, lo], i) => `${i ? 'L' : 'M'}${(ox + (lo - minLo) * kx * s).toFixed(1)} ${(oy + (maxLa - la) * s).toFixed(1)}`).join('')
}

// --- formatting ----------------------------------------------------------------
const DASH = '—'
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
    [t('panel.elevation'), a.elevationGain != null ? `${Math.round(a.elevationGain)} m ${t('map.gain')}` : DASH],
    [isPaceSport(a.type) ? t('panel.pace') : t('act.col.avgSpeedKmh'), fmtAvgPace(a)],
    [t('panel.hr'), a.avgHr != null ? `${Math.round(a.avgHr)} bpm` : DASH],
  ]
}
</script>

<template>
  <div class="feed">
    <article
      v-for="a in items"
      :key="a.id"
      class="post"
      :class="{ open: expandedId === a.id }"
    >
      <div class="top" role="button" tabindex="0" :aria-expanded="expandedId === a.id" @click="toggle(a)" @keydown.enter="toggle(a)">
        <div class="text">
          <span class="type" :style="{ color: colorForType(a.type) }">{{ a.type }}</span>
          <h3 class="name">{{ a.name }}</h3>
          <span class="when mono">{{ a.dateLabel }}<template v-if="startTime(a)"> · {{ startTime(a) }}</template></span>
          <div class="nums mono">
            <span>{{ a.distanceKm != null ? a.distanceKm.toFixed(1) + ' km' : DASH }}</span>
            <span>{{ a.elevationGain != null ? Math.round(a.elevationGain) + ' m D+' : DASH }}</span>
            <span>{{ fmtAvgPace(a) }}</span>
          </div>
        </div>
        <div class="thumb" :data-id="a.id" :ref="observe">
          <svg v-if="thumbs[a.id]" :viewBox="`0 0 ${W} ${H}`" aria-hidden="true">
            <path :d="thumbs[a.id]" fill="none" :stroke="store.routeColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <Icon v-else :name="a.hasTrack ? 'route' : 'map'" :size="22" class="ph" />
        </div>
      </div>

      <div v-if="expandedId === a.id" class="more">
        <div v-if="tagNames(a).length" class="tags"><span v-for="n in tagNames(a)" :key="n">{{ n }}</span></div>
        <p v-if="a.description" class="desc">{{ a.description }}</p>
        <div class="grid">
          <div v-for="[l, v] in detailRows(a)" :key="l"><span class="l">{{ l }}</span><span class="v mono">{{ v }}</span></div>
          <div class="wide"><span class="l">{{ t('nav.gear') }}</span><span class="v mono">{{ gearName(a) || DASH }}</span></div>
        </div>
        <div class="chart">
          <ActivityChart
            :profile-state="series.profile"
            :pace-state="series.pace"
            :mode="isPaceSport(a.type) ? 'pace' : 'speed'"
            :color="colorForType(a.type)"
          />
        </div>
        <div class="actions">
          <button v-if="a.hasTrack" class="btn-i" :title="t('act.showOnMap')" :aria-label="t('act.showOnMap')" @click="store.focusOnMap(a.id)"><Icon name="map" :size="18" /></button>
          <button class="btn-i" :title="t('common.edit')" :aria-label="t('common.edit')" @click="emit('edit', a)"><Icon name="edit" :size="18" /></button>
          <button class="btn-i" :title="t('common.remove')" :aria-label="t('common.remove')" @click="emit('remove', a)"><Icon name="trash" :size="18" /></button>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.feed { display: flex; flex-direction: column; gap: 10px; padding-bottom: 24px; }
.post {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
  content-visibility: auto;
  contain-intrinsic-size: auto 104px;
}
.post.open { content-visibility: visible; border-color: var(--accent); }
.top { display: flex; gap: 10px; padding: 10px; cursor: pointer; align-items: stretch; }
.text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.type { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; }
.name { margin: 0; font-size: 14.5px; font-weight: 600; color: var(--text); overflow-wrap: anywhere; line-height: 1.25; }
.when { font-size: 11px; color: var(--text-muted); }
.nums { display: flex; flex-wrap: wrap; gap: 2px 10px; margin-top: 4px; font-size: 12px; color: var(--text-dim); }
.thumb {
  flex: 0 0 96px; height: 72px; align-self: center;
  background: var(--surface-alt); border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center; color: var(--text-muted);
}
.thumb svg { width: 100%; height: 100%; }
.more { border-top: 1px solid var(--surface-alt); padding: 10px; }
.tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.tags span { font-size: 11px; background: var(--surface-alt); border-radius: 10px; padding: 1px 8px; color: var(--text-dim); }
.desc { margin: 0 0 8px; font-size: 12px; color: var(--text-dim); line-height: 1.45; white-space: pre-line; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; margin-bottom: 10px; }
.grid > div { display: flex; flex-direction: column; min-width: 0; }
.grid .wide { grid-column: 1 / -1; }
.l { font-size: 10.5px; color: var(--text-muted); }
.v { font-size: 12.5px; color: var(--text); overflow-wrap: anywhere; }
.chart { height: 190px; margin-bottom: 8px; }
.actions { display: flex; gap: 8px; border-top: 1px solid var(--surface-alt); padding-top: 8px; }
.btn-i {
  display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 36px;
  background: var(--surface); border: 1px solid var(--border); color: var(--text-dim);
  padding: 0; border-radius: var(--radius-sm); cursor: pointer;
}
.btn-i:hover { border-color: var(--accent); color: var(--accent-strong); }
</style>
