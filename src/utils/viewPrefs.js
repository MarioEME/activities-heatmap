// Per-viewer display preferences kept in localStorage (a convenience only:
// the app works without it).
import { ref, computed } from 'vue'
import { isPhone } from './isPhone'

// On phones nothing folds: the exposed value is always false there.
function openOnPhone(raw) { return computed(() => (isPhone.value ? false : raw.value)) }

const COMPACT_KEY = 'detailCompact2'

function readCompact() {
  try {
    const v = localStorage.getItem(COMPACT_KEY)
    if (v !== null) return v === '1'
  } catch (e) { /* storage unavailable */ }
  return false // everything starts expanded
}

// true = the activity details are collapsed to a one-line summary (phones)
const detailCompactRaw = ref(readCompact())
export const detailCompact = openOnPhone(detailCompactRaw)

export function toggleDetailCompact() {
  detailCompactRaw.value = !detailCompactRaw.value
  try { localStorage.setItem(COMPACT_KEY, detailCompactRaw.value ? '1' : '0') } catch (e) { /* ignore */ }
}

const SIDE_KEY = 'detailSide2'
function readSide() {
  try { return localStorage.getItem(SIDE_KEY) === '1' } catch (e) { return false }
}

// true = on desktop the details card is folded into a thin strip on the left,
// leaving the whole panel width to the elevation profile
const sideRaw = ref(readSide())
export const detailSideCollapsed = openOnPhone(sideRaw)

export function toggleDetailSide() {
  sideRaw.value = !sideRaw.value
  try { localStorage.setItem(SIDE_KEY, sideRaw.value ? '1' : '0') } catch (e) { /* ignore */ }
}

const HEAT_ROUTES_KEY = 'heatRoutes'
function readHeatRoutes() {
  try { return localStorage.getItem(HEAT_ROUTES_KEY) === '1' } catch (e) { return false }
}
// whether the individual routes stay drawn on top of the aggregated heatmap
export const heatShowRoutes = ref(readHeatRoutes())
export function toggleHeatRoutes() {
  heatShowRoutes.value = !heatShowRoutes.value
  try { localStorage.setItem(HEAT_ROUTES_KEY, heatShowRoutes.value ? '1' : '0') } catch (e) { /* ignore */ }
}

// Collapsed state of the two graph cards in the activity panel (header only).
function boolPref(key, def = false, foldable = false) {
  const r = ref((() => { try { const v = localStorage.getItem(key); return v === null ? def : v === '1' } catch (e) { return def } })())
  const toggle = () => {
    r.value = !r.value
    try { localStorage.setItem(key, r.value ? '1' : '0') } catch (e) { /* ignore */ }
  }
  return [foldable ? openOnPhone(r) : r, toggle]
}
export const [elevCollapsed, toggleElevCollapsed] = boolPref('elevCollapsed2', false, true)
export const [paceCollapsed, togglePaceCollapsed] = boolPref('paceCollapsed2', false, true)
export const [splitsCollapsed, toggleSplitsCollapsed] = boolPref('splitsCollapsed2', false, true)
export const [sameCollapsed, toggleSameCollapsed] = boolPref('sameRouteCollapsed2', false, true)

// Which series the activity chart shows, and the climb-steepness bands.
export const [chartElev, toggleChartElev] = boolPref('chartElev', true)
export const [chartPace, toggleChartPace] = boolPref('chartPace', true)
export const [chartBands, toggleChartBands] = boolPref('elevBands', true)

// Desktop: the activity list next to the map, folded or not.
export const [mapListCollapsed, toggleMapList] = boolPref('mapListCollapsed2', false, true)

// Colour of the selected route on the map (differs from the other routes).
const SEL_COLOR_KEY = 'selectedRouteColor'
export const selectedColor = ref((() => { try { return localStorage.getItem(SEL_COLOR_KEY) || '#7c3aed' } catch (e) { return '#7c3aed' } })())
export function setSelectedColor(c) {
  selectedColor.value = c
  try { localStorage.setItem(SEL_COLOR_KEY, c) } catch (e) { /* ignore */ }
}
