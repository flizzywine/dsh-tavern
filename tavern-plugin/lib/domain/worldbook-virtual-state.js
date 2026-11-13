import { createHash } from 'node:crypto'
import { classifyWorldbookEntry, hasWorldbookPreprocessingSyntax, isWorldbookRuntimeEntry } from './worldbook-entry-classification.js'
import { isMvuUpdateEntry } from './worldbook-recall.js'
import { promptOrder } from './worldbook-activation.js'
import { promptSection } from './prompt-section.js'

export const virtualHash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
// A view entry is immutable for as long as its book snapshot lives: readers copy it, nobody
// edits it in place. One request chain (a history import, a retry, a candidate round) hashes the
// same entries again and again, and a big book is thousands of kilobytes per pass, so remember
// the digest by identity. A re-read book yields new objects, so an edited book always re-hashes.
const entryVersions = new WeakMap()
export const virtualEntryVersion = entry => {
  if (entry === null || typeof entry !== 'object') return virtualHash(entry)
  const known = entryVersions.get(entry)
  if (known !== undefined) return known
  const version = virtualHash(entry)
  entryVersions.set(entry, version)
  return version
}
/** The same digest `virtualHash(entries)` gives, computed from the per-entry versions. */
export const virtualEntriesVersion = entries => virtualHash(entries.map(virtualEntryVersion))
/** A withdrawn dynamic entry's context text; states saved before the tags keep the original heading form. */
export const withdrawnEntryText = ref => promptSection('lorebook_entry_withdrawn', `世界书条目 ${ref} 已更新为空；先前该条目的内容已撤回，不再作为当前设定。`)
export const isWithdrawnEntryText = value => /^(?:<lorebook_entry_withdrawn>\n世界书条目 .+ 已更新为空；先前该条目的内容已撤回，不再作为当前设定。\n<\/lorebook_entry_withdrawn>|【世界书条目 .+ 已更新为空；先前该条目的内容已撤回，不再作为当前设定。】)$/.test(value)
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
function visibleVirtualSourceEntries(worldBook, chat) {
  const entries = worldBook?.view?.entries || []
  const enabled = entries.filter(entry => entry.enabled !== false)
  if (!entries.some(hasWorldbookPreprocessingSyntax)) return enabled
  const state = chat.worldBookVirtualState
  if (state?.scope !== virtualScope(chat) || state.visibility?.version !== virtualHash(entries)) return null
  const visible = new Set(state.visibility.refs || [])
  return enabled.filter(entry => visible.has(entry.ref))
}

export function eligibleVirtualSourceEntries(worldBook, chat) {
  return visibleVirtualSourceEntries(worldBook, chat) ?? []
}

/** Request-prefix projection never evaluates templates. Constants are freshly
 * read from source; only version-valid runtime rule/controller snapshots are
 * restored. Dynamic data stays in searchable files, even after compaction.
 * A prefix is outside the compressible message history and is rebuilt on retry.
 */
export function projectVirtualWorldbookPrefix(worldBook, chat, { restore = true, restoreRefs } = {}) {
  const visible = visibleVirtualSourceEntries(worldBook, chat)
  const entries = promptOrder((visible ?? []).filter(entry => !isMvuUpdateEntry(entry)))
  const state = currentVirtualState(chat, entries)
  const staticPrefix = entries.filter(entry => classifyWorldbookEntry(entry).kind === 'static-constant').map(entry => String(entry.content ?? '')).join('\n\n')
  const allowed = restoreRefs === undefined ? null : new Set(restoreRefs)
  const snapshots = restore ? entries.filter(entry => classifyWorldbookEntry(entry).dynamic && isWorldbookRuntimeEntry(entry) && (!allowed || allowed.has(entry.ref)) && (state.entries[entry.ref]?.contextText ?? state.entries[entry.ref]?.text)).map(entry => state.entries[entry.ref].contextText ?? state.entries[entry.ref].text).join('\n\n') : ''
  return { staticPrefix, snapshots, prefixContext: [staticPrefix, snapshots].filter(Boolean).join('\n\n'),
    ...(visible === null ? { visibilityPending: true } : {}) }
}
