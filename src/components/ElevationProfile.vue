<script setup>
// Elevation profile: altitude (m) against distance (km), drawn as SVG.
// Moving the mouse / finger over it shows the value at that point and emits
// `hover` with the matching map position, so the map can mark where it is.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

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
        <circle :cx="hover.x" :cy="hover.y" r="4" :fill="color" stroke="#fff" stroke-width="1.5" />
      </g>
    </svg>
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
