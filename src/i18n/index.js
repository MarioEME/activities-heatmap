// Tiny i18n layer (no dependencies). Two languages: European Portuguese
// ('pt', the original) and American English ('en').
//
//   t('nav.activities')                      -> "Atividades" / "Activities"
//   t('x.greeting', { name: 'Ana' })         -> "Olá {name}" with {name} filled in
//   t('x.items', { n }, n)                   -> plural: "1 item | {n} items"
//                                               (first form when n === 1)
//
// `locale` is a ref, so any template or computed that calls t() re-renders
// when the language changes. The choice is remembered in localStorage and,
// on a first visit, taken from the browser's language.
import { ref } from 'vue'
import pt from './pt'
import en from './en'

const MESSAGES = { pt, en }
export const LOCALES = [
  { code: 'pt', label: 'Português (PT)', short: 'PT', intl: 'pt-PT' },
  { code: 'en', label: 'English (US)', short: 'EN', intl: 'en-US' },
]
const STORAGE_KEY = 'lang'

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved && MESSAGES[saved]) return saved
  } catch { /* storage blocked: fall through */ }
  const nav = (typeof navigator !== 'undefined' && navigator.language) || 'en'
  return nav.toLowerCase().startsWith('pt') ? 'pt' : 'en'
}

export const locale = ref(detect())
if (typeof document !== 'undefined') document.documentElement.lang = intlLocale()

export function setLocale(code) {
  if (!MESSAGES[code]) return
  locale.value = code
  try { localStorage.setItem(STORAGE_KEY, code) } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = intlLocale()
}

// BCP-47 tag for Intl / toLocale*String
export function intlLocale() {
  return LOCALES.find((l) => l.code === locale.value)?.intl || 'en-US'
}

function lookup(dict, key) {
  let cur = dict
  for (const part of key.split('.')) {
    if (cur == null) return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

export function t(key, params, n) {
  let msg = lookup(MESSAGES[locale.value], key)
  if (msg === undefined) msg = lookup(MESSAGES.en, key) // fall back to English
  if (msg === undefined) return key // visible, so a missing key is easy to spot
  if (n !== undefined && msg.includes(' | ')) {
    const forms = msg.split(' | ')
    msg = n === 1 ? forms[0] : forms[forms.length - 1]
  }
  if (params) msg = msg.replace(/\{(\w+)\}/g, (m, k) => (k in params ? params[k] : m))
  return msg
}

// --- locale-aware formatting helpers -----------------------------------------
export const fmtDate = (d, opts) => (d && !isNaN(d) ? d.toLocaleDateString(intlLocale(), opts) : '')
export const fmtTime = (d) => (d && !isNaN(d) ? d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) : '')
export const fmtNumber = (n, opts) => (n == null || isNaN(n) ? '' : Number(n).toLocaleString(intlLocale(), opts))
