import { createHash } from 'node:crypto'
import { replyBody } from './round-body.js'
import { createIndexedArrayApi } from './indexed-array.js'
import { freezeJson, createImmutableOrderedJsonIndex } from './freeze-json.js'
import { statusViewDeclaration } from './status-view-declaration.js'
import { projectReplyHistory } from './reply-presentation.js'
import { projectPersistentStatusView } from './persistent-status-view.js'

// Display projection resolves identity macros only. Gameplay variables must not
// invalidate every historical row on each settlement.
function displayDependencies(options) {
  return {...options, macroState: {userName: options.macroState?.userName}}
}

// SillyTavern renders each floor at its own depth (messages after it), so a rule with
// maxDepth 2 draws a heavy status bar on the latest floors only. Depths past the largest
// bound any enabled rule names all behave alike: they share one projection and cache key,
// and only the floors within that bound are re-projected when a new message arrives.
function depthBound(options) {
  let bound = null
  for (const rule of options.regexScripts || []) {
    if (!rule || rule.disabled === true || rule.enabled === false) continue
    for (const value of [rule.minDepth, rule.maxDepth]) {
      const number = Number(value)
      if (value !== null && value !== undefined && value !== '' && Number.isFinite(number) && number >= 0) bound = Math.max(bound ?? 0, number)
    }
  }
  return bound
}

// Derived, disposable state only. The journal remains the authority for changed indices.
export function createIncrementalReplyView({ readChanges, maxBytes = 8 * 1024 * 1024, maxEntries = 4, onIndexVisit = () => {}, onStatusMatch = () => {}, onStatusFilter = () => {}, onStatusFallback = () => {} } = {}) {
  const cache = new Map()
  const sourceIndex = createIndexedArrayApi({measure:value=>48+String(value).length*2})
  const rowIndex = createIndexedArrayApi({eligible:value=>Boolean(value),measure:value=>JSON.stringify(value).length*2,visit:onIndexVisit})
  const metadataIndex = createIndexedArrayApi({visit:onIndexVisit})
  const targetIndex = createIndexedArrayApi({maximum:value=>value ?? -Infinity,visit:onIndexVisit})
  const projectionIndex = createImmutableOrderedJsonIndex({measure:value=>JSON.stringify(value).length*2,visit:onIndexVisit})
  function sourceKey(message) {
    if (!message) return JSON.stringify(message)
    const {variables,mvu,...display} = message
    return createHash('sha256').update(JSON.stringify(display)).digest('hex')
  }
  function output(result, shared) { return shared ? {...result} : structuredClone({...result,projections:Array.from(result.projections)}) }
  let bytes = 0
  const stats = { rebuilt: 0, incremental: 0, reused: 0, projectedMessages: 0 }
  async function project(chat, options = {}, statusOptions = options, {shared = false} = {}) {
    const signature = createHash('sha256').update(JSON.stringify([displayDependencies(options), displayDependencies(statusOptions), chat.timeline?.branchId])).digest('hex')
    const previous = cache.get(chat.id)
    const revision = chat._storageRevision
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    let changes
    if (previous?.signature === signature && Number.isSafeInteger(revision)) {
      if (previous.revision === revision) { stats.reused++; return output(previous.result,shared) }
      if (previous.revision < revision) {
        try { changes = await readChanges?.(chat.id, previous.revision) }
        catch { changes = undefined } // The full Chat was already read successfully.
      }
    }
    const compatible = changes && changes.baseRevision === previous.revision && changes.chat?._storageRevision === revision
      && changes.messageCount === messages.length && changes.denseMessages && Array.isArray(changes.indices)
      && changes.indices.every((index, at) => Number.isSafeInteger(index) && index >= 0 && index < messages.length && (at === 0 || index > changes.indices[at - 1]))
    // MVU payloads/receipts do not participate in body or static panel projection.
    // Check only the declared dirty sources, then retain the immutable result.
    if (compatible && messages.length === previous.roles.length
      && changes.indices.every(id => sourceKey(messages[id]) === previous.sources[id])) {
      if (cache.get(chat.id) === previous) previous.revision = revision
      stats.reused++
      return output(previous.result,shared)
    }
    let rows, roles, before, indices
    if (compatible) {
      rows = previous.rows
      roles = previous.roles
      before = previous.before
      indices = [...changes.indices]
      const structural = messages.length !== previous.roles.length || indices.some(i => messages[i]?.role !== previous.roles[i])
      if (structural) {
        const first = indices.reduce((first, index) => Math.min(first, index), Math.min(previous.roles.length, messages.length))
        indices = Array.from({length: messages.length - first}, (_, i) => first + i)
      }
      stats.incremental++
    } else {
      rows = []; roles = []; before = []
      indices = Array.from({length: messages.length}, (_, i) => i)
      stats.rebuilt++
    }
    const bound = depthBound(options)
    // New messages move every floor deeper; only floors that were within the bound can change.
    if (compatible && bound !== null) {
      const from = Math.max(0, Math.min(messages.length, previous.roles.length) - bound - 2)
      const tail = Array.from({length: messages.length - from}, (_, i) => from + i)
      indices = [...new Set([...indices, ...tail])].sort((left, right) => left - right)
    }
    const rowEdits = new Map(), roleEdits = new Map(), beforeEdits = new Map()
    const at = (edits,values,id) => edits.has(id) ? edits.get(id) : values[id]
    const projectionEdits = [], targetEdits = []
    const prepared = new Map()
    const projectMessages = (list, index) => {
      const depth = bound === null ? options.depth : Math.min(messages.length - 1 - index, bound + 1)
      if (!prepared.has(depth)) prepared.set(depth, projectReplyHistory.prepare(bound === null ? options : {...options, depth}))
      return prepared.get(depth)(list)
    }
    for (const index of indices) {
      const message = messages[index]
      beforeEdits.set(index, index === 0 ? 1 : at(beforeEdits,before,index-1) + (at(roleEdits,roles,index-1) === 'user' ? 1 : 0))
      roleEdits.set(index,message?.role)
      targetEdits.push([index,message?.role === 'assistant' ? Number(message.turn) || beforeEdits.get(index) : undefined])
      if (message?.role !== 'assistant') { rowEdits.set(index,null); projectionEdits.push([index,undefined]); continue }
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : beforeEdits.get(index)))
      if (turn === 0) { rowEdits.set(index,null); projectionEdits.push([index,undefined]); continue }
      const row = projectMessages([{...message, turn}], index)
      for (const projection of row.projections) projection.body = replyBody(projection, chat, message)
      freezeJson(row)
      rowEdits.set(index,row)
      projectionEdits.push([index,row.projections[0]])
      stats.projectedMessages++
    }
    if (compatible) for (let id=messages.length;id<previous.rows.length;id++) projectionEdits.push([id,undefined])
    rows = rowIndex.update(rows,[...rowEdits],messages.length)
    roles = metadataIndex.update(roles,[...roleEdits],messages.length)
    before = metadataIndex.update(before,[...beforeEdits],messages.length)
    const projections = compatible ? projectionIndex.update(previous.projections,projectionEdits) : projectionIndex.from(projectionEdits)
    const targets = targetIndex.update(compatible ? previous.targets : [],targetEdits,messages.length)
    const hasStatusRules = (statusOptions.regexScripts || []).some(rule => rule && rule.disabled !== true && rule.enabled !== false && statusViewDeclaration(rule))
    const statusSummary={latestTurn:Math.max(1,targetIndex.maximum(targets)),previous:compatible?previous.statusState:undefined,onMatch:onStatusMatch,onFilter:onStatusFilter,onFallback:onStatusFallback,messageIndices:compatible?indices:undefined}
    const status = hasStatusRules ? projectPersistentStatusView(messages, projections, statusOptions, statusSummary) : {projections,statusView:null,statusViews:[]}
    const latest = rowIndex.previous(rows,rows.length)
    const result = freezeJson({ ...status, presentation: null, latestSourceBacked: rows[latest]?.latestSourceBacked || false })
    const sources = compatible
      ? sourceIndex.update(previous.sources,indices.map(id=>[id,sourceKey(messages[id])]),messages.length)
      : sourceIndex.from(messages.map(sourceKey))
    const resultSize = hasStatusRules ? statusSummary.filteredBytes + JSON.stringify(result.statusViews).length*2 : projectionIndex.info(projections).bytes + 256
    const size = targetIndex.info(targets).bytes + rowIndex.info(rows).bytes + metadataIndex.info(roles).bytes + metadataIndex.info(before).bytes + resultSize + 512 + sourceIndex.info(sources).bytes
    if (Number.isSafeInteger(revision) && size <= maxBytes && maxEntries > 0 && !(cache.get(chat.id)?.revision > revision)) {
      if (cache.has(chat.id)) { bytes -= cache.get(chat.id).size; cache.delete(chat.id) }
      while (cache.size && (bytes + size > maxBytes || cache.size >= maxEntries)) {
        const oldest = cache.keys().next().value; bytes -= cache.get(oldest).size; cache.delete(oldest)
      }
      cache.set(chat.id, {revision, signature, rows, roles, before, result, size, sources, projections, targets, statusState:statusSummary.next}); bytes += size
    }
    return output(result,shared)
  }
  return { project, stats: () => ({...stats, entries: cache.size, estimatedBytes: bytes}) }
}
