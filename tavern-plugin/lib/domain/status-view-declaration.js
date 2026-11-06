// Shared by display capture and persistent-panel projection. Array indices and
// rendered HTML are not identities: both change when the author edits a card.
export function statusViewDeclaration(rule) {
  const pattern = String(rule?.findRegex || '')
  const named = pattern.match(/<([a-z][a-z0-9-]*-status)\b/i)
  const marker = pattern.includes('StatusPlaceHolderImpl') ? '<StatusPlaceHolderImpl/>' : named ? '<' + named[1] + '/>' : ''
  if (!marker) return null
  const key = rule.id ? 'id:' + rule.id : 'marker:' + marker + ':' + (rule.scriptName || rule.name || '')
  return { marker, key }
}
