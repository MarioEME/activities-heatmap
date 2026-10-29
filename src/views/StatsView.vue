<script setup>
// Statistics: best times per distance (computed on demand from the original
// files, cached) and kilometres per activity + running total over time.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useActivitiesStore } from '../stores/activities'
import { t, fmtDate } from '../i18n'
import { isPaceSport, fmtPaceSec } from '../utils/sport'
import { sourceFileExtension } from '../utils/gpxExport'
import { EFFORT_DISTANCES, EFFORTS_VERSION, computeEfforts, loadEffortsCache, saveEffortsCache } from '../utils/bestEfforts'

const store = useActivitiesStore()

// ---------------------------------------------------------------- sport filter
const sports = computed(() => {
  const m = new Map()
  for (const a of store.filtered) if (a.sourceFile) m.set(a.type, (m.get(a.type) || 0) + 1)
  return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([type, n]) => ({ type, n }))
})
const sport = ref(null)
const sportSel = computed(() => {
  if (sport.value && sports.value.some((s) => s.type === sport.value)) return sport.value
  return (sports.value.find((s) => isPaceSport(s.type)) || sports.value[0])?.type || null
})
const pool = computed(() => store.filtered.filter((a) => a.type === sportSel.value && a.sourceFile))

// ---------------------------------------------------------------- best efforts
const cache = ref({})
const computing = ref(false)
const progress = ref({ done: 0, total: 0 })
let cancel = false
onMounted(async () => { cache.value = await loadEffortsCache() })
onBeforeUnmount(() => { cancel = true })

const valid = (a) => {
  const e = cache.value[a.id]
  return e && e.v === EFFORTS_VERSION && e.sf === a.sourceFile
}
const missing = computed(() => pool.value.filter((a) => !valid(a)))

async function calculate() {
  if (computing.value) return
  const todo = [...missing.value]
  if (!todo.length) return
  computing.value = true
  cancel = false
  progress.value = { done: 0, total: todo.length }
  const next = { ...cache.value }
  let sinceSave = 0
  for (const a of todo) {
    if (cancel) break
    try {
      const bytes = await store.fetchOriginalBytes(a.sourceFile)
      if (bytes) {
        const r = await computeEfforts(bytes, sourceFileExtension(a.sourceFile), isPaceSport(a.type) ? 12 : 35)
        next[a.id] = { ...r, sf: a.sourceFile }
      } else next[a.id] = { v: EFFORTS_VERSION, d: {}, sf: a.sourceFile }
    } catch (e) {
      next[a.id] = { v: EFFORTS_VERSION, d: {}, sf: a.sourceFile }
    }
    progress.value = { done: progress.value.done + 1, total: todo.length }
    if (++sinceSave >= 25) { cache.value = { ...next }; await saveEffortsCache(next); sinceSave = 0 }
  }
  cache.value = { ...next }
  await saveEffortsCache(next)
  computing.value = false
}
function stop() { cancel = true }

function fmtTime(sec) {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}
function fmtTimeShort(sec) { // 100 m / 200 m: show tenths
  return sec < 60 ? `${sec.toFixed(1)} s` : fmtTime(sec)
}

const bestRows = computed(() => {
  return EFFORT_DISTANCES.map((d) => {
    let best = null
    for (const a of pool.value) {
      const v = valid(a) ? cache.value[a.id].d[d.key] : null
      if (v != null && (!best || v < best.time)) best = { time: v, a }
    }
    let rate = '—'
    if (best) rate = isPaceSport(sportSel.value) ? (fmtPaceSec(best.time / (d.m / 1000)) || '—') : `${((d.m / 1000) / (best.time / 3600)).toFixed(1)} km/h`
    return { ...d, best, rate }
  })
})
const doneCount = computed(() => pool.value.length - missing.value.length)

// ---------------------------------------------------------------- km per activity
const series = computed(() => {
  const list = store.filtered.filter((a) => a.distanceKm != null && a.date).slice().sort((a, b) => a.date - b.date)
  let tot = 0
  return list.map((a) => { tot += a.distanceKm; return { a, km: a.distanceKm, total: tot, ts: a.date.getTime() } })
})
const wrap = ref(null)
const W = ref(600)
let ro = null
onMounted(() => { ro = new ResizeObserver(() => { if (wrap.value) W.value = Math.max(280, wrap.value.clientWidth) }); ro.observe(wrap.value) })
onBeforeUnmount(() => ro?.disconnect())
const H = 260, PL = 38, PR = 46, PT = 22, PB = 24
const geo = computed(() => {
  const s = series.value
  if (!s.length) return null
  const t0 = s[0].ts, t1 = s[s.length - 1].ts || t0 + 1
  const maxKm = Math.max(...s.map((p) => p.km), 1)
  const maxTot = s[s.length - 1].total || 1
  const pw = W.value - PL - PR, ph = H - PT - PB
  const x = (ts) => PL + (t1 === t0 ? pw / 2 : ((ts - t0) / (t1 - t0)) * pw)
  const yk = (v) => PT + ph - (v / niceMax(maxKm)) * ph
  const yt = (v) => PT + ph - (v / niceMax(maxTot)) * ph
  return { x, yk, yt, t0, t1, mk: niceMax(maxKm), mt: niceMax(maxTot), pw, ph }
})
function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 4, 8, 10]) if (m * p >= v) return m * p
  return v
}
const totalPath = computed(() => {
  const g = geo.value
  if (!g) return ''
  return series.value.map((p, i) => `${i ? 'L' : 'M'}${g.x(p.ts).toFixed(1)} ${g.yt(p.total).toFixed(1)}`).join('')
})
const yTicks = computed(() => {
  const g = geo.value
  if (!g) return []
  return [0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: PT + g.ph - f * g.ph, km: Math.round(g.mk * f * 10) / 10, tot: Math.round(g.mt * f) }))
})
const xTicks = computed(() => {
  const g = geo.value
  if (!g) return []
  const y0 = new Date(g.t0).getFullYear(), y1 = new Date(g.t1).getFullYear()
  const step = Math.max(1, Math.ceil((y1 - y0 + 1) / Math.max(2, Math.floor(g.pw / 70))))
  const out = []
  for (let y = y0; y <= y1 + 1; y += step) {
    const ts = new Date(y, 0, 1).getTime()
    if (ts >= g.t0 - 1 && ts <= g.t1 + 1) out.push({ x: g.x(ts), label: String(y) })
  }
  if (!out.length) out.push({ x: g.x(g.t0), label: String(y0) })
  return out
})
const hover = ref(null)
function onMove(e) {
  const g = geo.value
  if (!g) return
  const r = e.currentTarget.getBoundingClientRect()
  const px = ((e.clientX - r.left) / r.width) * W.value
  const ts = g.t0 + ((px - PL) / g.pw) * (g.t1 - g.t0)
  const s = series.value
  let lo = 0, hi = s.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (s[mid].ts < ts) lo = mid + 1; else hi = mid }
  if (lo > 0 && Math.abs(s[lo - 1].ts - ts) < Math.abs(s[lo].ts - ts)) lo--
  hover.value = s[lo]
}
const totalKm = computed(() => Math.round(series.value.at(-1)?.total || 0))
</script>

<template>
  <div class="stats-page">
    <div class="toolbar"><h2>{{ t('nav.stats') }}</h2><span class="muted note">{{ t('stats.followsFilters') }}</span></div>

    <section class="card">
      <header class="sec-head">
        <h3>{{ t('stats.bestTitle') }}</h3>
        <div class="sports">
          <button v-for="s in sports" :key="s.type" class="chip" :class="{ on: s.type === sportSel }" @click="sport = s.type">{{ s.type }} <span class="mono n">{{ s.n }}</span></button>
        </div>
      </header>

      <div class="calc">
        <template v-if="computing">
          <span class="mono">{{ t('stats.calculating', { done: progress.done, total: progress.total }) }}</span>
          <button class="btn" @click="stop">{{ t('common.cancel') }}</button>
        </template>
        <template v-else>
          <span v-if="missing.length" class="muted">{{ t('stats.missing', { n: missing.length }, missing.length) }}</span>
          <span v-else-if="pool.length" class="muted">{{ t('stats.upToDate', { n: doneCount }, doneCount) }}</span>
          <button v-if="missing.length" class="btn primary" @click="calculate">{{ doneCount ? t('stats.update') : t('stats.calculate') }}</button>
        </template>
      </div>

      <table v-if="pool.length" class="efforts">
        <thead><tr><th>{{ t('stats.distance') }}</th><th class="r">{{ t('stats.time') }}</th><th class="r">{{ isPaceSport(sportSel) ? t('panel.pace') : t('act.col.avgSpeedKmh') }}</th><th>{{ t('stats.activity') }}</th></tr></thead>
        <tbody>
          <tr v-for="r in bestRows" :key="r.key">
            <td class="mono">{{ r.label }}</td>
            <td class="r mono strong">{{ r.best ? fmtTimeShort(r.best.time) : '—' }}</td>
            <td class="r mono">{{ r.rate }}</td>
            <td class="act">
              <button v-if="r.best" class="link" @click="r.best.a.hasTrack && store.focusOnMap(r.best.a.id)">
                <span class="when mono">{{ r.best.a.dateLabel }}</span> <span class="nm">{{ r.best.a.name }}</span>
              </button>
              <span v-else class="muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted pad">{{ t('stats.noData') }}</p>
    </section>

    <section class="card">
      <header class="sec-head">
        <h3>{{ t('stats.kmTitle') }}</h3>
        <span class="muted mono tot">{{ t('stats.totalKm', { km: totalKm }) }}</span>
      </header>
      <div ref="wrap" class="chart-wrap">
        <svg v-if="geo" :viewBox="`0 0 ${W} ${H}`" :width="W" :height="H" @pointermove="onMove" @pointerleave="hover = null">
          <g class="grid">
            <line v-for="tk in yTicks" :key="'g' + tk.y" :x1="PL" :x2="W - PR" :y1="tk.y" :y2="tk.y" />
          </g>
          <g class="axis-l"><text v-for="tk in yTicks" :key="'l' + tk.y" :x="PL - 5" :y="tk.y + 3" text-anchor="end">{{ tk.km }}</text></g>
          <g class="axis-r"><text v-for="tk in yTicks" :key="'r' + tk.y" :x="W - PR + 5" :y="tk.y + 3">{{ tk.tot }}</text></g>
          <text class="unit" :x="PL - 5" :y="10" text-anchor="end">km</text>
          <text class="unit tot" :x="W - PR + 5" :y="10">Σ km</text>
          <g class="x"><text v-for="tk in xTicks" :key="tk.label" :x="tk.x" :y="H - 6" text-anchor="middle">{{ tk.label }}</text></g>
          <g class="bars">
            <line v-for="p in series" :key="p.a.id" :x1="geo.x(p.ts)" :x2="geo.x(p.ts)" :y1="PT + geo.ph" :y2="geo.yk(p.km)" />
          </g>
          <path class="total" :d="totalPath" fill="none" />
          <g v-if="hover">
            <line class="cursor" :x1="geo.x(hover.ts)" :x2="geo.x(hover.ts)" :y1="PT" :y2="PT + geo.ph" />
            <circle :cx="geo.x(hover.ts)" :cy="geo.yk(hover.km)" r="3.5" class="dot-k" />
            <circle :cx="geo.x(hover.ts)" :cy="geo.yt(hover.total)" r="3.5" class="dot-t" />
          </g>
        </svg>
        <p v-else class="muted pad">{{ t('stats.noData') }}</p>
        <div v-if="hover" class="readout mono">
          {{ hover.a.dateLabel }} · {{ hover.a.name }} · <b>{{ hover.km.toFixed(1) }} km</b> · Σ {{ Math.round(hover.total) }} km
        </div>
      </div>
      <div class="legend">
        <span><i class="sw bar"></i>{{ t('stats.perActivity') }}</span>
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
.bars line { stroke: #2f80ed; stroke-width: 1.2; opacity: 0.55; }
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
  .stats-page { padding: 14px 10px 28px; }
  .act { width: 38%; }
  .efforts td, .efforts th { padding-left: 3px; padding-right: 3px; }
  .efforts { font-size: 12px; }
}
</style>
