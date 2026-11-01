// Light / dark appearance. "auto" follows the system; the choice is remembered.
// The dark look is a class on <html> (set here, and once more by a tiny inline
// script in index.html so there is no flash of the light theme on load).
import { ref } from 'vue'

const KEY = 'ah-theme'
const MODES = ['auto', 'light', 'dark']

function readMode() {
  try {
    const v = window.localStorage.getItem(KEY)
    return MODES.includes(v) ? v : 'auto'
  } catch (e) { return 'auto' }
}

export const themeMode = ref(readMode())
export const isDark = ref(false)

const systemQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

function apply() {
  const dark = themeMode.value === 'dark' || (themeMode.value === 'auto' && !!systemQuery?.matches)
  isDark.value = dark
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#101917' : '#F4F5F1')
}

export function initTheme() {
  apply()
  systemQuery?.addEventListener?.('change', apply)
}

export function cycleTheme() {
  themeMode.value = MODES[(MODES.indexOf(themeMode.value) + 1) % MODES.length]
  try { window.localStorage.setItem(KEY, themeMode.value) } catch (e) { /* ignore */ }
  apply()
}
