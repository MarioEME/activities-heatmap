// Sidecar metadata for files dropped in the "import" folder. A file such as
// "strava-123.json" next to "strava-123.fit" carries what the activity file
// itself cannot: the title, description, equipment, tags and type the person
// gave it elsewhere (e.g. on Strava). Every field is optional:
//   { "name": "...", "description": "...", "type": "Run", "gear": "Nike Pegasus",
//     "tags": ["Prova"], "commute": false, "source": "strava", "stravaId": "123" }

export const baseName = (n) => String(n || '').replace(/\.[a-z0-9]+$/i, '').toLowerCase()

export function parseMeta(bytes) {
  try {
    const m = JSON.parse(new TextDecoder('utf-8').decode(bytes))
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null
  } catch { return null }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// Returns the activity with the sidecar's fields applied. Tag names are looked
// up in tagDefs (case-insensitive); unknown ones are added to it, and the
// function reports whether it did (so the tag list gets saved).
export function applyMeta(activity, meta, tagDefs) {
  if (!meta) return { activity, tagsAdded: false }
  const a = { ...activity }
  const name = str(meta.name, 200)
  if (name) a.name = name
  const desc = str(meta.description, 5000)
  if (desc) a.description = desc
  const type = str(meta.type, 60)
  if (type) a.type = type
  const gear = str(meta.gear, 80)
  if (gear) a.gear = gear // turned into an equipment item when the import is committed
  if (typeof meta.commute === 'boolean') a.commute = meta.commute
  let tagsAdded = false
  if (Array.isArray(meta.tags)) {
    const ids = []
    for (const raw of meta.tags) {
      const n = str(raw, 40)
      if (!n) continue
      let tag = tagDefs.find((t) => t.name.toLowerCase() === n.toLowerCase())
      if (!tag) {
        tag = { id: `t-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: n }
        tagDefs.push(tag)
        tagsAdded = true
      }
      if (!ids.includes(tag.id)) ids.push(tag.id)
    }
    a.tags = ids
  }
  return { activity: a, tagsAdded }
}
