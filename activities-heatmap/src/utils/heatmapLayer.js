// Canvas layer that paints the density grid from heatmapStore.js: one small
// square per cell, coloured by how many activities went through it.
import L from 'leaflet'
import { CELL } from './heatmapStore'

// cold -> hot, readable on both the light and the dark base maps
const RAMP = ['#5b3aa8', '#8a2fa0', '#c2307a', '#e0452f', '#f27a1a', '#f9ad14', '#fdd835', '#fff6a8']

function bucketOf(count, max) {
  if (max <= 1) return 3
  const t = Math.log(count) / Math.log(max) // log scale: 1 pass vs 100 passes both visible
  return Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))
}

export const HeatLayer = L.Layer.extend({
  initialize(data) {
    this._set(data)
  },
  _set(data) {
    this._data = data
    if (!data) return
    let max = 1
    for (let i = 0; i < data.n.length; i++) if (data.n[i] > max) max = data.n[i]
    const b = new Uint8Array(data.n.length)
    for (let i = 0; i < b.length; i++) b[i] = bucketOf(data.n[i], max)
    this._bucket = b
  },
  setData(data) { this._set(data); if (this._map) this._redraw() },
  onAdd(map) {
    this._map = map
    if (!map.getPane('heatPane')) {
      const p = map.createPane('heatPane')
      p.style.zIndex = 350
      p.style.pointerEvents = 'none'
    }
    this._canvas = L.DomUtil.create('canvas', 'heat-canvas')
    map.getPane('heatPane').appendChild(this._canvas)
    map.on('moveend zoomend resize', this._redraw, this)
    map.on('zoomstart', this._hide, this)
    this._redraw()
  },
  onRemove(map) {
    map.off('moveend zoomend resize', this._redraw, this)
    map.off('zoomstart', this._hide, this)
    this._canvas.remove()
    this._canvas = null
    this._map = null
  },
  _hide() { if (this._canvas) this._canvas.style.opacity = 0 },
  _redraw() {
    const map = this._map
    if (!map || !this._canvas) return
    const size = map.getSize()
    const dpr = window.devicePixelRatio || 1
    const c = this._canvas
    c.width = size.x * dpr
    c.height = size.y * dpr
    c.style.width = size.x + 'px'
    c.style.height = size.y + 'px'
    c.style.opacity = 1
    L.DomUtil.setPosition(c, map.containerPointToLayerPoint([0, 0]))
    const ctx = c.getContext('2d')
    ctx.scale(dpr, dpr)
    const d = this._data
    if (!d || !d.n.length) return

    const z = map.getZoom()
    const scale = 256 * Math.pow(2, z)
    const min = map.getPixelBounds().min
    const bounds = map.getBounds()
    const south = Math.floor((bounds.getSouth() + 90) / CELL) - 1
    const north = Math.ceil((bounds.getNorth() + 90) / CELL) + 1
    const west = Math.floor((bounds.getWest() + 180) / CELL) - 1
    const east = Math.ceil((bounds.getEast() + 180) / CELL) + 1
    const rad = Math.PI / 180
    const mercY = (lat) => (1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2 * scale
    const w = Math.max(2, CELL / 360 * scale)
    ctx.globalAlpha = 0.85
    for (let bk = 0; bk < RAMP.length; bk++) {
      ctx.fillStyle = RAMP[bk]
      for (let i = 0; i < d.n.length; i++) {
        if (this._bucket[i] !== bk) continue
        const li = d.li[i], lo = d.lo[i]
        if (li < south || li > north || lo < west || lo > east) continue
        const lat = li * CELL - 90, lon = lo * CELL - 180
        const x = (lon + 180) / 360 * scale - min.x
        const yTop = mercY(lat + CELL) - min.y
        const h = Math.max(2, mercY(lat) - mercY(lat + CELL))
        ctx.fillRect(x, yTop, w, h)
      }
    }
  },
})
