// Running and walking are read as a pace (min/km); everything else (cycling,
// skiing...) as a speed (km/h). Matches the type names loosely, because they
// come in many spellings: "Run", "Trail Run", "Virtual Run", "running", "Hike", "Corrida", "Caminhada"...
const PACE_RE = /run|walk|hik|jog|trail|corrida|correr|caminhada|caminhar|marcha|senderismo|trilho|lauf|wander|course|marche|randonn|carrera|caminata|senderismo|corsa|camminata/i

export function isPaceSport(type) {
  return PACE_RE.test(String(type || ''))
}

export function fmtPaceSec(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return null
  let m = Math.floor(secPerKm / 60)
  let s = Math.round(secPerKm % 60)
  if (s === 60) { m += 1; s = 0 }
  return `${m}:${String(s).padStart(2, '0')} /km`
}

// Average pace/speed of an activity as text, in the unit that fits its sport.
export function fmtAvgPace(a) {
  if (!a) return '—'
  if (isPaceSport(a.type)) {
    const t0 = a.movingTime || a.elapsedTime
    const sec = t0 && a.distanceKm ? t0 / a.distanceKm : (a.avgSpeedKmh > 0 ? 3600 / a.avgSpeedKmh : null)
    return fmtPaceSec(sec) || '—'
  }
  return a.avgSpeedKmh != null ? `${a.avgSpeedKmh.toFixed(1)} km/h` : '—'
}
