import './style.css'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import 'leaflet/dist/leaflet.css'

createApp(App).use(createPinia()).mount('#app')

// After a new deploy, a tab that was opened before it still points at the OLD
// hashed files (e.g. assets/elevationProfile-xxxx.js), which no longer exist: the
// server answers with an HTML page and the lazy import fails ("disallowed MIME
// type text/html"). Reload once to pick up the new version; the flag prevents a
// reload loop if the problem is something else.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  let already = false
  try { already = sessionStorage.getItem('chunkReload') === '1' } catch (e) { /* ignore */ }
  if (already) return
  try { sessionStorage.setItem('chunkReload', '1') } catch (e) { /* ignore */ }
  window.location.reload()
})
// the flag is cleared once the app has been running for a while
setTimeout(() => { try { sessionStorage.removeItem('chunkReload') } catch (e) { /* ignore */ } }, 15000)
