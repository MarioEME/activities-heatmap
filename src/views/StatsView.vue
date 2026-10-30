<script setup>
// Statistics: best times per distance (kept up to date automatically, see
// effortsService.js) and weekly kilometres + running total over a time range.
// Everything covers ALL activities, not just the ones visible on the map.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { useAuthStore } from '../stores/auth'
import { t, fmtDate } from '../i18n'
import { isPaceSport, fmtPaceSec } from '../utils/sport'
import { EFFORT_DISTANCES } from '../utils/bestEfforts'
import { effortsCache, effortsState, effortValid, scheduleEfforts } from '../utils/effortsService'

const store = useActivitiesStore()
const auth = useAuthStore()
onMounted(() => scheduleEfforts(store, auth, 200))

// ---------------------------------------------------------------- best efforts
const sports = computed(() => {
  const m = new Map()
  for (const a of store.activities) if (a.sourceFile) m.set(a.type, (m.get(a.type) || 0) + 1)
  return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([type, n]) => ({ type, n }))
})
const sport = ref(null)
const sportSel = computed(() => {
  if (sport.value && sports.value.some((s) => s.type === sport.value)) return sport.value
  return (sports.value.find((s) => isPaceSport(s.type)) || sports.value[0])?.type || null
})
const pool = computed(() => store.activities.filter((a) => a.type === sportSel.value && a.sourceFile))
const pending = computed(() => store.activities.filter((a) => a.sourceFile && !effortValid(effortsCache.value, a)).length)

function fmtTime(sec) {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}
const fmtTimeShort = (sec) => (sec < 60 ? `${sec.toFixed(1)} s` : fmtTime(sec))

const bestRows = computed(() => {
  return EFFORT_DISTANCES.map((d) => {
    let best = null
    for (const a of pool.value) {
      const v = effortValid(effortsCache.value, a) ? effortsCache.value[a.id].d[d.key] : null
      if (v != null && (!best || v < best.time)) best = { time: v, a }
    }
    let rate = '—'
    if (best) rate = isPaceSport(sportSel.value) ? (fmtPaceSec(best.time / (d.m / 1000)) || '—') : `${((d.m / 1000) / (best.time / 3600)).toFixed(1)} km/h`
    return { ...d, best, rate }
  })
})

// ---------------------------------------------------------------- weekly km
const RANGES = ['ytd', '1y', '2y', '5y', 'all']
const range = ref('1y')
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)) // Monday
  return x
}
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const weeks = computed(() => {
  const acts = store.activities.filter((a) => a.distanceKm != null && a.date && !isNaN(a.date))
  if (!acts.length) return []
  const now = new Date()
  let from
  if (range.value === 'ytd') from = new Date(now.getFullYear(), 0, 1)
  else if (range.value === 'all') from = new Date(Math.min(...acts.map((a) => a.date.getTime())))
  else { from = new Date(now); from.setFullYear(now.getFullYear() - parseInt(range.value, 10)) }
  const first = weekStart(from)
  const sums = new Map()
  for (const a of acts) {
    if (a.date < first) continue
    const k = dayKey(weekStart(a.date))
    sums.set(k, (sums.get(k) || 0) + a.distanceKm)
  }
  const out = []
  let tot = 0
  for (const d = new Date(first); d <= now; d.setDate(d.getDate() + 7)) {
    const km = sums.get(dayKey(d)) || 0
    tot += km
    out.push({ date: new Date(d), km, total: tot })
  }
  return out
})
const rangeTotal = computed(() => Math.round(weeks.value.at(-1)?.total || 0))

const wrap = ref(null)
const W = ref(600)
let ro = null
onMounted(() => { ro = new ResizeObserver(() => { if (wrap.value) W.value = Math.max(280, wrap.value.clientWidth) }); ro.observe(wrap.value) })
onBeforeUnmount(() => ro?.disconnect())
const H = 260, PL = 38, PR = 46, PT = 22, PB = 24
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 4, 8, 10]) if (m * p >= v) return m * p
  return v
}
const geo = computed(() => {
  const w = weeks.value
  if (!w.length) return null
  const mk = niceMax(Math.max(...w.map((p) => p.km), 1))
  const mt = niceMax(w[w.length - 1].total || 1)
  const pw = W.value - PL - PR, ph = H - PT - PB
  const n = w.length
  const x = (i) => PL + ((i + 0.5) / n) * pw
  return { n, mk, mt, pw, ph, x, bw: Math.max(1, pw / n - (pw / n > 4 ? 1 : 0)), yk: (v) => PT + ph - (v / mk) * ph, yt: (v) => PT + ph - (v / mt) * ph }
})
const totalPath = computed(() => {
  const g = geo.value
  return g ? weeks.value.map((p, i) => `${i ? 'L' : 'M'}${g.x(i).toFixed(1)} ${g.yt(p.total).toFixed(1)}`).join('') : ''
})
const yTicks = computed(() => {
  const g = geo.value
  if (!g) return []
  return [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: PT + g.ph - f * g.ph, km: Math.round(g.mk * f * 10) / 10, tot: Math.round(g.mt * f) }))
})
const xTicks = computed(() => {
  const g = geo.value
  if (!g) return []
  const byYear = g.n > 110
  const out = []
  let lastX = -100
  weeks.value.forEach((p, i) => {
    const prev = weeks.value[i - 1]
    const changed = !prev || (byYear ? prev.date.getFullYear() !== p.date.getFullYear() : prev.date.getMonth() !== p.date.getMonth())
    if (!changed) return
    const x = g.x(i)
    if (x - lastX < 38) return
    lastX = x
    out.push({ x, label: byYear ? String(p.date.getFullYear()) : p.date.toLocaleDateString(undefined, { month: 'short' }) })
  })
  return out
})
const hover = ref(null)
function onMove(e) {
  const g = geo.value
  if (!g) return
  const r = e.currentTarget.getBoundingClientRect()
  const px = ((e.clientX - r.left) / r.width) * W.value
  const i = Math.min(g.n - 1, Math.max(0, Math.floor(((px - PL) / g.pw) * g.n)))
  hover.value = { i, ...weeks.value[i] }
}
</script>

<template>
  <div class="stats-page">
    <div class="toolbar"><h2>{{ t('nav.stats') }}</h2></div>

    <section class="card">
      <header class="sec-head">
        <h3>{{ t('stats.bestTitle') }}</h3>
        <div class="sports">
          <button v-for="s in sports" :key="s.type" class="chip" :class="{ on: s.type === sportSel }" @click="sport = s.type">{{ s.type }} <span class="mono n">{{ s.n }}</span></button>
        </div>
      </header>
      <p v-if="effortsState.running" class="calc muted mono">{{ t('stats.calculating', { done: effortsState.done, total: effortsState.total }) }}</p>
      <p v-else-if="pending" class="calc muted">{{ t('stats.pending', { n: pending }, pending) }}</p>

      <table v-if="pool.length" class="efforts">
        <thead><tr><th>{{ t('stats.distance') }}</th><th class="r">{{ t('stats.time') }}</th><th class="r">{{ isPaceSport(sportSel) ? t('panel.pace') : t('act.col.avgSpeedKmh') }}</th><th class="act-col">{{ t('stats.activity') }}</th></tr></thead>
        <tbody>
          <template v-for="r in bestRows" :key="r.key">
            <tr class="main">
              <td class="mono">{{ r.label }}</td>
              <td class="r mono strong">{{ r.best ? fmtTimeShort(r.best.time) : '—' }}</td>
              <td class="r mono">{{ r.rate }}</td>
              <td class="act act-col">
                <button v-if="r.best" class="link" @click="r.best.a.hasTrack && store.focusOnMap(r.best.a.id)">
                  <span class="when mono">{{ r.best.a.dateLabel }}</span> <span class="nm">{{ r.best.a.name }}</span>
                </button>
                <span v-else class="muted">—</span>
              </td>
            </tr>
            <tr v-if="r.best" class="sub">
              <td colspan="3">
                <button class="link" @click="r.best.a.hasTrack && store.focusOnMap(r.best.a.id)">
                  <span class="when mono">{{ r.best.a.dateLabel }}</span> <span class="nm">{{ r.best.a.name }}</span>
                </button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p v-else class="muted pad">{{ t('stats.noData') }}</p>
    </section>

    <section class="card">
      <header class="sec-head">
        <h3>{{ t('stats.kmTitle') }}</h3>
        <div class="sports">
          <button v-for="r in RANGES" :key="r" class="chip" :class="{ on: r === range }" @click="range = r">{{ t('stats.range.' + r) }}</button>
        </div>
      </header>
      <p class="muted mono tot">{{ t('stats.totalKm', { km: rangeTotal }) }}</p>
      <div ref="wrap" class="chart-wrap">
        <svg v-if="geo" :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" @pointermove="onMove" @pointerdown="onMove" @pointerleave="hover = null">
          <g class="grid">
            <line v-for="tk in yTicks" :key="'g' + tk.y" :x1="PL" :x2="W - PR" :y1="tk.y" :y2="tk.y" />
          </g>
          <g class="axis-l"><text v-for="tk in yTicks" :key="'l' + tk.y" :x="PL - 5" :y="tk.y + 3" text-anchor="end">{{ tk.km }}</text></g>
          <g class="axis-r"><text v-for="tk in yTicks" :key="'r' + tk.y" :x="W - PR + 5" :y="tk.y + 3">{{ tk.tot }}</text></g>
          <text class="unit" :x="PL - 5" :y="10" text-anchor="end">km</text>
          <text class="unit tot" :x="W - PR + 5" :y="10">Σ km</text>
          <g class="x"><text v-for="tk in xTicks" :key="tk.x" :x="tk.x" :y="H - 6" text-anchor="middle">{{ tk.label }}</text></g>
          <g class="bars">
            <rect v-for="(p, i) in weeks" :key="i" v-show="p.km > 0" :x="geo.x(i) - geo.bw / 2" :width="geo.bw" :y="geo.yk(p.km)" :height="PT + geo.ph - geo.yk(p.km)" :class="{ hot: hover && hover.i === i }" />
          </g>
          <path class="total" :d="totalPath" fill="none" />
          <g v-if="hover">
            <line class="cursor" :x1="geo.x(hover.i)" :x2="geo.x(hover.i)" :y1="PT" :y2="PT + geo.ph" />
            <circle :cx="geo.x(hover.i)" :cy="geo.yt(hover.total)" r="3.5" class="dot-t" />
          </g>
        </svg>
        <p v-else class="muted pad">{{ t('stats.noData') }}</p>
        <div class="readout mono">
          <template v-if="hover">{{ t('stats.weekOf', { d: fmtDate(hover.date) }) }} · <b>{{ hover.km.toFixed(1) }} km</b> · Σ {{ Math.round(hover.total) }} km</template>
        </div>
      </div>
      <div class="legend">
        <span><i class="sw bar"></i>{{ t('stats.perWeek') }}</span>
        <span><i class="sw line"></i>{{ t('stats.cumulative') }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.stats-page { padding: 20px 24px 40px; max-width: 1000px; width: 100%; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }
.toolbar { display: flex; align-items: baseline; gap: 12px; }
.toolbar h2 { margin: 0; font-family: var(--font-display); font-size: 22px; font-weight: 400; }
.note { font-size: 12px; }
.tot { font-size: 12px; }
.muted { color: var(--text-muted); }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px 14px 14px; }
.sec-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.sec-head h3 { margin: 0; font-size: 14px; }
.sports { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { background: var(--surface); border: 1px solid var(--border-strong); border-radius: 20px; padding: 2px 10px; font-size: 12px; color: var(--text-dim); cursor: pointer; }
.chip.on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.chip .n { font-size: 10.5px; opacity: 0.75; }
.calc { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; font-size: 12.5px; }
.btn { background: var(--surface); border: 1px solid var(--border-strong); color: var(--text); border-radius: var(--radius-sm); padding: 5px 12px; font-size: 12.5px; cursor: pointer; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.efforts { width: 100%; border-collapse: collapse; font-size: 13px; }
.efforts th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); font-weight: 600; padding: 6px 6px; border-bottom: 1px solid var(--border); }
.efforts td { padding: 8px 6px; border-bottom: 1px solid var(--surface-alt); }
.r { text-align: right; }
.strong { font-weight: 700; color: var(--text); }
.act { max-width: 0; width: 45%; }
.link { background: transparent; border: none; padding: 0; text-align: left; font: inherit; color: var(--text); cursor: pointer; max-width: 100%; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.link:hover .nm { color: var(--accent-strong); text-decoration: underline; }
.when { font-size: 11px; color: var(--text-muted); }
.pad { padding: 12px 4px; margin: 0; }
.chart-wrap { position: relative; width: 100%; }
svg { display: block; width: 100%; height: auto; touch-action: pan-y; }
.grid line { stroke: var(--border); stroke-width: 1; }
text { font-size: 10px; fill: var(--text-muted); font-family: var(--font-mono, monospace); }
.axis-r text, .unit.tot { fill: var(--accent-strong); }
.bars rect { fill: #2f80ed; opacity: 0.6; }
.bars rect.hot { opacity: 1; }
.sub { display: none; }
.calc { margin: 0 0 8px; font-size: 12px; }
.total { stroke: var(--accent-strong); stroke-width: 2; }
.cursor { stroke: var(--text-muted); stroke-dasharray: 3 3; }
.dot-k { fill: #2f80ed; stroke: #fff; stroke-width: 1.5; }
.dot-t { fill: var(--accent-strong); stroke: #fff; stroke-width: 1.5; }
.readout { font-size: 11.5px; color: var(--text-dim); padding: 4px 2px 0; min-height: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.legend { display: flex; gap: 16px; font-size: 11.5px; color: var(--text-dim); margin-top: 6px; }
.sw { display: inline-block; vertical-align: middle; margin-right: 6px; }
.sw.bar { width: 3px; height: 12px; background: #2f80ed; opacity: 0.7; }
.sw.line { width: 14px; height: 3px; background: var(--accent-strong); }
@media (max-width: 720px) {
  .act-col { display: none; }
  .sub { display: table-row; }
  .sub td { padding: 0 3px 8px; border-bottom: 1px solid var(--surface-alt); }
  .efforts tr.main td { border-bottom: none; padding-bottom: 2px; }
  .stats-page { padding: 14px 10px 28px; }
  
  .efforts td, .efforts th { padding-left: 3px; padding-right: 3px; }
  .efforts { font-size: 12px; }
}
</style>
