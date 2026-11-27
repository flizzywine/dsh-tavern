import { worldbookTitleHints } from './worldbook-title-hints.js'
import { classifyWorldbookEntry, hasWorldbookPreprocessingSyntax, isStaticWorldbookSkillEntry, isWorldbookRuntimeEntry } from './worldbook-entry-classification.js'
import { createWorldbookAutoInjection, recentCompletedWorldbookTurns } from './worldbook-auto-injection.js'
import { currentVirtualState, withdrawnEntryText, virtualEntriesVersion, virtualEntryVersion, virtualDependencyHash, virtualHash, virtualScope, virtualDependencyHasDynamicValue } from './worldbook-virtual-state.js'
import { promptOrder } from './worldbook-activation.js'
import { worldbookRandomState, hasWorldbookRandom, entryRandom } from './worldbook-random.js'
import { hasTavernHelperVariableMacro } from './tavern-helper-variable-macros.js'
import { fingerprint, isMvuUpdateEntry, isWorldBookTemplateEntry, prepareTemplateWorldbook, projectWorldBookRequest, worldbookTemplatesEnabled } from './worldbook-recall.js'

/** Persist only preprocessing differences. Original bodies stay authoritative in
 * the bound worldbook, never copied wholesale into a Chat header cache. */
function preparationSnapshot(prepared, sourceEntries) {
  const sources = new Map(sourceEntries.map(entry => [entry.ref, entry]))
  const overrides = {}
  const refs = []
  for (const entry of prepared?.view?.entries || []) {
    const source = sources.get(entry.ref)
    if (!source) continue
    refs.push(entry.ref)
    const changes = {}
    for (const key of Object.keys(entry)) {
      if (JSON.stringify(entry[key]) !== JSON.stringify(source[key])) changes[key] = entry[key]
    }
    if (Object.keys(changes).length) overrides[entry.ref] = changes
  }
  return { templatePrepared: true, templateScopes: prepared.templateScopes,
    templateActivationRequests: prepared.templateActivationRequests, refs, overrides }
}
function restorePreparation(cached, worldBook) {
  const source = new Map((worldBook?.view?.entries || []).map(entry => [entry.ref, entry]))
  return { ...worldBook, templatePrepared: true, templateScopes: cached.templateScopes,
    templateActivationRequests: cached.templateActivationRequests,
    view: { ...worldBook?.view, entries: cached.refs.flatMap(ref => source.has(ref) ? [{ ...source.get(ref), ...cached.overrides?.[ref] }] : []) } }
}

/** A character designed in this game enters the next request once per design version,
 * even when nobody names it; afterwards it follows ordinary keyword recall. */
function unreadCharacterDesigns(worldBook, chat) {
  const names = new Set((chat.characterDesignDocument?.characters || []).map(character => character?.name).filter(Boolean))
  if (!names.size) return []
  return (worldBook?.view?.entries || []).filter(entry => {
    const design = entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.characterDesign
    const read = chat.worldBookReads?.[entry.ref]
    return design && names.has(design.name) && entry.enabled !== false && String(entry.content || '').trim() && read?.fingerprint !== fingerprint(entry.content)
  }).map(entry => ({ ref: entry.ref, force: true, sourceRef: '[CHARACTER_DESIGN]' }))
}

/** One request uses one bound-book snapshot for both selection and rendering. */
export function createForegroundWorldbook({ bound, runtime, globalVariables, templateSettings = () => undefined, scanText = () => '' }) {
  const requests = new Map()
  const projectAutoInjection = createWorldbookAutoInjection()
  // `preparationKey` 只影响上游整书预处理的复用：历史迁移一轮一个 requestKey，
  // 但一本书在同一段迁移里并不变，预处理没必要每轮重跑一遍。
  const project = async function project({ requestKey, preparationKey, chat, card, turn: nativeTurn, userText, userTextInHistory = false, worldBook: snapshot, purpose = 'generation', signal, selectedRefs = [], recentlyReadRefs = [], worldbookEpoch = '' }) {
    try {
      // No bound book is an empty projection, including its request preparation cache.
      let worldBook = snapshot || await bound(chat.cardPath, card, chat, {purpose,userText}) || { view: { entries: [] } }
      const turn = Number([...(chat.messages || [])].reverse().find(message => message?.role === 'assistant')?.turn) || 0
      const randomState = worldbookRandomState(chat, turn)
      const [templateRuntime, globals, settings] = await Promise.all([runtime(chat.sessionId), globalVariables(), templateSettings()])
      const useTemplates = worldbookTemplatesEnabled(settings)
      const sourceEntries = worldBook?.view?.entries || []
      const executionKey = String(requestKey ?? `${turn}:${purpose}:${virtualHash(userText || '')}`)
      const preparationScope = String(preparationKey ?? executionKey)
      const scope = virtualScope(chat)
      const resolvedScanText = await scanText(chat)
      const completedTurns = purpose === 'generation' ? recentCompletedWorldbookTurns(chat.messages) : new Set()
      const currentTurn = nativeTurn ?? ((completedTurns.values().next().value ?? 0) + 1)
      const version = virtualHash([executionKey, virtualEntriesVersion(sourceEntries), selectedRefs, resolvedScanText, recentlyReadRefs, useTemplates,
        purpose, userText, userTextInHistory, worldbookEpoch, currentTurn, [...completedTurns]])
      const previous = requests.get(scope)
      if (previous?.version === version) return await previous.result
      // Upstream preprocessing is an effectful whole-book batch without a
      // per-entry guard. Freeze it for one explicit execution request; ordinary
      // body edits may refresh, but new/changed decorators wait for next round.
      const persistedPreparation = useTemplates && chat.worldBookVirtualState?.scope === scope && chat.worldBookVirtualState.preprocessing?.requestKey === preparationScope
        ? chat.worldBookVirtualState.preprocessing : null
      const previousPreparation = useTemplates && previous?.useTemplates && previous.preparationKey === preparationScope ? previous.preparation : null
      const reusingPreparation = Boolean(previousPreparation || persistedPreparation)
      const preparation = !useTemplates ? Promise.resolve({ prepared: worldBook, sources: [] })
        : previousPreparation || (persistedPreparation
          ? Promise.resolve({ sources: persistedPreparation.sources, snapshot: persistedPreparation.prepared, prepared: restorePreparation(persistedPreparation.prepared, worldBook) })
          : prepareTemplateWorldbook(worldBook, templateRuntime, chat, globals, settings).then(prepared => ({ prepared, snapshot: preparationSnapshot(prepared, sourceEntries),
            sources: sourceEntries.map(entry => ({ ref: entry.ref, version: virtualEntryVersion(entry), decorated: hasWorldbookPreprocessingSyntax(entry), enabled: entry.enabled })) })))
      const result = (async () => {
        const initial = await preparation
        const preparationDiagnostics = []
        if (reusingPreparation) {
          const oldSources = new Map(initial.sources.map(entry => [entry.ref, entry]))
          const transformed = new Map((initial.prepared?.view?.entries || []).map(entry => [entry.ref, entry]))
          const current = new Map(sourceEntries.map(entry => [entry.ref, entry]))
          const revokedController = initial.sources.some(entry => entry.decorated && (!current.has(entry.ref) || (entry.enabled !== false && current.get(entry.ref).enabled === false)))
          const entries = sourceEntries.flatMap(entry => {
            const old = oldSources.get(entry.ref)
            if (old && old.version === virtualEntryVersion(entry)) return transformed.has(entry.ref) ? [transformed.get(entry.ref)] : []
            if (hasWorldbookPreprocessingSyntax(entry) || old?.decorated) {
              preparationDiagnostics.push({ kind: 'worldbook-template', code: 'preprocessing-edit-deferred-to-next-request', ref: entry.ref })
              return []
            }
            return [entry]
          })
          worldBook = { ...worldBook, templatePrepared: true, templateScopes: revokedController ? undefined : initial.prepared.templateScopes,
            templateActivationRequests: revokedController ? [] : initial.prepared.templateActivationRequests?.filter(request => entries.some(entry => entry.ref === request.ref)),
            view: { ...worldBook.view, entries } }
        } else worldBook = initial.prepared
        if (!useTemplates) worldBook = { ...worldBook, templateActivationRequests: [], templateScopes: undefined,
          view: { ...worldBook.view, entries: sourceEntries.filter(entry => !isWorldBookTemplateEntry(entry)) } }
        const preparedActivations = [...(worldBook?.templateActivationRequests || []), ...unreadCharacterDesigns(worldBook, chat), ...(worldBook?.pluginActivationRequests || []), ...selectedRefs.map(ref => ({ ref, force: false, sourceRef: '[STRATEGY]' }))]
        const previousState = previous?.requestKey === executionKey ? (await previous.result).virtualState : undefined
        const executionChat = previousState ? { ...chat, worldBookVirtualState: previousState } : chat
        const projected = await projectNativeWorldbook({ worldBook, sourceEntries, chat: executionChat, card, templateRuntime, globals, preparedActivations, randomState, turn,
          requestKey: executionKey, userText, userTextInHistory, scanText: resolvedScanText, recentlyReadRefs, signal,
          autoInjection: purpose !== 'generation' ? null : { project: projectAutoInjection, currentTurn, completedTurns, epoch: worldbookEpoch } })
        if (useTemplates && initial.sources.some(entry => entry.decorated)) projected.virtualState.preprocessing = {
          requestKey: preparationScope, sources: initial.sources,
          prepared: initial.snapshot
        }
        projected.diagnostics.push(...preparationDiagnostics)
        return projected
      })()
      requests.set(scope, { version, requestKey: executionKey, preparationKey: preparationScope, useTemplates, preparation, result })
      // A bounded foreground-request cache. No background scope is admitted.
      if (requests.size > 32) requests.delete(requests.keys().next().value)
      try { return await result } catch (error) { if (requests.get(scope)?.result === result) requests.delete(scope); throw error }
    } catch (error) {
      if (signal?.aborted || error.code === 'FULL_TEMPLATE_UNAVAILABLE') throw error
      return { log: { error: String(error?.message || error), entries: [], outputs: [], counts: {} }, context: '', refs: [], diagnostics: [], activation: { schemaVersion: 2, refs: [], mode: 'error' }, error: String(error?.message || error) }
    }
  }
  project.dispose = () => requests.clear()
  return project
}

/** Native strategy: static optional content is selectively injected and always searchable;
 * dynamic optional entries retain native conditions. Each controller executes at
 * most once per request, including activation convergence and empty outputs. */
async function projectNativeWorldbook({ worldBook, sourceEntries, chat, card, templateRuntime, globals, preparedActivations, randomState, turn, requestKey, userText, userTextInHistory, scanText, recentlyReadRefs, signal, autoInjection }) {
  const original = new Map(sourceEntries.map(entry => [entry.ref, entry]))
  const classify = entry => {
    const type = classifyWorldbookEntry(original.get(entry.ref) || entry)
    return virtualDependencyHasDynamicValue(type, chat, card, globals) ? { ...type, nativeFallback: true, occasion: 'request' } : type
  }
  const cacheReaders = new Map(sourceEntries.filter(entry => !classify(entry).nativeFallback).map(entry => [entry.ref, classify(entry).dependencies]))
  const virtualState = currentVirtualState(chat, sourceEntries)
  const executionSeed = chat.worldBookVirtualState?.scope === virtualState.scope && chat.worldBookVirtualState.execution?.requestKey === requestKey
    ? chat.worldBookVirtualState.execution.seed : randomState.seed
  virtualState.execution = { requestKey, seed: executionSeed }
  const visibleRefs = new Set((worldBook?.view?.entries || []).filter(entry => entry.enabled !== false).map(entry => entry.ref))
  virtualState.visibility = { version: virtualHash(sourceEntries), refs: [...visibleRefs] }
  const dynamicEntries = (worldBook?.view?.entries || []).filter(entry => classify(entry).dynamic)
  const activePoolEntries = (worldBook?.view?.entries || []).filter(entry => {
    const type = classify(entry)
    return type.dynamic || type.kind === 'static-tail'
  })
  const dynamicRefs = new Set(dynamicEntries.map(entry => entry.ref))
  // Old saves can still have a runtime snapshot for an entry now in the fixed
  // prefix. Remove it before the recovery hook can append it again.
  for (const ref of Object.keys(virtualState.entries)) {
    if (!visibleRefs.has(ref) || !dynamicRefs.has(ref)) delete virtualState.entries[ref]
  }
  const renderCache = new Map()
  // Persisted per-request projections prevent random/side-effect resampling after
  // an executor restart. Versions and the game scope were validated above.
  for (const [ref, snapshot] of Object.entries(virtualState.entries)) {
    if (snapshot.requestKey === requestKey && snapshot.projection) renderCache.set(ref, snapshot.projection)
  }
  const staticEntries = promptOrder((worldBook?.view?.entries || []).filter(entry => entry.enabled !== false && classify(entry).kind === 'static-constant' && !isMvuUpdateEntry(entry)))
  const staticPrefix = staticEntries.map(entry => String((original.get(entry.ref) || entry).content ?? '')).join('\n\n')
  const dynamicBook = { ...worldBook, view: { ...worldBook?.view, entries: activePoolEntries } }
  const recalled = { worldBook: dynamicBook, chat: { ...chat, worldBookReads: {} }, card, turn, userText, userTextInHistory, scanText }
  const { selectedEntries, toRender, projection: projected, activationRequests } = await projectWorldBookRequest({
    worldBook, recall: recalled, chat, runtime: templateRuntime, globalVariables: globals, preparedActivations, includeConstants: true,
    randomSeed: virtualHash([executionSeed, requestKey]), renderCache, cacheReaders, signal,
    select: entries => {
      const activated = new Set(entries.map(entry => entry.ref))
      const selectedEntries = activePoolEntries.filter(entry => activated.has(entry.ref))
      // Opaque native controllers can modify projection-local macro/template scopes.
      // Their presence is a defined render occasion for otherwise pure readers.
      const hasNativeController = selectedEntries.some(entry => classify(entry).nativeFallback)
      const toRender = selectedEntries.filter(entry => {
        const type = classify(entry), source = original.get(entry.ref) || entry
        if (type.kind === 'static-constant') return false // always prefix, never a history frame
        if (!type.dynamic) return false // static optional bodies have a separate admission path
        const previous = virtualState.entries[entry.ref]
        const dependencyHash = virtualDependencyHash(type, chat, card, globals)
        return !previous || previous.version !== virtualEntryVersion(source) || hasNativeController ||
          (type.nativeFallback ? previous.requestKey !== requestKey : previous.dependencyHash !== dependencyHash)
      })
      return { selectedEntries, toRender }
    }
  })
  const changed = []
  for (const entry of toRender) {
    const type = classify(entry)
    const output = projected.renderedEntries.find(output => output.ref === entry.ref)
    if (!type.dynamic) { if (output) changed.push(output); continue }
    if (projected.diagnostics.some(item => item.ref === entry.ref)) continue
    const text = output?.text || '', renderHash = virtualHash(text)
    const previous = chat.worldBookVirtualState?.scope === virtualState.scope ? chat.worldBookVirtualState.entries?.[entry.ref] : undefined
    const withdrawn = !text && Boolean(previous?.text || previous?.withdrawn)
    const contextText = text || (withdrawn ? withdrawnEntryText(entry.ref) : '')
    virtualState.entries[entry.ref] = { contextText, withdrawn, version: virtualEntryVersion(original.get(entry.ref) || entry), text, renderHash, requestKey,
      dependencyHash: virtualDependencyHash(type, chat, card, globals), projection: renderCache.get(entry.ref) }
    if (contextText && previous?.renderHash !== renderHash) changed.push({ ...output, ref: entry.ref, text: contextText, renderHash })
  }
  const hasProjectedHelperVariables = entry => virtualState.entries[entry.ref]?.projection?.helperVariableMacros === true
  const variableConstantRefs = promptOrder(selectedEntries.filter(entry =>
    (entry.constant === true || classify(entry).channel !== 'auto')
    && (hasTavernHelperVariableMacro(entry.content) || hasProjectedHelperVariables(entry)))).map(entry => entry.ref)
  const changedByRef = new Map(changed.map(output => [output.ref, output]))
  const tailOutputs = []
  const tailRefs = new Set()
  // 显式钉在 tail 通道的已激活条目每轮都贴近最新消息注入，不因静态或内容未变化而省略。
  for (const entry of promptOrder(selectedEntries)) {
    const type = classify(entry)
    if (type.channel !== 'tail') continue
    const sourceEntry = original.get(entry.ref) || entry
    const text = type.dynamic
      ? (changedByRef.get(entry.ref)?.text ?? virtualState.entries[entry.ref]?.contextText ?? virtualState.entries[entry.ref]?.text ?? '')
      : String(sourceEntry.content ?? '').trim()
    if (!text) continue
    tailRefs.add(entry.ref)
    const changedEntry = changedByRef.get(entry.ref)
    tailOutputs.push({ ref: entry.ref, text, location: 'foreground', ...(changedEntry?.renderHash ? { renderHash: changedEntry.renderHash } : {}) })
  }
  const staticOptionalBook = { ...worldBook, view: { ...worldBook?.view,
    entries: (worldBook?.view?.entries || []).filter(entry => classify(entry).kind === 'static-skill' && isStaticWorldbookSkillEntry(entry)) } }
  const titleInput = { worldBook: staticOptionalBook, chat, turn, userText, userTextInHistory, scanText, recentlyReadRefs, ignorePlaceholders: true,
    random: entryRandom(virtualHash([executionSeed, requestKey]), 'title-hints') }
  const automatic = autoInjection?.project(titleInput, { ...autoInjection, entries: staticOptionalBook.view.entries, original,
    prior: chat.worldBookVirtualState?.scope === virtualState.scope ? chat.worldBookVirtualState.automatic : undefined })
  if (automatic) virtualState.automatic = automatic.state
  const autoOutputs = automatic?.selected || []
  const refs = [...new Set([
    ...changed.filter(output => !original.get(output.ref)?.constant).map(output => output.ref),
    ...tailOutputs.filter(output => !original.get(output.ref)?.constant).map(output => output.ref),
    ...autoOutputs.map(output => output.ref)
  ])]
  const titleHints = automatic?.titleHints ?? worldbookTitleHints(titleInput)
  const runtimeChanged = changed.filter(output => !tailRefs.has(output.ref) && (isWorldbookRuntimeEntry(original.get(output.ref) || {}) || hasProjectedHelperVariables(output)))
  const deliveredOutputs = [...runtimeChanged, ...tailOutputs, ...autoOutputs]
  const renderedMap = new Map(changed.map(output => [output.ref, output]))
  for (const output of [...tailOutputs, ...autoOutputs]) if (!renderedMap.has(output.ref)) renderedMap.set(output.ref, output)
  const renderedEntries = [...renderedMap.values()]
  // File-version notifications are emitted once by the shared pre-step hook,
  // for both foreground and background agents; do not duplicate them here.
  const context = deliveredOutputs.map(output => output.text).join('\n\n')
  return { ...projected, context, foregroundContext: context, titleHints, automaticContext: autoOutputs.map(output => output.text).join('\n\n'), prefixContext: staticPrefix, staticPrefix, virtualState, variableConstantRefs, changedVirtualRefs: changed.filter(output => classify(original.get(output.ref) || {}).dynamic).map(output => output.ref), renderedEntries, refs, reads: { ...chat.worldBookReads },
    randomState: { ...randomState, seed: executionSeed, outputs: { ...randomState.outputs, ...Object.fromEntries(projected.renderedEntries
      .filter(output => hasWorldbookRandom(original.get(output.ref)?.content)).map(output => [output.ref, output.text])) } },
    activation: { schemaVersion: 2, turn, refs, diagnostics: [], mode: 'native-skills' },
    log: { strategy: 'native-skills', entries: [...selectedEntries.map(entry => ({ ref: entry.ref, title: entry.title, reason: classify(entry).kind })),
      ...autoOutputs.map(({ ref, title, score }) => ({ ref, title, score, reason: 'keyword-bm25' }))],
      outputs: deliveredOutputs, counts: { changed: changed.length, static: staticEntries.length, automatic: autoOutputs.length }, activationRequests, templateDiagnostics: projected.diagnostics }, error: null }
}
