// Activities that follow the SAME route as a given one: similar type and
// distance, then the stored tracks are compared both ways (every sampled point
// of one must lie close to the other's line).
import { isPaceSport } from './sport'

const TOL_M = 50
const MIN_SHARE = 0.92
const SAMPLES = 80
const MAX_SEGS = 700
const cache = new Map() // id -> { key, ids }
const tick = () => new Promise((r) => setTimeout(r, 0))

function toXY(latlngs, lat0, lon0, maxPts) {
  const k = Math.cos((lat0 * Math.PI) / 180) * 111320
  const step = Math.max(1, Math.ceil(latlngs.length / maxPts))
  const xs = []
  const ys = []
  for (let i = 0; i < latlngs.length; i += step) {
    xs.push((latlngs[i][1] - lon0) * k)
    ys.push((latlngs[i][0] - lat0) * 111320)
  }
  const last = latlngs[latlngs.length - 1]
  xs.push((last[1] - lon0) * k)
  ys.push((last[0] - lat0) * 111320)
  return { xs, ys }
}

function sample(p, n) {
  const out = { xs: [], ys: [] }
  const m = p.xs.length
  const cnt = Math.min(n, m)
  for (let i = 0; i < cnt; i++) {
    const j = Math.round((i * (m - 1)) / Math.max(1, cnt - 1))
    out.xs.push(p.xs[j])
    out.ys.push(p.ys[j])
  }
  return out
}

// share of the sample points that lie within TOL_M of the polyline
function shareNear(pts, line) {
  const n = pts.xs.length
  const tol2 = TOL_M * TOL_M
  let ok = 0
  for (let i = 0; i < n; i++) {
    const px = pts.xs[i], py = pts.ys[i]
    let near = false
    for (let s = 0; s + 1 < line.xs.length; s++) {
      const ax = line.xs[s], ay = line.ys[s]
      const dx = line.xs[s + 1] - ax, dy = line.ys[s + 1] - ay
      const len2 = dx * dx + dy * dy
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const ex = ax + t * dx - px, ey = ay + t * dy - py
      if (ex * ex + ey * ey <= tol2) { near = true; break }
    }
    if (near) ok++
  }
  return ok / n
}

const family = (a, b) => a.type === b.type || (isPaceSport(a.type) && isPaceSport(b.type))

// quick check on the end points (either direction) before the full comparison
function endsMatch(ref, tr) {
  const k = Math.cos((ref[0][0] * Math.PI) / 180) * 111320
  const near = (p, q) => Math.hypot((p[1] - q[1]) * k, (p[0] - q[0]) * 111320) < 250
  const rf = ref[0], rl = ref[ref.length - 1], cf = tr[0], cl = tr[tr.length - 1]
  return (near(cf, rf) && near(cl, rl)) || (near(cf, rl) && near(cl, rf))
}

export async function findSameRoute(store, a, cancelled = () => false) {
  if (!a.hasTrack || a.distanceKm == null) return []
  const key = store.activities.length
  const hit = cache.get(a.id)
  if (hit && hit.key === key) return hit.ids.map((id) => store.activities.find((x) => x.id === id)).filter(Boolean)

  const ref = (await store.resolveTracks([a.id])).get(a.id)
  if (!ref || ref.length < 2) return []
  const lat0 = ref[0][0], lon0 = ref[0][1]
  const refLine = toXY(ref, lat0, lon0, MAX_SEGS)
  const refPts = sample(refLine, SAMPLES)
  const bb = {
    x0: Math.min(...refLine.xs) - 120, x1: Math.max(...refLine.xs) + 120,
    y0: Math.min(...refLine.ys) - 120, y1: Math.max(...refLine.ys) + 120,
  }

  const tolKm = Math.max(0.15, a.distanceKm * 0.12)
  const cands = store.activities.filter((x) => x.id !== a.id && x.hasTrack && x.distanceKm != null && family(x, a) && Math.abs(x.distanceKm - a.distanceKm) <= tolKm)
  const found = []
  for (let i = 0; i < cands.length; i += 40) {
    const chunk = cands.slice(i, i + 40)
    const tracks = await store.resolveTracks(chunk.map((c) => c.id))
    for (const c of chunk) {
      const tr = tracks.get(c.id)
      if (!tr || tr.length < 2 || !endsMatch(ref, tr)) continue
      const line = toXY(tr, lat0, lon0, MAX_SEGS)
      // cheap reject: bounding box
      if (Math.min(...line.xs) < bb.x0 || Math.max(...line.xs) > bb.x1 || Math.min(...line.ys) < bb.y0 || Math.max(...line.ys) > bb.y1) continue
      if (shareNear(refPts, line) < MIN_SHARE) continue
      if (shareNear(sample(line, SAMPLES), refLine) < MIN_SHARE) continue
      found.push(c)
    }
    await tick()
    if (cancelled()) return []
  }
  cache.set(a.id, { key, ids: found.map((c) => c.id) })
  return found
}
