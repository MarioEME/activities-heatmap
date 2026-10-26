<script>
// Per-viewer display preferences shared by every chart on screen (localStorage
// is only a convenience; the page works without it).
import { ref } from 'vue'
function boolRef(key, def) {
  let v = def
  try { const s = localStorage.getItem(key); if (s !== null) v = s === '1' } catch (e) { /* storage unavailable */ }
  const r = ref(v)
  const toggle = () => {
    r.value = !r.value
    try { localStorage.setItem(key, r.value ? '1' : '0') } catch (e) { /* ignore */ }
  }
  return [r, toggle]
}
const [prefElev, toggleElev] = boolRef('chartElev', true)
const [prefPace, togglePace] = boolRef('chartPace', true)
const [showBands, toggleBands] = boolRef('elevBands', true)
</script>

<script setup>
// One chart for the activity: elevation (grey area, scale on the left) and
// pace / speed (blue line, scale on the right) against distance, each one
// can be shown or hidden. Moving the mouse / a finger over it shows the values
// at that point and emits `hover` with the map position.
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { t } from '../i18n'

const props = defineProps({
  profileState: { type: Object, required: true }, // { status, data } — elevation, see utils/elevationProfile.js
  paceState: { type: Object, required: true }, // { status, data } — speed series
  mode: { type: String, default: 'pace' }, // 'pace' (min/km) | 'speed' (km/h)
  message: { type: String, default: '' },
})
const emit = defineEmits(['hover'])

const elev = computed(() => (props.profileState.status === 'ready' ? props.profileState.data : null))
const paceData = computed(() => (props.paceState.status === 'ready' ? props.paceState.data : null))
const loading = computed(() => props.profileState.status === 'loading' || props.paceState.status === 'loading')

// what is actually drawn: available AND switched on
const showE = computed(() => !!elev.value && prefElev.value)
const showP = computed(() => !!paceData.value && (prefPace.value || !elev.value))
const showEActual = computed(() => !!elev.value && (prefElev.value || !paceData.value))
// can a toggle be switched off? only if the other one stays visible
const canToggleE = computed(() => !!elev.value && !!paceData.value)
const canToggleP = computed(() => !!elev.value && !!paceData.value)
function onToggleE() { if (!canToggleE.value) return; if (prefElev.value && !prefPace.value) togglePace(); toggleElev() }
function onToggleP() { if (!canToggleP.value) return; if (prefPace.value && !prefElev.value) toggleElev(); togglePace() }

const root = ref(null)
const width = ref(400)
const height = ref(120)
let ro = null
onMounted(() => {
  const measure = () => {
    if (!root.value) return
    width.value = Math.max(120, root.value.clientWidth)
    height.value = Math.max(70, root.value.clientHeight)
  }
  measure()
  ro = new ResizeObserver(measure)
  ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())

const MARKER_BLUE = '#1d6fe0'
const PACE_BLUE = '#2f80ed'
const ELEV_FILL = '#8b8579'
const PAD_L = 40
const padR = computed(() => (showP.value ? 46 : 10))
const PAD_T = 10
const PAD_B = 20
const plotW = computed(() => Math.max(10, width.value - PAD_L - padR.value))
const plotH = computed(() => Math.max(10, height.value - PAD_T - PAD_B))

const xMax = computed(() => Math.max(
  elev.value ? elev.value.dist[elev.value.dist.length - 1] : 0,
  paceData.value ? paceData.value.dist[paceData.value.dist.length - 1] : 0,
  0.001,
))
const sx = (km) => PAD_L + (km / xMax.value) * plotW.value

function niceStep(span, target) {
  const raw = span / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow
}
function ticks(lo, hi, target) {
  const step = niceStep(hi - lo, target)
  const out = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v)
  return { values: out, step }
}
const yTarget = computed(() => Math.max(2, Math.floor(plotH.value / 34)))

// ---- elevation (left axis) -----------------------------------------------------
const eRange = computed(() => {
  if (!elev.value) return { lo: 0, hi: 1 }
  let lo = elev.value.min
  let hi = elev.value.max
  if (hi - lo < 10) { const m = (hi + lo) / 2; lo = m - 5; hi = m + 5 }
  const pad = (hi - lo) * 0.06
  return { lo: lo - pad, hi: hi + pad }
})
const sye = (m) => PAD_T + (1 - (m - eRange.value.lo) / (eRange.value.hi - eRange.value.lo)) * plotH.value
const eTicks = computed(() =>
  ticks(eRange.value.lo, eRange.value.hi, yTarget.value).values.map((v) => ({ v, y: sye(v), label: String(Math.round(v)) })))
const elevLine = computed(() => {
  if (!elev.value) return ''
  const { dist, ele } = elev.value
  let d = ''
  for (let i = 0; i < dist.length; i++) d += `${i ? 'L' : 'M'}${sx(dist[i]).toFixed(1)},${sye(ele[i]).toFixed(1)}`
  return d
})
const elevArea = computed(() => {
  if (!elev.value) return ''
  const { dist } = elev.value
  const base = (PAD_T + plotH.value).toFixed(1)
  return `${elevLine.value}L${sx(dist[dist.length - 1]).toFixed(1)},${base}L${sx(dist[0]).toFixed(1)},${base}Z`
})

// ---- climb steepness bands --------------------------------------------------------
// Full-height vertical bands, one colour per steepness level of the CLIMB at that
// point (> 10 %, > 20 %, > 30 %), only in the space ABOVE the elevation line. The
// gradient is measured over a short window (>= ~60 m) so altitude noise between two
// neighbouring samples doesn't paint false spikes.
const GRADE_LEVELS = [
  { min: 10, color: '#9fd3f5', label: '> 10%' },
  { min: 20, color: '#1ea7ef', label: '> 20%' },
  { min: 30, color: '#0b5d9b', label: '> 30%' },
]
const MIN_WINDOW_KM = 0.06
function levelOf(g) {
  let lvl = -1
  for (let k = 0; k < GRADE_LEVELS.length; k++) if (g > GRADE_LEVELS[k].min) lvl = k
  return lvl
}
function gradeAt(i) {
  const { dist, ele } = elev.value
  const n = dist.length
  let lo = Math.max(0, i - 1)
  let hi = Math.min(n - 1, i + 1)
  while (dist[hi] - dist[lo] < MIN_WINDOW_KM && (lo > 0 || hi < n - 1) && hi - lo < 8) {
    if (lo > 0) lo--
    if (hi < n - 1 && dist[hi] - dist[lo] < MIN_WINDOW_KM) hi++
  }
  const span = (dist[hi] - dist[lo]) * 1000
  return span > 0 ? ((ele[hi] - ele[lo]) / span) * 100 : null
}
const gradeBands = computed(() => {
  if (!elev.value) return []
  const { dist } = elev.value
  const n = dist.length
  if (n < 3) return []
  const levels = new Array(n)
  for (let i = 0; i < n; i++) { const g = gradeAt(i); levels[i] = g == null ? -1 : levelOf(g) }
  const edge = (i) => (i <= 0 ? dist[0] : i >= n ? dist[n - 1] : (dist[i - 1] + dist[i]) / 2)
  const bands = []
  let start = 0
  for (let i = 1; i <= n; i++) {
    if (i < n && levels[i] === levels[start]) continue
    if (levels[start] >= 0) {
      const x0 = sx(edge(start))
      const x1 = sx(edge(i))
      bands.push({ x: x0, w: Math.max(1, x1 - x0), color: GRADE_LEVELS[levels[start]].color })
    }
    start = i
  }
  return bands
})
const hasBands = computed(() => showE.value && gradeBands.value.length > 0)
const clipId = `chart-clip-${Math.random().toString(36).slice(2, 8)}`
const aboveLine = computed(() => {
  if (!elev.value) return ''
  const { dist } = elev.value
  const top = PAD_T.toFixed(1)
  return `${elevLine.value}L${sx(dist[dist.length - 1]).toFixed(1)},${top}L${sx(dist[0]).toFixed(1)},${top}Z`
})
const gradId = `chart-grad-${Math.random().toString(36).slice(2, 8)}`

// ---- pace / speed (right axis) -------------------------------------------------------
const isPace = computed(() => props.mode === 'pace')
const pVals = computed(() => (paceData.value
  ? paceData.value.speed.map((v) => (v == null ? null : isPace.value ? 3600 / v : v))
  : []))
const pRange = computed(() => {
  const vs = pVals.value.filter((v) => v != null).sort((a, b) => a - b)
  if (!vs.length) return { lo: 0, hi: 1 }
  let lo = vs[Math.floor(vs.length * 0.05)]
  let hi = vs[Math.min(vs.length - 1, Math.floor(vs.length * 0.95))]
  const minSpan = isPace.value ? 30 : 4
  if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2 }
  const pad = (hi - lo) * 0.1
  return { lo: Math.max(0, lo - pad), hi: hi + pad }
})
// pace: faster (smaller number) at the top; speed: faster (bigger) at the top
const syp = (v) => {
  const c = Math.min(pRange.value.hi, Math.max(pRange.value.lo, v))
  const f = (c - pRange.value.lo) / (pRange.value.hi - pRange.value.lo)
  return PAD_T + (isPace.value ? f : 1 - f) * plotH.value
}
function fmtPace(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`
}
const fmtP = (v) => (isPace.value ? `${fmtPace(v)} /km` : `${v.toFixed(1)} km/h`)
const PACE_STEPS = [5, 10, 15, 20, 30, 60, 120, 300]
const pTicks = computed(() => {
  const { lo, hi } = pRange.value
  let vals
  if (isPace.value) {
    const count = (s) => Math.floor(hi / s) - Math.ceil(lo / s) + 1
    const step = PACE_STEPS.find((s) => count(s) >= 2 && count(s) <= yTarget.value)
      || PACE_STEPS.find((s) => count(s) >= 2 && count(s) <= yTarget.value + 2)
      || PACE_STEPS[0]
    vals = []
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) vals.push(v)
  } else {
    vals = ticks(lo, hi, yTarget.value).values
  }
  return vals.map((v) => ({ v, y: syp(v), label: isPace.value ? fmtPace(v) : String(Math.round(v)) }))
})
const paceLine = computed(() => {
  if (!paceData.value) return ''
  const { dist } = paceData.value
  let d = ''
  let pen = false
  for (let i = 0; i < dist.length; i++) {
    const v = pVals.value[i]
    if (v == null) { pen = false; continue } // stopped: break the line
    d += `${pen ? 'L' : 'M'}${sx(dist[i]).toFixed(1)},${syp(v).toFixed(1)}`
    pen = true
  }
  return d
})

// grid + x axis follow the elevation scale when it is shown, the pace one otherwise
const gridTicks = computed(() => (showE.value ? eTicks.value : pTicks.value))
const xTicks = computed(() => {
  const tk = ticks(0, xMax.value, Math.max(2, Math.floor(plotW.value / 70)))
  const decimals = tk.step < 1 ? 1 : 0
  return tk.values.map((v) => ({ v, x: sx(v), label: v.toFixed(decimals) }))
})

// ---- hover ------------------------------------------------------------------------------
const hoverKm = ref(null)
function indexAt(dist, km) {
  let lo = 0
  let hi = dist.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (dist[mid] < km) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(dist[lo - 1] - km) < Math.abs(dist[lo] - km)) return lo - 1
  return lo
}
function onMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const km = Math.min(xMax.value, Math.max(0, ((e.clientX - rect.left - PAD_L) / plotW.value) * xMax.value))
  hoverKm.value = km
  const src = showE.value ? elev.value : paceData.value
  const i = indexAt(src.dist, km)
  emit('hover', { lat: src.lat[i], lon: src.lon[i] })
}
function onLeave() {
  hoverKm.value = null
  emit('hover', null)
}
const hover = computed(() => {
  const km = hoverKm.value
  if (km == null) return null
  const h = { x: sx(km), km }
  if (showE.value) {
    const i = indexAt(elev.value.dist, km)
    h.ele = elev.value.ele[i]
    h.ey = sye(h.ele)
    h.grade = gradeAt(i)
  }
  if (showP.value) {
    const i = indexAt(paceData.value.dist, km)
    const v = pVals.value[i]
    h.pace = v
    h.py = v == null ? null : syp(v)
  }
  return h
})
const readoutLeft = computed(() => hover.value && hover.value.x > PAD_L + plotW.value / 2)
</script>

<template>
  <div class="chart-wrap">
    <div v-if="elev || paceData" class="chips">
      <button
        v-if="elev"
        type="button"
        class="chip"
        :class="{ off: !showE }"
        :aria-pressed="showE"
        :disabled="!canToggleE"
        :title="t('panel.chartToggle')"
        @click="onToggleE"
      ><span class="sw" :style="{ background: ELEV_FILL }"></span>{{ t('panel.elevationTitle') }}</button>
      <button
        v-if="paceData"
        type="button"
        class="chip"
        :class="{ off: !showP }"
        :aria-pressed="showP"
        :disabled="!canToggleP"
        :title="t('panel.chartToggle')"
        @click="onToggleP"
      ><span class="sw line" :style="{ background: PACE_BLUE }"></span>{{ isPace ? t('panel.paceTitle') : t('panel.speedTitle') }}</button>
      <button
        v-if="hasBands || (elev && prefElev && gradeBands.length)"
        type="button"
        class="chip"
        :class="{ off: !showBands }"
        :aria-pressed="showBands"
        :title="t('panel.slopeToggle')"
        @click="toggleBands"
      >
        <span class="sw-row" aria-hidden="true">
          <span v-for="g in GRADE_LEVELS" :key="g.label" class="sw" :style="{ background: g.color }"></span>
        </span>{{ t('panel.slope') }}
      </button>
    </div>

    <div ref="root" class="chart-root">
      <svg
        v-if="elev || paceData"
        :width="width"
        :height="height"
        class="chart-svg"
        role="img"
        aria-label="Perfil da atividade"
        @pointermove="onMove"
        @pointerdown="onMove"
        @pointerleave="onLeave"
        @pointercancel="onLeave"
      >
        <defs>
          <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" :stop-color="ELEV_FILL" stop-opacity="0.45" />
            <stop offset="100%" :stop-color="ELEV_FILL" stop-opacity="0.08" />
          </linearGradient>
          <clipPath :id="clipId"><path :d="aboveLine" /></clipPath>
        </defs>

        <g class="grid">
          <line v-for="tk in gridTicks" :key="'g' + tk.v" :x1="PAD_L" :x2="PAD_L + plotW" :y1="tk.y" :y2="tk.y" />
        </g>
        <g class="axis-text">
          <template v-if="showE">
            <text v-for="tk in eTicks" :key="'e' + tk.v" :x="PAD_L - 6" :y="tk.y + 3.5" text-anchor="end">{{ tk.label }}</text>
          </template>
          <template v-if="showP">
            <text
              v-for="tk in pTicks"
              :key="'p' + tk.v"
              class="pace-tick"
              :x="PAD_L + plotW + 6"
              :y="tk.y + 3.5"
              text-anchor="start"
            >{{ tk.label }}</text>
          </template>
          <text v-for="(tk, i) in xTicks" :key="'x' + tk.v" :x="tk.x" :y="PAD_T + plotH + 14" text-anchor="middle">{{ i === 0 ? tk.label + ' km' : tk.label }}</text>
        </g>

        <g v-if="showE && showBands" class="bands" aria-hidden="true" :clip-path="`url(#${clipId})`">
          <rect v-for="(b, i) in gradeBands" :key="i" :x="b.x" :y="PAD_T" :width="b.w" :height="plotH" :fill="b.color" />
        </g>
        <template v-if="showE">
          <path :d="elevArea" :fill="`url(#${gradId})`" />
          <path :d="elevLine" fill="none" :stroke="ELEV_FILL" stroke-width="1.4" stroke-linejoin="round" />
        </template>
        <path v-if="showP" :d="paceLine" fill="none" :stroke="PACE_BLUE" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" />

        <g v-if="hover" class="cursor">
          <line :x1="hover.x" :x2="hover.x" :y1="PAD_T" :y2="PAD_T + plotH" />
          <circle v-if="hover.ele != null" :cx="hover.x" :cy="hover.ey" r="3.5" :fill="ELEV_FILL" stroke="#fff" stroke-width="1.5" />
          <circle v-if="hover.py != null" :cx="hover.x" :cy="hover.py" r="4" :fill="MARKER_BLUE" stroke="#fff" stroke-width="1.5" />
        </g>
      </svg>
      <div v-else class="msg">
        <template v-if="loading">{{ t('panel.loading') }}</template>
        <template v-else>{{ profileState.message || t('panel.noData') }}</template>
      </div>

      <!-- values at the point under the cursor; sits on the side away from it -->
      <div v-if="hover" class="readout" :class="{ left: readoutLeft }">
        <div><span>{{ t('panel.rDist') }}</span><b class="mono">{{ hover.km.toFixed(2) }} km</b></div>
        <div v-if="hover.ele != null"><span>{{ t('panel.rElev') }}</span><b class="mono">{{ Math.round(hover.ele) }} m</b></div>
        <div v-if="hover.grade != null"><span>{{ t('panel.rGrade') }}</span><b class="mono">{{ hover.grade.toFixed(1) }} %</b></div>
        <div v-if="showP"><span>{{ isPace ? t('panel.paceTitle') : t('panel.speedTitle') }}</span><b class="mono pace-val">{{ hover.pace == null ? '—' : fmtP(hover.pace) }}</b></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart-wrap { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 0 4px 40px; flex-shrink: 0; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 20px;
  padding: 2px 9px;
  font-size: 11px;
  color: var(--text);
  cursor: pointer;
}
.chip:hover:not(:disabled) { border-color: var(--accent); }
.chip:disabled { cursor: default; }
.chip.off { color: var(--text-muted); background: var(--surface-alt); }
.chip.off .sw, .chip.off .sw-row { opacity: 0.35; }
.sw { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.sw.line { height: 3px; width: 12px; border-radius: 2px; }
.sw-row { display: inline-flex; gap: 2px; }
.chart-root { position: relative; flex: 1; min-height: 70px; }
.chart-svg { display: block; touch-action: pan-y; cursor: crosshair; }
.grid line { stroke: var(--border); stroke-width: 1; }
.axis-text text { fill: var(--text-muted); font-size: 10px; font-family: var(--font-mono); }
.axis-text .pace-tick { fill: #2f80ed; }
.bands rect { opacity: 0.9; }
.cursor line { stroke: var(--text-muted); stroke-width: 1; stroke-dasharray: 3 3; }
.msg {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 12px;
  font-size: 12.5px;
  color: var(--text-muted);
}
.readout {
  position: absolute;
  top: 6px;
  right: 56px;
  display: grid;
  gap: 1px;
  min-width: 118px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 14px -8px rgba(30, 25, 15, 0.3);
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-muted);
  pointer-events: none;
}
.readout.left { right: auto; left: 48px; }
.readout > div { display: flex; justify-content: space-between; gap: 10px; }
.readout b { color: var(--text); font-weight: 600; }
.readout .pace-val { color: #2f80ed; }
</style>
