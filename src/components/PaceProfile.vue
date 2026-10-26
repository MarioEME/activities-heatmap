<script setup>
// Pace (min/km, for running and walking) or speed (km/h, for everything else)
// against distance, drawn as SVG. Same interaction as the elevation profile:
// moving over it shows the value and emits `hover` with the map position.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  series: { type: Object, required: true }, // { dist[], speed[], lat[], lon[] } — see utils/elevationProfile.js
  mode: { type: String, default: 'pace' }, // 'pace' | 'speed'
  color: { type: String, default: '#C9752E' },
})
const emit = defineEmits(['hover'])

const root = ref(null)
const width = ref(400)
const height = ref(100)
let ro = null
onMounted(() => {
  const measure = () => {
    if (!root.value) return
    width.value = Math.max(120, root.value.clientWidth)
    height.value = Math.max(60, root.value.clientHeight)
  }
  measure()
  ro = new ResizeObserver(measure)
  ro.observe(root.value)
})
onBeforeUnmount(() => ro?.disconnect())

const PAD = { l: 40, r: 10, t: 8, b: 20 }
const plotW = computed(() => Math.max(10, width.value - PAD.l - PAD.r))
const plotH = computed(() => Math.max(10, height.value - PAD.t - PAD.b))
const isPace = computed(() => props.mode === 'pace')
const MARKER_BLUE = '#1d6fe0'

// value plotted: seconds per km (pace) or km/h (speed); null = stopped
const values = computed(() => props.series.speed.map((v) => (v == null ? null : isPace.value ? 3600 / v : v)))

// Robust range (5th..95th percentile) so a stop or a sprint doesn't squash the line
const range = computed(() => {
  const vs = values.value.filter((v) => v != null).sort((a, b) => a - b)
  if (!vs.length) return { lo: 0, hi: 1 }
  let lo = vs[Math.floor(vs.length * 0.05)]
  let hi = vs[Math.min(vs.length - 1, Math.floor(vs.length * 0.95))]
  const minSpan = isPace.value ? 30 : 4
  if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2 }
  const pad = (hi - lo) * 0.1
  return { lo: Math.max(0, lo - pad), hi: hi + pad }
})

const xMax = computed(() => props.series.dist[props.series.dist.length - 1] || 1)
const sx = (km) => PAD.l + (km / xMax.value) * plotW.value
// pace: faster (smaller number) at the top; speed: faster (bigger) at the top
const sy = (v) => {
  const c = Math.min(range.value.hi, Math.max(range.value.lo, v))
  const f = (c - range.value.lo) / (range.value.hi - range.value.lo)
  return PAD.t + (isPace.value ? f : 1 - f) * plotH.value
}

function fmtPace(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, '0')}`
}
const fmtValue = (v) => (isPace.value ? `${fmtPace(v)} /km` : `${v.toFixed(1)} km/h`)

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
const PACE_STEPS = [5, 10, 15, 20, 30, 60, 120, 300]
const yTicks = computed(() => {
  const target = Math.max(3, Math.floor(plotH.value / 24))
  const { lo, hi } = range.value
  let vals
  if (isPace.value) {
    const step = PACE_STEPS.find((s) => (hi - lo) / s <= target) || 300
    vals = []
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) vals.push(v)
  } else {
    vals = ticks(lo, hi, target).values
  }
  return vals.map((v) => ({ v, y: sy(v), label: isPace.value ? fmtPace(v) : String(Math.round(v)) }))
})
const xTicks = computed(() => {
  const t = ticks(0, xMax.value, Math.max(2, Math.floor(plotW.value / 70)))
  const decimals = t.step < 1 ? 1 : 0
  return t.values.map((v) => ({ v, x: sx(v), label: v.toFixed(decimals) }))
})

// the line is broken where the athlete was stopped
const linePath = computed(() => {
  const { dist } = props.series
  let d = ''
  let pen = false
  for (let i = 0; i < dist.length; i++) {
    const v = values.value[i]
    if (v == null) { pen = false; continue }
    d += `${pen ? 'L' : 'M'}${sx(dist[i]).toFixed(1)},${sy(v).toFixed(1)}`
    pen = true
  }
  return d
})
const areaPath = computed(() => {
  const { dist } = props.series
  const base = (PAD.t + plotH.value).toFixed(1)
  let d = ''
  let start = null
  let last = null
  const close = () => { if (start != null) d += `L${last},${base}L${start},${base}Z` }
  for (let i = 0; i < dist.length; i++) {
    const v = values.value[i]
    if (v == null) { close(); start = null; continue }
    const x = sx(dist[i]).toFixed(1)
    d += `${start == null ? 'M' : 'L'}${x},${sy(v).toFixed(1)}`
    if (start == null) start = x
    last = x
  }
  close()
  return d
})
const gradId = `pace-grad-${Math.random().toString(36).slice(2, 8)}`

const hoverIdx = ref(null)
function indexAt(km) {
  const { dist } = props.series
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
  const km = Math.min(xMax.value, Math.max(0, ((e.clientX - rect.left - PAD.l) / plotW.value) * xMax.value))
  const i = indexAt(km)
  hoverIdx.value = i
  emit('hover', { lat: props.series.lat[i], lon: props.series.lon[i] })
}
function onLeave() {
  hoverIdx.value = null
  emit('hover', null)
}
const hover = computed(() => {
  const i = hoverIdx.value
  if (i == null) return null
  const km = props.series.dist[i]
  const v = values.value[i]
  return { x: sx(km), y: v == null ? null : sy(v), km, v }
})
const readout = computed(() =>
  hover.value ? `${hover.value.km.toFixed(2)} km · ${hover.value.v == null ? '—' : fmtValue(hover.value.v)}` : null,
)
</script>

<template>
  <div ref="root" class="pace-root">
    <svg
      :width="width"
      :height="height"
      class="pace-svg"
      role="img"
      :aria-label="isPace ? 'Ritmo' : 'Velocidade'"
      @pointermove="onMove"
      @pointerdown="onMove"
      @pointerleave="onLeave"
      @pointercancel="onLeave"
    >
      <defs>
        <linearGradient :id="gradId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="0.3" />
          <stop offset="100%" :stop-color="color" stop-opacity="0.03" />
        </linearGradient>
      </defs>
      <g class="grid">
        <line v-for="t in yTicks" :key="'y' + t.v" :x1="PAD.l" :x2="PAD.l + plotW" :y1="t.y" :y2="t.y" />
      </g>
      <g class="axis-text">
        <text v-for="t in yTicks" :key="'yl' + t.v" :x="PAD.l - 6" :y="t.y + 3.5" text-anchor="end">{{ t.label }}</text>
        <text v-for="(t, i) in xTicks" :key="'xl' + t.v" :x="t.x" :y="PAD.t + plotH + 14" text-anchor="middle">{{ i === 0 ? t.label + ' km' : t.label }}</text>
      </g>
      <path :d="areaPath" :fill="`url(#${gradId})`" />
      <path :d="linePath" fill="none" :stroke="color" stroke-width="1.6" stroke-linejoin="round" />
      <g v-if="hover" class="cursor">
        <line :x1="hover.x" :x2="hover.x" :y1="PAD.t" :y2="PAD.t + plotH" />
        <circle v-if="hover.y != null" :cx="hover.x" :cy="hover.y" r="4" :fill="MARKER_BLUE" stroke="#fff" stroke-width="1.5" />
      </g>
    </svg>
    <div v-if="readout" class="readout mono">{{ readout }}</div>
  </div>
</template>

<style scoped>
.pace-root { position: relative; width: 100%; height: 100%; min-height: 60px; }
.pace-svg { display: block; touch-action: pan-y; cursor: crosshair; }
.grid line { stroke: var(--border); stroke-width: 1; }
.axis-text text { fill: var(--text-muted); font-size: 10px; font-family: var(--font-mono); }
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
