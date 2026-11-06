// Tiny route shapes for the activity cards: an SVG path computed from the
// stored geometry (no map tiles), cached per activity. Requests are batched so
// a screenful of cards asks IndexedDB (or Dropbox) once instead of once each.

const cache = new Map() // id -> { path, frame } | null (no track)
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

// Static "map picture" of a route: a W x H frame, the OSM tiles that cover it and the
// route projected on top (Web Mercator), so no Leaflet map is needed.
const FW = 360, FH = 150, TILE = 256
function toFrame(latlngs) {
  if (!latlngs || latlngs.length < 2) return null
  const step = Math.max(1, Math.floor(latlngs.length / 120))
  const pts = []
  for (let i = 0; i < latlngs.length; i += step) pts.push(latlngs[i])
  pts.push(latlngs[latlngs.length - 1])
  const proj = (lat, lon, z) => {
    const n = TILE * 2 ** z, sin = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
    return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n]
  }
  let z = 17
  for (; z > 3; z--) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const p of pts) { const [x, y] = proj(p[0], p[1], z); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    if (x1 - x0 <= FW - 40 && y1 - y0 <= FH - 30) break
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  const xy = pts.map((p) => { const q = proj(p[0], p[1], z); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); return q })
  const left = (x0 + x1) / 2 - FW / 2, top = (y0 + y1) / 2 - FH / 2
  const n = 2 ** z, tiles = []
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + FH) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + FW) / TILE); tx++) {
      tiles.push({ url: `https://tile.openstreetmap.org/${z}/${((tx % n) + n) % n}/${ty}.png`, x: tx * TILE - left, y: ty * TILE - top })
    }
  }
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${(x - left).toFixed(1)} ${(y - top).toFixed(1)}`).join('')
  return { w: FW, h: FH, tile: TILE, tiles, d }
}

async function flush(store) {
  timer = null
  const ids = [...waiting.keys()]
  const jobs = new Map(waiting)
  waiting.clear()
  let tracks = new Map()
  try { tracks = await store.resolveTracks(ids) } catch (e) { /* cards just stay without a shape */ }
  for (const id of ids) {
    const entry = tracks.get(id) ? { path: toPath(tracks.get(id)), frame: toFrame(tracks.get(id)) } : null
    cache.set(id, entry)
    for (const r of jobs.get(id)) r(entry)
  }
}

export function routeThumb(store, id) { return routeShape(store, id).then((e) => e?.path ?? null) }
export function routeFrame(store, id) { return routeShape(store, id).then((e) => e?.frame ?? null) }

function routeShape(store, id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id))
  return new Promise((resolve) => {
    if (waiting.has(id)) waiting.get(id).push(resolve)
    else waiting.set(id, [resolve])
    if (!timer) timer = setTimeout(() => flush(store), 60)
  })
}
