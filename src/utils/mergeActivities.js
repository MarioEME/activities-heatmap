// --- "Are these two activities the same?" ----------------------------------
// This is the ONE place that decides it. Both the bulk zip-merge flow and
// the single-file GPX import flow call into this, instead of each keeping
// its own notion of "duplicate" — the criterion is expected to evolve
// (e.g. adding a distance/name fallback for activities with no reliable
// date), so changing it here changes it everywhere at once.
//
// Current rule: exact date+time match (the only key reliably shared across
// two separate exports/imports — activity IDs and filenames aren't
// guaranteed stable). Activities with no valid date can't be matched
// against anything, so they're always treated as new (safer than silently
// dropping them).
export function activityKey(a) {
  return a?.date && !isNaN(a.date) ? a.date.getTime() : null
}

// Finds the existing activity (if any) considered the same as `candidate`,
// per activityKey() above. Returns the matching activity, or null.
export function findDuplicateActivity(existingActivities, candidate) {
  const key = activityKey(candidate)
  if (key == null) return null
  return existingActivities.find((a) => activityKey(a) === key) || null
}

// mode:
//   'replace' — when an imported activity's date+time matches an existing
//               one, the imported version overwrites it
//   'keep'    — matching imported activities are skipped; the existing one
//               is left untouched
// Activities that don't match anything existing are always added, in both modes.
export function diffAndMergeActivities(existingActivities, importedActivities, mode) {
  const indexByKey = new Map()
  existingActivities.forEach((a, i) => {
    const key = activityKey(a)
    if (key != null) indexByKey.set(key, i)
  })

  const merged = [...existingActivities]
  let newCount = 0
  let overlapCount = 0

  for (const imported of importedActivities) {
    const key = activityKey(imported)
    const existingIndex = key != null ? indexByKey.get(key) : undefined

    if (existingIndex === undefined) {
      merged.push(imported)
      newCount++
    } else {
      overlapCount++
      if (mode === 'replace') merged[existingIndex] = imported
      // mode === 'keep': leave the existing activity as-is
    }
  }

  return { merged, newCount, overlapCount }
}
