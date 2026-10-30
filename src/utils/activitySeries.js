// Elevation + pace series of one activity, read from its original file
// (cached, small LRU). Used by the mobile feed; the map panel has its own copy
// of this logic because it also has to cancel stale requests.
import { sourceFileExtension } from './gpxExport'
import { t } from '../i18n'

const cache = new Map()
const LIMIT = 30

export async function loadActivitySeries(store, a) {
  const hit = cache.get(a.id)
  if (hit) return hit
  const none = (message) => ({ profile: { status: 'none', message }, pace: { status: 'none' }, splits: null })
  if (!a.sourceFile) return none(t('map.profile.noOriginal'))
  try {
    const bytes = await store.fetchOriginalBytes(a.sourceFile)
    if (!bytes) return none(t('map.noOriginal'))
    const { extractSeries } = await import('./elevationProfile')
    const { profile, pace, splits } = await extractSeries(bytes, sourceFileExtension(a.sourceFile))
    const state = {
      profile: profile ? { status: 'ready', data: profile } : { status: 'none', message: t('map.profile.noAltitude') },
      pace: pace ? { status: 'ready', data: pace } : { status: 'none' },
      splits: splits || null,
    }
    cache.set(a.id, state)
    if (cache.size > LIMIT) cache.delete(cache.keys().next().value)
    return state
  } catch (e) {
    console.warn('[activities-heatmap] Falha ao ler a altimetria:', e)
    return none(t('map.profile.readFailed'))
  }
}
