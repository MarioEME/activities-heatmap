// Tiny route shapes for the activity cards: an SVG path computed from the
// stored geometry (no map tiles), cached per activity. Requests are batched so
// a screenful of cards asks IndexedDB (or Dropbox) once instead of once each.

const cache = new Map() // id -> path string | null (no track)
const waiting = new Map() // id -> [resolve]
let timer = null

function toPath(latlngs) {
  if (!latlngs || latlngs.length < 2) return null
  const step = Math.max(1, Math.floor(latlngs.length / 70))
  const pts = []
  for (let i = 0; i < latlngs.length; i += step) pts.push(latlngs[i])
  pts.push(latlngs[latlngs.length - 1])
  const k = Math.cos((pts[0][0] * Math.PI) / 180)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  const xy = pts.map((p) => {
    const x = p[1] * k, y = -p[0]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    return [x, y]
  })
  const span = Math.max(maxX - minX, maxY - minY) || 1e-6
  const scale = 84 / span // 100x100 box with an 8 unit margin
  const ox = 8 + (84 - (maxX - minX) * scale) / 2
  const oy = 8 + (84 - (maxY - minY) * scale) / 2
  return xy.map(([x, y], i) => `${i ? 'L' : 'M'}${((x - minX) * scale + ox).toFixed(1)} ${((y - minY) * scale + oy).toFixed(1)}`).join('')
}

async function flush(store) {
  timer = null
  const ids = [...waiting.keys()]
  const jobs = new Map(waiting)
  waiting.clear()
  let tracks = new Map()
  try { tracks = await store.resolveTracks(ids) } catch (e) { /* cards just stay without a shape */ }
  for (const id of ids) {
    const path = toPath(tracks.get(id))
    cache.set(id, path)
    for (const r of jobs.get(id)) r(path)
  }
}

export function routeThumb(store, id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id))
  return new Promise((resolve) => {
    if (waiting.has(id)) waiting.get(id).push(resolve)
    else waiting.set(id, [resolve])
    if (!timer) timer = setTimeout(() => flush(store), 60)
  })
}
