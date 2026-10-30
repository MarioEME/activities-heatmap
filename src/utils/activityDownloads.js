// Download buttons of an activity (original file / GPX), usable outside the
// map view. The map keeps its own copy because it already has the points loaded.
import {
  buildGpxString, buildGpxFilename, buildOriginalFilename,
  sourceFileExtension, mimeForExtension, triggerBytesDownload,
} from './gpxExport'
import { t } from '../i18n'

export async function downloadOriginal(store, a) {
  if (a.sourceFile) {
    try {
      const bytes = await store.fetchOriginalBytes(a.sourceFile)
      if (bytes) {
        const ext = sourceFileExtension(a.sourceFile)
        triggerBytesDownload(bytes, buildOriginalFilename(a, ext), mimeForExtension(ext))
        return
      }
      window.alert(t('map.noOriginal'))
      return
    } catch (e) {
      console.warn('[activities-heatmap] Falha ao descarregar o ficheiro original:', e)
      window.alert(t('map.downloadFailed'))
      return
    }
  }
  // no original at all: a GPX rebuilt from the stored route
  const latlngs = (await store.resolveTracks([a.id])).get(a.id)
  if (latlngs) {
    const gpx = buildGpxString({ ...a, latlngs })
    triggerBytesDownload(new TextEncoder().encode(gpx), buildGpxFilename(a), 'application/gpx+xml')
  }
}

export async function downloadGpx(store, a) {
  try {
    const bytes = await store.fetchOriginalBytes(a.sourceFile)
    if (!bytes) { window.alert(t('map.noOriginal')); return }
    const { convertToGpx } = await import('./gpxConvert')
    const gpx = await convertToGpx(bytes, sourceFileExtension(a.sourceFile), a)
    if (!gpx) { window.alert(t('map.noGpsForGpx')); return }
    triggerBytesDownload(new TextEncoder().encode(gpx), buildGpxFilename(a), mimeForExtension('gpx'))
  } catch (e) {
    console.warn('[activities-heatmap] Falha ao converter o original para GPX:', e)
    window.alert(t('map.convertFailed'))
  }
}
