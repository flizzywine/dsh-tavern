// An entry titled [mvu_update] holds MVU variable-update rules: only the background
// variable settlement reads it; no foreground (prose) prompt path sends it.
// Dependency-free so the client editor includes the same predicate.
function isMvuUpdateEntry(entry) {
  const title = entry && (entry.comment || entry.title || entry.name)
  return /^\s*(?:\d+[a-z]?[_\s.-]*)?\[mvu_update\]/i.test(title === undefined || title === null ? '' : String(title))
}

export { isMvuUpdateEntry }
