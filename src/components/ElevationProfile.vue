<script>
// Shared by every profile on screen (map panel + list rows): whether the
// steepness bands are shown. A per-viewer convenience, so localStorage is
// fine (and the page works without it).
import { ref } from 'vue'
const BANDS_KEY = 'elevBands'
function readBands() {
  try { return localStorage.getItem(BANDS_KEY) !== '0' } catch (e) { return true }
}
const showBands = ref(readBands())
function toggleBands() {
  showBands.value = !showBands.value
  try { localStorage.setItem(BANDS_KEY, showBands.value ? '1' : '0') } catch (e) { /* storage unavailable */ }
}
</script>

<script setup>
// Elevation profile: altitude (m) against distance (km), drawn as SVG.
// Moving the mouse / finger over it shows the value at that point and emits
// `hover` with the matching map position, so the map can mark where it is.
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { t } from '../i18n'

const props = defineProps({
  profile: { type: Object, required: true }, // see utils/elevationProfile.js
  color: { type: String, default: '#C9752E' },
})
const emit = defineEmits(['hover'])

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

const PAD = { l: 40, r: 10, t: 8, b: 20 }
const plotW = computed(() => Math.max(10, width.value - PAD.l - PAD.r))
const plotH = computed(() => Math.max(10, height.value - PAD.t - PAD.b))

// A y range with a little headroom; a nearly flat track still gets a
// readable ≥10 m window instead of a magnified noise line.
const yRange = computed(() => {
  let lo = props.profile.min
  let hi = props.profile.max
  if (hi - lo < 10) {
    const mid = (hi + lo) / 2
    lo = mid - 5
    hi = mid + 5
  }
  const pad = (hi - lo) * 0.06
  return { lo: lo - pad, hi: hi + pad }
})

const xMax = computed(() => props.profile.dist[props.profile.dist.length - 1] || 1)

const sx = (km) => PAD.l + (km / xMax.value) * plotW.value
const sy = (m) => PAD.t + (1 - (m - yRange.value.lo) / (yRange.value.hi - yRange.value.lo)) * plotH.value

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

const yTicks = computed(() => {
  const t = ticks(yRange.value.lo, yRange.value.hi, Math.max(2, Math.floor(plotH.value / 34)))
  return t.values.map((v) => ({ v, y: sy(v), label: String(Math.round(v)) }))
})
const xTicks = computed(() => {
  const t = ticks(0, xMax.value, Math.max(2, Math.floor(plotW.value / 70)))
  const decimals = t.step < 1 ? 1 : 0
  return t.values.map((v) => ({ v, x: sx(v), label: v.toFixed(decimals) }))
})

const linePath = computed(() => {
  const { dist, ele } = props.profile
  let d = ''
  for (let i = 0; i < dist.length; i++) d += `${i ? 'L' : 'M'}${sx(dist[i]).toFixed(1)},${sy(ele[i]).toFixed(1)}`
  return d
})
const areaPath = computed(() => {
  const { dist } = props.profile
  const base = (PAD.t + plotH.value).toFixed(1)
  return `${linePath.value}L${sx(dist[dist.length - 1]).toFixed(1)},${base}L${sx(dist[0]).toFixed(1)},${base}Z`
})

// --- climb steepness bands ---------------------------------------------------
// Full-height vertical bands behind the profile, one colour per steepness
// level of the CLIMB at that point (> 10 %, > 20 %, > 30 %). The gradient is
// measured over a short window (>= ~60 m, a few samples) so GPS/altitude noise
// between two neighbouring samples doesn't paint false spikes.
const GRADE_LEVELS = [
  { min: 10, color: '#9fd3f5', label: '> 10%' },
  { min: 20, color: '#1ea7ef', label: '> 20%' },
  { min: 30, color: '#0b5d9b', label: '> 30%' },
]
const MIN_WINDOW_KM = 0.06
const MARKER_BLUE = '#1d6fe0' // same blue as the position marker on the map

function levelOf(g) {
  let lvl = -1
  for (let k = 0; k < GRADE_LEVELS.length; k++) if (g > GRADE_LEVELS[k].min) lvl = k
  return lvl
}

const gradeBands = computed(() => {
  const { dist, ele } = props.profile
  const n = dist.length
  if (n < 3) return []
  const levels = new Array(n)
  for (let i = 0; i < n; i++) {
    let lo = Math.max(0, i - 1)
    let hi = Math.min(n - 1, i + 1)
    while (dist[hi] - dist[lo] < MIN_WINDOW_KM && (lo > 0 || hi < n - 1) && hi - lo < 8) {
      if (lo > 0) lo--
      if (hi < n - 1 && dist[hi] - dist[lo] < MIN_WINDOW_KM) hi++
    }
    const span = (dist[hi] - dist[lo]) * 1000
    levels[i] = span > 0 ? levelOf(((ele[hi] - ele[lo]) / span) * 100) : -1
  }
  // each sample covers from the midpoint to its previous neighbour to the midpoint to its next one
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
const hasBands = computed(() => gradeBands.value.length > 0)
// Bands only fill the space ABOVE the profile line, never the graph itself.
const clipId = `elev-clip-${Math.random().toString(36).slice(2, 8)}`
const aboveLinePath = computed(() => {
  const { dist } = props.profile
  const top = PAD.t.toFixed(1)
  return `${linePath.value}L${sx(dist[dist.length - 1]).toFixed(1)},${top}L${sx(dist[0]).toFixed(1)},${top}Z`
})

const gradId = `elev-grad-${Math.random().toString(36).slice(2, 8)}`

// --- hover cursor -----------------------------------------------------------
const hoverIdx = ref(null)

function indexAt(km) {
  const { dist } = props.profile
  let lo = 0
  let hi = dist.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (dist[mid] < km) lo = mid + 1
    else hi = mid
  }
  // pick the nearer of the two neighbours
  if (lo > 0 && Math.abs(dist[lo - 1] - km) < Math.abs(dist[lo] - km)) return lo - 1
  return lo
}

function onMove(e) {
  const rect = e.currentTarget.getBoundingClientRect()
  const x = e.clientX - rect.left - PAD.l
  const km = Math.min(xMax.value, Math.max(0, (x / plotW.value) * xMax.value))
  const i = indexAt(km)
  hoverIdx.value = i
  emit('hover', { lat: props.profile.lat[i], lon: props.profile.lon[i] })
}
function onLeave() {
  hoverIdx.value = null
  emit('hover', null)
}

const hover = computed(() => {
  const i = hoverIdx.value
  if (i == null) return null
  const km = props.profile.dist[i]
  const m = props.profile.ele[i]
  return { x: sx(km), y: sy(m), km, m }
})
const readout = computed(() =>
  hover.value ? `${hover.value.km.toFixed(2)} km · ${Math.round(hover.value.m)} m` : null,
)
</script>

<template>
  <div ref="root" class="elev-root">
    <svg
      :width="width"
      :height="height"
      class="elev-svg"
      role="img"
      aria-label="Perfil de altimetria"
      @pointermove="onMove"
      @pointerdown="onMove"
      @pointerleave="onLeave"
      @pointercancel="onLeave"
    >
      <defs>
        <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="0.38" />
          <stop offset="100%" :stop-color="color" stop-opacity="0.04" />
        </linearGradient>
        <clipPath :id="clipId"><path :d="aboveLinePath" /></clipPath>
      </defs>

      <g class="grid">
        <line v-for="t in yTicks" :key="'y' + t.v" :x1="PAD.l" :x2="PAD.l + plotW" :y1="t.y" :y2="t.y" />
      </g>
      <g class="axis-text">
        <text v-for="t in yTicks" :key="'yl' + t.v" :x="PAD.l - 6" :y="t.y + 3.5" text-anchor="end">{{ t.label }}</text>
        <text v-for="(t, i) in xTicks" :key="'xl' + t.v" :x="t.x" :y="PAD.t + plotH + 14" text-anchor="middle">{{ i === 0 ? t.label + ' km' : t.label }}</text>
      </g>

      <g v-if="showBands" class="bands" aria-hidden="true" :clip-path="`url(#${clipId})`">
        <rect v-for="(b, i) in gradeBands" :key="i" :x="b.x" :y="PAD.t" :width="b.w" :height="plotH" :fill="b.color" />
      </g>

      <path :d="areaPath" :fill="`url(#${gradId})`" />
      <path :d="linePath" fill="none" :stroke="color" stroke-width="1.6" stroke-linejoin="round" />

      <g v-if="hover" class="cursor">
        <line :x1="hover.x" :x2="hover.x" :y1="PAD.t" :y2="PAD.t + plotH" />
        <circle :cx="hover.x" :cy="hover.y" r="4" :fill="MARKER_BLUE" stroke="#fff" stroke-width="1.5" />
      </g>
    </svg>
    <button
      v-if="hasBands"
      type="button"
      class="bands-toggle"
      :class="{ off: !showBands }"
      :aria-pressed="showBands"
      :title="t('panel.slopeToggle')"
      @click="toggleBands"
    >
      <span class="sw-row" aria-hidden="true">
        <span v-for="g in GRADE_LEVELS" :key="g.label" class="sw" :style="{ background: g.color }" :title="g.label"></span>
      </span>
      <span>{{ t('panel.slope') }}</span>
    </button>
    <div v-if="readout" class="readout mono">{{ readout }}</div>
  </div>
</template>

<style scoped>
.elev-root {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 80px;
}
.elev-svg {
  display: block;
  /* let a horizontal drag scrub the cursor while vertical swipes still scroll */
  touch-action: pan-y;
  cursor: crosshair;
}
.grid line { stroke: var(--border); stroke-width: 1; }
.axis-text text { fill: var(--text-muted); font-size: 10px; font-family: var(--font-mono); }
.axis-text .unit { fill: var(--text-muted); }
.bands-toggle {
  position: absolute;
  top: 4px;
  left: 44px;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px 7px;
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
}
.bands-toggle:hover { border-color: var(--accent); }
.bands-toggle.off { color: var(--text-muted); }
.bands-toggle.off .sw-row { opacity: 0.35; }
.sw-row { display: inline-flex; gap: 2px; }
.sw { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
.bands rect { opacity: 0.9; }
.cursor line { stroke: var(--text-muted); stroke-width: 1; stroke-dasharray: 3 3; }
.readout {
  position: absolute;
  top: 4px;
  right: 10px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 2px 7px;
  font-size: 11px;
  color: var(--text);
  pointer-events: none;
}
</style>
