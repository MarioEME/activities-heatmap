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
