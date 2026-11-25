import { applyTavernRegexText } from './tavern-regex-display.js'

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

const displayOptions = { placement: 2, isMarkdown: true, ignoreDepth: true }
const mvuUpdate = '<UpdateVariable><JSONPatch>[]</JSONPatch></UpdateVariable>'

function isMvuStatusGate(rule, marker) {
  if (!/UpdateVariable/i.test(rule.findRegex)) return false
  if (applyTavernRegexText(marker, [rule], displayOptions).changed) return false
  return [mvuUpdate + '\n' + marker, marker + '\n' + mvuUpdate].some(source =>
    !applyTavernRegexText(source, [rule], displayOptions).text.includes(marker))
}

export function confirmedMvuStatusRules(rules = []) {
  const markers = new Set()
  const displayRules = rules.map(rule => {
    const marker = statusViewDeclaration(rule)?.marker
    if (!marker || !isMvuStatusGate(rule, marker)) return rule
    // A gate must preserve the update and change only its status placeholder.
    const replacement = [[mvuUpdate + '\n', ''], ['', '\n' + mvuUpdate]].map(([prefix, suffix]) => {
      const promoted = applyTavernRegexText(prefix + marker + suffix, [rule], displayOptions).text
      return promoted.startsWith(prefix) && promoted.endsWith(suffix)
        ? promoted.slice(prefix.length, promoted.length - suffix.length) : ''
    }).find(candidate => candidate !== marker && /^<[a-z][\w:-]*\/>$/i.test(candidate))
    if (!replacement) return rule
    markers.add(marker)
    return { ...rule, findRegex: '/' + marker.replace('/', '\\/') + '/g', replaceString: replacement }
  })
  return markers.size ? { rules: displayRules, markers: [...markers] } : null
}

export function mvuStatusConfirmed(message) {
  const receipt = message?.mvu?.receipt
  return message?.role === 'assistant' && message.mvu?.pending !== true && receipt?.toolOnly !== true
    && (receipt?.status === 'updated' || receipt?.status === 'unchanged')
    && (message.mvuBaseline?.swipeId === undefined || message.mvuBaseline.swipeId === (message.swipeId || 0))
}

export function persistentStatusDeclarations(rules) {
  const declarations = []
  const gatedMarkers = new Set()
  for (const rule of rules) {
    if (!rule || rule.disabled === true || rule.enabled === false) continue
    const declaration = statusViewDeclaration(rule)
    if (!declaration || gatedMarkers.has(declaration.marker)) continue
    // The preceding display rule may consume the marker only on floors with an
    // MVU update. Later fallbacks belong to that floor's ordered regex pipeline.
    if (isMvuStatusGate(rule, declaration.marker)) {
      gatedMarkers.add(declaration.marker)
      continue
    }
    declarations.push({ rule, ...declaration })
  }
  return declarations
}
