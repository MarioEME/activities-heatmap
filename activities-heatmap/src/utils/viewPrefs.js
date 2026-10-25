// Per-viewer display preferences kept in localStorage (a convenience only:
// the app works without it).
import { ref } from 'vue'

const COMPACT_KEY = 'detailCompact'

function readCompact() {
  try {
    const v = localStorage.getItem(COMPACT_KEY)
    if (v !== null) return v === '1'
  } catch (e) { /* storage unavailable */ }
  return true // phones start compact, so the map and profile get the room
}

// true = the activity details are collapsed to a one-line summary (phones)
export const detailCompact = ref(readCompact())

export function toggleDetailCompact() {
  detailCompact.value = !detailCompact.value
  try { localStorage.setItem(COMPACT_KEY, detailCompact.value ? '1' : '0') } catch (e) { /* ignore */ }
}

const SIDE_KEY = 'detailSide'
function readSide() {
  try { return localStorage.getItem(SIDE_KEY) === '1' } catch (e) { return false }
}

// true = on desktop the details card is folded into a thin strip on the left,
// leaving the whole panel width to the elevation profile
export const detailSideCollapsed = ref(readSide())

export function toggleDetailSide() {
  detailSideCollapsed.value = !detailSideCollapsed.value
  try { localStorage.setItem(SIDE_KEY, detailSideCollapsed.value ? '1' : '0') } catch (e) { /* ignore */ }
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
