import { isScopedMessages } from './scoped-messages.js'
import { worldbookPlacement } from './worldbook-placement.js'
import { entryRandom, renderWorldbookRandom } from './worldbook-random.js'
import { projectAgentContent } from './runtime-content-projection.js'
import { lastTavernHelperVariables } from './tavern-helper-context.js'
import { activateWorldBook, promptOrder, worldBookSettings } from './worldbook-activation.js'
import { isMvuUpdateEntry } from './worldbook-mvu-entry.js'

const READ_COOLDOWN_TURNS = 10

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

// Replay a cached projection's writes, not its whole old snapshot: newly
// activated earlier controllers may have introduced unrelated state changes.
function replayProjectionDelta(current, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return clone(current)
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' || Array.isArray(before) || Array.isArray(after)) return clone(after)
  const next = { ...(current || {}) }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!Object.hasOwn(after, key)) delete next[key]
    else if (!Object.hasOwn(before, key)) next[key] = clone(after[key])
    else next[key] = replayProjectionDelta(next[key], before[key], after[key])
  }
  return next
}
function readerInputs(dependencies, macroState, card) {
  return dependencies?.map(({ scope, key }) => {
    const owner = scope === 'identity' ? { char: card?.name, user: macroState?.userName || '你' } : macroState?.[scope] || {}
    return [scope, key, Object.hasOwn(owner, key), owner[key]]
  })
}

function charCount(value) {
  return Array.from(str(value).trim()).length
}

export function fingerprint(value) {
  const text = str(value)
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return text.length.toString(36) + ':' + (hash >>> 0).toString(36)
}

function enabledEntries(worldBook) {
  const view = worldBook && worldBook.view
  if (view === null || typeof view !== 'object') return []
  return (Array.isArray(view.entries) ? view.entries : []).filter(function (entry) {
    return entry && entry.enabled !== false && str(entry.content).trim() !== ''
  })
}

function allEntries(worldBook) {
  const view = worldBook && worldBook.view
  return view !== null && typeof view === 'object' && Array.isArray(view.entries) ? view.entries.filter(Boolean) : []
}

export function isWorldBookTemplateEntry(entry) {
  return /<%[=_-]?[\s\S]*?%>/i.test(str(entry && entry.content))
}

function templateBody(value) {
  const lines = str(value).replaceAll('\r\n', '\n').split('\n')
  let index = 0
  while (index < lines.length && /^@@\S*/.test(lines[index].trim())) index += 1
  return lines.slice(index).join('\n')
}

function templateResource(entry, book) {
  const { rawEntry, ...view } = entry
  return {
    ...view,
    uid: entry.sourceUid ?? entry.ref,
    world: str(book),
    key: entry.primaryKeys || [], keysecondary: entry.secondaryKeys || [], disable: entry.enabled === false,
    id: str(entry.sourceUid ?? entry.ref),
    name: str(entry.title || entry.comment),
    comment: str(entry.comment || entry.title),
    book: str(book),
    content: str(entry.content)
  }
}

function transcriptOf(chat) {
  // Only a runtime that reads its own session history accepts a partial Chat.
  if (isScopedMessages(chat?.messages)) throw new Error('世界书模板需要完整历史，但只读取了最近楼层')
  return (Array.isArray(chat && chat.messages) ? chat.messages : []).filter(Boolean).map(function (message) {
    return {
      role: message.role === 'user' ? 'user' : 'assistant',
      content: str(message.sourceText || message.text)
    }
  })
}

export { isMvuUpdateEntry }

export function mvuUpdateRulesFromWorldBook(worldBook) {
  return enabledEntries(worldBook).filter(isMvuUpdateEntry).map(function (entry) {
    return str(entry.content).trim()
  })
}

function readRecord(chat, entry) {
  const reads = chat && chat.worldBookReads
  if (reads === null || typeof reads !== 'object' || Array.isArray(reads)) return null
  const record = reads[str(entry && entry.ref)]
  return record !== null && typeof record === 'object' && !Array.isArray(record) ? record : null
}

function isCoolingDown(chat, entry, turn) {
  const record = readRecord(chat, entry)
  if (record === null || str(record.fingerprint) !== fingerprint(entry && entry.content)) return false
  const readTurn = Number(record.turn)
  const currentTurn = Number(turn)
  if (!Number.isSafeInteger(readTurn) || !Number.isSafeInteger(currentTurn)) return false
  const elapsed = currentTurn - readTurn
  // A read is recorded while sending its turn; a screening verdict after the reply,
  // so the very next send already counts as its first cooled turn.
  if (record.kind === 'screened') return elapsed >= 0 && elapsed < READ_COOLDOWN_TURNS ? 'screened' : false
  return elapsed > 0 && elapsed <= READ_COOLDOWN_TURNS ? 'read' : false
}

function readRecorder(entries, turn) {
  return function recordReads(existing) {
    const next = clone(existing !== null && typeof existing === 'object' && !Array.isArray(existing) ? existing : {})
    for (const entry of entries) {
      next[str(entry.ref)] = { turn: Number(turn) || 0, fingerprint: fingerprint(entry.content) }
    }
    return next
  }
}

/** Snapshot constant content; request projection partitions mixed positions separately. */
export function constantWorldBookContext(input = {}) {
  const entries = promptOrder(enabledEntries(input.worldBook).filter(function (entry) {
    return entry.constant === true && !isMvuUpdateEntry(entry) && !isWorldBookTemplateEntry(entry)
  }))
  return {
    context: entries.map(function (entry) { return str(entry.content).trim() }).filter(Boolean).join('\n\n'),
    refs: entries.map(function (entry) { return str(entry.ref) }),
    count: entries.length,
    totalChars: entries.reduce(function (total, entry) { return total + charCount(entry.content) }, 0)
  }
}

/** Let the upstream plugin preprocess/filter its decorators before native keyword selection. */
export async function prepareTemplateWorldbook(worldBook, runtime, chat, globals = {}) {
  if (!worldBook?.view || worldBook.templatePrepared || !runtime.prepareWorldbook) return worldBook
  const entries = allEntries(worldBook)
  // The engine reads decorators only from leading @@ lines, so `lora@@@2@@@` in prose is plain text.
  // Disabled entries still count: [GENERATE:] controllers are usually disabled in the source book.
  if (!entries.some(entry => /^@@/.test(str(entry.content)) || /\[(?:GENERATE:|RENDER:|InitialVariables|Preprocessing)|@INJECT/.test(entry.content + '\n' + (entry.comment || entry.title)))) return worldBook
  const result = await (runtime.prepareWorldbookProjection || runtime.prepareWorldbook)(entries.map(entry => templateResource(entry, worldBook.view.displayName)), {
    worldBookEntries: entries.map(entry => ({uid:entry.sourceUid ?? entry.ref,ref:entry.ref,world:worldBook.view.displayName})),
    scopes: {global: globals, local: chat.variables || {}, initial: chat.promptTemplateInitialVariables || {}, message: lastTavernHelperVariables(chat.promptTemplateInput?.message ? [chat.promptTemplateInput.message] : chat.messages) || {}}
  })
  const transformed = result.entries.flatMap(entry => {
    const original = entries.find(item => String(item.sourceUid ?? item.ref) === String(entry.uid))
    return original ? [{ ...original, ...entry, ref: original.ref, content: entry.content, enabled: !entry.disable, primaryKeys: entry.key || [], secondaryKeys: entry.keysecondary || [], constant: original.constant }] : []
  })
  return { ...worldBook, templatePrepared: true, templateScopes: result.scopes, templateActivationRequests: (result.activationRequests || []).map(request => ({...request, sourceRef:"[GENERATE:BEFORE]"})), view: { ...worldBook.view, entries: transformed } }
}

/** Resolve enabled constant EJS controllers for one request.
 * includeConstants also projects plain entries and shares their macro state with
 * the caller, so constant setters can feed subsequently recalled entries.
 * Disabled entries remain addressable by getwi(), but never activate themselves.
 * Scope mutations stay inside this read-only projection and cannot change Chat state.
 */
export async function projectWorldBookTemplates(input = {}) {
  const runtime = input.runtime
  if (!runtime || typeof runtime.render !== 'function') throw new Error('缺少世界书模板运行时')
  const resources = allEntries(input.worldBook)
  const controllers = promptOrder((input.selectedEntries || resources).filter(function (entry) {
    return (entry.enabled !== false || (input.activationRequests || []).some(request => request.ref === entry.ref && request.force)) && (input.selectedEntries || entry.constant === true) && (input.mvuUpdateOnly === true ? isMvuUpdateEntry(entry) : !isMvuUpdateEntry(entry)) && (input.includeConstants === true || isWorldBookTemplateEntry(entry))
  }))
  const { foregroundRefs, prefixRefs } = worldbookPlacement([...resources.filter(entry => !isMvuUpdateEntry(entry)), ...controllers.filter(entry => entry.enabled === false).map(entry => ({ ...entry, enabled: true }))])
  const projectedEntries = []
  let scopes = input.worldBook?.templateScopes || {
    global: clone(input.globalVariables || {}),
    initial: clone(input.chat && input.chat.promptTemplateInitialVariables || {}),
    local: clone(input.chat && input.chat.variables || {}),
    message: input.messageVariables ?? lastTavernHelperVariables(input.chat?.promptTemplateInput?.message ? [input.chat.promptTemplateInput.message] : input.chat && input.chat.messages) ?? {}
  }
  let macroState = clone(input.chat?.macroState || {})
  const context = []
  const refs = []
  const diagnostics = []
  const activationRequests = []
  const templateContext = {
    charName: str(input.card && input.card.name),
    userName: str(input.chat && input.chat.macroState && input.chat.macroState.userName) || '你',
    runType: 'generate',
    generateType: str(input.generateType),
    ...(runtime.historyContext === 'session' ? {} : { transcript: transcriptOf(input.chat) }),
    worldBookSettings: worldBookSettings(input.worldBook),
    worldBookRandom: input.random,
    worldBookEntries: resources.map(function (entry) {
      // Template content is read from the executor's authoritative environment.
      // This list only maps upstream activations back to Tavern entry references.
      return { uid: entry.sourceUid ?? entry.ref, id: str(entry.sourceUid ?? entry.ref),
        ref: entry.ref, world: str(input.worldBook?.view?.displayName) }
    })
  }
  const templates = controllers.filter(entry => isWorldBookTemplateEntry(entry) && !input.renderCache?.has(entry.ref))
  // Plain entries only affect the host macro state below, not template scopes.
  // Keep their output interleaved in the original order after the batch returns.
  const useBatch = templates.length > 0 && typeof runtime.renderProjections === 'function' && !input.renderCache?.size
  const batch = useBatch
    ? await runtime.renderProjections(templates.map(entry => ({ template: templateBody(entry.content), randomRef: entry.ref })),
      { ...templateContext, scopes, randomSeed: input.randomSeed }) : null
  if (useBatch && (!Array.isArray(batch) || batch.length !== templates.length || batch.some(result => typeof result?.ok !== 'boolean'))) {
    const error = new Error('世界书模板批量结果不完整，请刷新酒馆页面后重试')
    error.code = 'FULL_TEMPLATE_UNAVAILABLE'
    throw error
  }
  let templateIndex = 0
  for (const entry of controllers) {
    let cached = input.renderCache?.get(entry.ref)
    const dependencies = input.cacheReaders?.get(entry.ref)
    const readerState = readerInputs(dependencies, macroState, input.card)
    if (cached && dependencies && !cached.effectful && JSON.stringify(cached.readerState) !== JSON.stringify(readerState)) {
      input.renderCache.delete(entry.ref); cached = null
    }
    if (cached) {
      scopes = replayProjectionDelta(scopes, cached.beforeScopes, cached.scopes)
      macroState = replayProjectionDelta(macroState, cached.beforeMacroState, cached.macroState)
      activationRequests.push(...cached.activationRequests)
      if (cached.diagnostic) diagnostics.push(cached.diagnostic)
      if (cached.text) { context.push(cached.text); projectedEntries.push({ ...entry, content: cached.text }); refs.push(str(entry.ref)) }
      continue
    }
    const beforeScopes = input.renderCache ? clone(scopes) : undefined
    const beforeMacroState = input.renderCache ? clone(macroState) : undefined
    const random = input.randomSeed ? entryRandom(input.randomSeed, entry.ref) : (input.random || Math.random)
    const result = isWorldBookTemplateEntry(entry)
      ? batch ? batch[templateIndex++] : await (runtime.renderProjection || runtime.render).call(runtime, templateBody(entry.content), Object.assign({}, templateContext, { scopes, randomSeed: input.randomSeed, randomRef: entry.ref }))
      : { ok: true, text: entry.content, scopes }
    if (!result.ok) {
      const diagnostic = { kind: 'worldbook-template', code: result.kind, ref: str(entry.ref) }
      diagnostics.push(diagnostic)
      input.renderCache?.set(entry.ref, { diagnostic, beforeScopes, beforeMacroState, scopes: clone(scopes), macroState: clone(macroState), activationRequests: [] })
      continue
    }
    for (let count = 0; count < (result.randomCalls || 0); count++) random()
    const entryActivations = (result.activationRequests || []).map(request => ({ ...request, sourceRef: entry.ref }))
    activationRequests.push(...entryActivations)
    if (!useBatch || input.renderCache) scopes = clone(result.scopes)
    const projected = input.includeConstants === true
      ? projectAgentContent(renderWorldbookRandom(result.text, random), { charName: str(input.card?.name), macroState }) : null
    if (projected) macroState = projected.macroState
    const text = str(input.randomOutputs?.[entry.ref] ?? (projected ? projected.agentText : result.text)).trim()
    input.renderCache?.set(entry.ref, { text, beforeScopes, beforeMacroState, scopes: clone(result.scopes || scopes), macroState: clone(macroState), activationRequests: entryActivations, readerState, effectful: !dependencies || /\{\{|<%/.test(JSON.stringify(readerState)) })
    if (text === '') continue
    context.push(text)
    projectedEntries.push({ ...entry, content: text })
    refs.push(str(entry.ref))
  }
  return {
    context: context.join('\n\n'),
    renderedEntries: projectedEntries.map(entry => ({ ref: entry.ref, text: entry.content, location: foregroundRefs.has(entry.ref) ? 'foreground' : 'prefix', ...(foregroundRefs.has(entry.ref) && prefixRefs.has(entry.ref) ? { alsoInPrefix: true } : {}) })),
    prefixContext: projectedEntries.filter(entry => prefixRefs.has(entry.ref)).map(entry => entry.content).join('\n\n'),
    foregroundContext: projectedEntries.filter(entry => foregroundRefs.has(entry.ref)).map(entry => entry.content).join('\n\n'),
    refs,
    diagnostics,
    evaluated: controllers.length,
    activationRequests,
    ...(input.includeConstants === true ? { dynamicConstants: true, macroState } : {})
  }
}

/** Select non-constant entries within a token budget; retain the existing ten-turn cooldown. */
export function prepareWorldBookRecall(input = {}) {
  const forced = new Set((input.activationRequests || []).filter(request => request.force).map(request => request.ref))
  const all = allEntries(input.worldBook).filter(entry => (entry.enabled !== false || forced.has(entry.ref)) && str(entry.content).trim() && !isMvuUpdateEntry(entry))
  const emptyRecorder = readRecorder([], input.turn)
  if (!input.worldBook || !input.worldBook.view) {
    return { kind: 'skip', context: '', refs: [], totalChars: 0, reason: 'unbound', recordReads: emptyRecorder }
  }
  if (all.length === 0) {
    return { kind: 'skip', context: '', refs: [], totalChars: 0, reason: 'empty', recordReads: emptyRecorder }
  }
  const totalChars = all.reduce(function (total, entry) { return total + charCount(entry.content) }, 0)
  const activation = activateWorldBook({ ...input, entries: all, isCoolingDown: entry => isCoolingDown(input.chat, entry, input.turn) })
  const selected = promptOrder(activation.entries.filter(entry => entry.constant !== true))
  return {
    kind: 'keywords',
    entries: activation.entries,
    diagnostics: activation.diagnostics,
    settings: activation.settings,
    budget: activation.budget,
    scanSources: activation.scanSources,
    context: selected.map(function (entry) { return str(entry.content).trim() }).filter(Boolean).join('\n\n'),
    refs: selected.map(function (entry) { return str(entry.ref) }),
    totalChars,
    matchedCount: selected.length,
    recordReads: readRecorder(selected, input.turn)
  }
}
