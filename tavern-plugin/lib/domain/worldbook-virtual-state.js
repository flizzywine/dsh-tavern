import { createHash } from 'node:crypto'
import { classifyWorldbookEntry, hasWorldbookPreprocessingSyntax, isWorldbookRuntimeEntry } from './worldbook-entry-classification.js'
import { isMvuUpdateEntry } from './worldbook-recall.js'
import { promptOrder } from './worldbook-activation.js'

export const virtualHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export const virtualEntryVersion = entry => virtualHash(entry)
export const virtualScope = chat => JSON.stringify([chat.sessionId || chat.id || '', chat.cardPath || ''])
function dependencyValues(classification, chat, card, globals) {
  return classification.dependencies.map(({ scope, key }) => {
    if (scope === 'identity') return [scope, key, key === 'char' ? card?.name : chat.macroState?.userName || '你']
    // Tavern macros read macroState only. Template variables/global scopes
    // belong to EJS and must not mask a missing macro key in this fingerprint.
    const value = scope === 'global' ? chat.macroState?.global : chat.macroState?.local
    const owner = value && typeof value === 'object' ? value : {}
    return [scope, key, Object.hasOwn(owner, key), owner[key]]
  })
}
export function virtualDependencyHash(classification, chat, card, globals) {
  return virtualHash(dependencyValues(classification, chat, card, globals))
}
export function virtualDependencyHasDynamicValue(classification, chat, card, globals) {
  return /\{\{|<%/.test(JSON.stringify(dependencyValues(classification, chat, card, globals)))
}
export function currentVirtualState(chat, entries) {
  const prior = chat.worldBookVirtualState
  const state = { schemaVersion: 1, scope: virtualScope(chat), entries: {} }
  if (prior?.scope !== state.scope || prior.schemaVersion !== 1) return state
  for (const entry of entries) {
    const snapshot = prior.entries?.[entry.ref]
    if (entry.enabled !== false && snapshot?.version === virtualEntryVersion(entry)) state.entries[entry.ref] = snapshot
  }
  return state
}
/** A preprocessed book can hide otherwise static resources. Discovery and
 * stable prefix reads must not execute its controller to test visibility. Until
 * the foreground runtime establishes a version-valid view, fail closed. */
export function eligibleVirtualSourceEntries(worldBook, chat) {
  const entries = worldBook?.view?.entries || []
  const enabled = entries.filter(entry => entry.enabled !== false)
  if (!entries.some(hasWorldbookPreprocessingSyntax)) return enabled
  const state = chat.worldBookVirtualState
  if (state?.scope !== virtualScope(chat) || state.visibility?.version !== virtualHash(entries)) return []
  const visible = new Set(state.visibility.refs || [])
  return enabled.filter(entry => visible.has(entry.ref))
}

/** Request-prefix projection never evaluates templates. Constants are freshly
 * read from source; only version-valid runtime rule/controller snapshots are
 * restored. Dynamic data stays in searchable files, even after compaction.
 * A prefix is outside the compressible message history and is rebuilt on retry.
 */
export function projectVirtualWorldbookPrefix(worldBook, chat, { restore = true, restoreRefs } = {}) {
  const entries = promptOrder(eligibleVirtualSourceEntries(worldBook, chat).filter(entry => !isMvuUpdateEntry(entry)))
  const state = currentVirtualState(chat, entries)
  const staticPrefix = entries.filter(entry => classifyWorldbookEntry(entry).kind === 'static-constant').map(entry => String(entry.content ?? '')).join('\n\n')
  const allowed = restoreRefs === undefined ? null : new Set(restoreRefs)
  const snapshots = restore ? entries.filter(entry => classifyWorldbookEntry(entry).dynamic && isWorldbookRuntimeEntry(entry) && (!allowed || allowed.has(entry.ref)) && (state.entries[entry.ref]?.contextText ?? state.entries[entry.ref]?.text)).map(entry => state.entries[entry.ref].contextText ?? state.entries[entry.ref].text).join('\n\n') : ''
  return { staticPrefix, snapshots, prefixContext: [staticPrefix, snapshots].filter(Boolean).join('\n\n') }
}
