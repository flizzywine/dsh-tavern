import { worldBookDisplayName } from './worldbook-resource.js'
import { planTranscriptWindow } from './transcript-row-plan.js'
import { createInputFieldsProjection } from './input-fields-projection.js'
import { createScopedMessages } from './scoped-messages.js'
import { createSessionStateView, settlementTurn } from './chat-session-state.js'
import { rescueHistoryNotice } from './chat-history-rescue.js'
import { createIncrementalReplyView } from './incremental-reply-view.js'
import { latestStyleReference } from './style-reference.js'
import { sessionOpeningDescriptor } from './session-opening.js'
import { composeTavernRegexScripts } from './card-extension-reading.js'
import { applyRegexOverrides } from './regex-manager.js'
import { projectCharacterDesignDocument } from './character-design-document.js'
import { readLedger } from './story-ledger.js'
import { TAVERN_COMPATIBILITY_CAPABILITIES } from './tavern-compatibility-diagnostics.js'
import { assistantResultForTurn } from './session-turn-result.js'
import { forkTurnsByMessageId as forkTargetsFromSession } from './conversation-fork-targets.js'
import { projectTavernHelperContext, HELPER_MESSAGE_COLD_WINDOW } from './tavern-helper-context.js'
import { projectTavernHelperWorldbook } from './tavern-helper-worldbook.js'
import { projectTavernHelperScripts, hasTavernScriptRuntime } from './tavern-helper-scripts.js'
import { OFFICIAL_MVU_VERSION } from './official-mvu-assets.js'
import { projectRuntimeReply } from './runtime-content-projection.js'
import { userInputEditsOf } from './input-floor.js'
import { inputEventForTurn, inputKind, isFailedTurnEnd, isNewTurnInput } from './session-turn-input.js'
import { sessionEvents } from './session-events.js'

/** Own projection caches and field assembly for full, dirty, cached and bounded views. */
export function createSessionViewProjection({
  readChanges, scheduleTemplateSync, warmCandidates, requestPerformance, readTavernSettings, readScript,
  scriptContinuity, groupOfMode, tavernExtensionSettings, readCardExtensions, tavernRemoteAssets,
  liveCardUpdate, activityOf, cardUpdateStatus, agentRegistry, str, sessionResources, worldBooks,
  sessionDebugEvidence, cardViewOf, projectLedgerTask, projectCharacterDesignTask, projectPhoneChat,
  readPromptTemplateGlobalVariables, sessionStore, readChatCard, workspaceViewOf, helperHistoryAccess
}) {
  const inputFieldsProjection = createInputFieldsProjection()
  const incrementalReplyView = createIncrementalReplyView({ readChanges })
  async function view(chat, card, persistedProjection = false, options = {}) {
    const resourceRevision = options.resourceRevision ?? chat._storageRevision
    const deferResources = options.deferResources === true && chat.mode !== 'card'
      && Number.isSafeInteger(resourceRevision) && !!chat.cardDefinitionSnapshot
      && chat.openingWorldbookSnapshot?.version === 1

    if (!options.openingWindow) scheduleTemplateSync(chat)
    else void warmCandidates(chat.sessionId)
    const runtimeSettings = await requestPerformance.stage('settings', () => readTavernSettings())
    let scriptProgress = null
    if ((chat.mode || 'story') === 'script') {
      const script = await readScript(chat.cardPath)
      if (script !== undefined && Array.isArray(script.chunks)) {
        scriptProgress = scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'progress' } })
      }
    }
    const activePresetSnapshot = groupOfMode(chat.mode) === 'play' && chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object'
      ? chat.runtimePresetSnapshot
      : null
    let replyDisplay = { projections: replyProjectionsOf(chat), presentation: null, latestSourceBacked: false }
    let extensionSettings = {}
    let cardExtensions = { regexScripts: [], helperScripts: [] }
    if ((chat.mode || 'story') === 'story' || (chat.mode || 'story') === 'script') {
      extensionSettings = await tavernExtensionSettings.read()
      cardExtensions = await requestPerformance.stage('cardExtensions', () => readCardExtensions(chat.cardPath, chat, extensionSettings)) || cardExtensions
      const pinnedExtensions = await requestPerformance.stage('remoteAssets', () => tavernRemoteAssets.pinExtensions(cardExtensions))
      cardExtensions = Object.assign({}, cardExtensions, {
        helperScripts: pinnedExtensions.helperScripts,
        regexScripts: pinnedExtensions.regexScripts,
        remoteAssetDiagnostics: pinnedExtensions.diagnostics,
        remoteAssetPins: pinnedExtensions.pins
      })
      const presetRegexScripts = Array.isArray(activePresetSnapshot && activePresetSnapshot.regexScripts) ? activePresetSnapshot.regexScripts : []
      replyDisplay = await requestPerformance.stage('historyProjection', () => incrementalReplyView.project(persistedProjection ? chat : { ...chat, _storageRevision: undefined }, {
        charName: chat.cardName, macroState: chat.macroState,
        regexScripts: composeTavernRegexScripts(cardExtensions, presetRegexScripts, chat.regexOverrides && chat.regexOverrides.preset),
        placement: 2, isMarkdown: true, isEdit: false, depth: 0
      }, { charName: chat.cardName, macroState: chat.macroState, regexScripts: cardExtensions.regexScripts }, {shared:true}))
      replyDisplay = await liveCardUpdate.project(chat, card, replyDisplay, {charName:chat.cardName,macroState:chat.macroState,regexScripts:cardExtensions.regexScripts})
      replyDisplay.projections = withLegacyPresentationProjection(chat, replyDisplay.projections)
    }
    const activity = activityOf(chat)
    const { debugTurns, latestAssistantTurn: latestStoryTurn, latestAssistantMessageId } = latestTurnFields(chat)
    const forkTurnsByMessageId = forkTurnsForChat(chat)
    const {inputSources,inputTemplateDisplays}=inputFieldsProjection.project(persistedProjection ? chat : {...chat,_storageRevision:undefined}, options.inputChanges)
    const cardUpdate = ['story', 'script'].includes(chat.mode || 'story') && chat.requestMode !== 'sillytavern'
      ? await cardUpdateStatus(chat, { card, fresh: options.freshSnapshot === true, busy: activity.busy || ['pending', 'running', 'waiting-runtime'].includes(chat.settleStatus)
        || agentRegistry.get(chat.sessionId)?.phase?.kind === 'running', settings: runtimeSettings })
      : { available: false }
    const helperEnabled = hasTavernScriptRuntime(chat, cardExtensions.helperScripts)
    const helperRuntime = helperEnabled
      ? projectTavernHelperScripts(cardExtensions.helperScripts, chat.tavernHelperScriptVariables)
      : { scripts: [], diagnostics: [] }
    helperRuntime.diagnostics.push(...(Array.isArray(cardExtensions.remoteAssetDiagnostics) ? cardExtensions.remoteAssetDiagnostics : []))
    let helperWorldbook = null
    if (helperEnabled && str(chat.cardPath) !== '') {
      try {
        if (deferResources) {
          const document = chat.openingWorldbookSnapshot.document
          helperWorldbook = document === null ? null : {
            name: worldBookDisplayName(document), resourceAccess: sessionResources.issue(chat.id, resourceRevision, 'worldbook')
          }
        } else if (options.worldBook !== undefined) {
          // The start path already holds this projection; re-resolving the same
          // document here would copy and inspect it again for nothing.
          helperWorldbook = options.worldBook === null ? null : projectTavernHelperWorldbook(options.worldBook.view)
        } else {
          const record = await worldBooks.bound(chat.cardPath, card, chat)
          if (record !== null) helperWorldbook = projectTavernHelperWorldbook(record.view)
        }
      } catch (error) {
        helperRuntime.diagnostics.push({ scriptId: '', name: '世界书', status: 'unavailable', message: str(error && error.message || error) })
      }
    }
    const messageCount = Array.isArray(chat.messages) ? chat.messages.length : 0
    const skeletonUntil = options.skeletonUntil === true
      ? Math.max(0, messageCount - HELPER_MESSAGE_COLD_WINDOW)
      : (Number.isSafeInteger(options.skeletonUntil) ? Math.max(0, options.skeletonUntil) : 0)
    const helperContext = helperEnabled
      ? await requestPerformance.stage('helperMessagesProjection', () => projectTavernHelperContext(chat, { skeletonUntil, indexed:true }))
      : null
    const rollbackEvidence = sessionDebugEvidence(chat.sessionId, true)
    const rollbackFields = rollbackViewFields(chat, rollbackEvidence, options.inputChanges)
    const transcriptPlan = await requestPerformance.stage('transcriptRowPlan', async () => transcriptPlanFields(chat, rollbackEvidence, rollbackFields.replacingDshTurns, rollbackFields.keptInputTurns))
    return {
      chatId: chat.id,
      contextCompaction: chat.contextCompaction || null,
      mode: chat.mode || 'story',
      requestMode: chat.requestMode === 'sillytavern' ? 'sillytavern' : 'dsh',
      playerName: str(chat.macroState && chat.macroState.userName).trim() || '你',
      userProfile: {
        enabled: chat.userProfileEnabled === true,
        revision: Math.max(0, Number(chat.userProfileRevision) || 0)
      },
      bypassPlan: null,
      runtimePreset: activePresetSnapshot === null ? null : { id: activePresetSnapshot.presetPath, name: activePresetSnapshot.presetName },
      card: deferResources ? {path: str(card.path || chat.cardPath), name: card.name, tags: card.tags || []} : cardViewOf(card, chat),
      ...(deferResources ? {cardResourceAccess:sessionResources.issue(chat.id, resourceRevision, 'card')} : {}),
      // The workbench card a tool wrote during a native turn; plugins tell a saved card
      // from a plain question by its turn. Null for play chats.
      cardSave: cardSaveViewOf(chat),
      cardUpdate,
      // The automatic card reload, shown until the next turn.
      cardAutoReload: chat.cardAutoReload && Number(chat.cardAutoReload.turn) === latestStoryTurn ? { at: chat.cardAutoReload.at } : null,
      statusBarPlacement: runtimeSettings.defaultPlaySettings?.statusBarPlacement === 'body' ? 'body' : 'sidebar',
      posture: chat.posture || '',
      postureEnabled: chat.backgroundTasks?.posture !== false,
      styleReference: latestStyleReference(chat),
      styleReferenceEnabled: chat.backgroundTasks?.styleReference === true && (chat.mode || 'story') === 'story',
      ledger: readLedger(chat.ledger),
      ledgerTask: projectLedgerTask(chat),
      characterDesigns: projectCharacterDesignDocument(chat.characterDesignDocument),
      characterDesignTask: projectCharacterDesignTask(chat),
      phoneChat: projectPhoneChat(chat, card),
      guides: Array.isArray(chat.guides) ? chat.guides : [],
      debugTurns,
      latestAssistantMessageId,
      forkTurnsByMessageId,
      latestAssistantTurn: latestStoryTurn,
      inputSources,
      inputTemplateDisplays,
      userInputEdits: userInputEditsOf(chat),
      editableUserInputTurns: editableUserInputTurnsForChat(chat),
      latestCommittedUserTurn: latestCommittedUserTurnForChat(chat),
      failedUserInputTurns: failedUserInputTurnsForChat(chat),
      ...rollbackFields,
      ...transcriptPlan,
      presentation: null,
      replyProjections: replyDisplay.projections,
      // tavernStatusView duplicated tavernStatusViews[0] in every read; clients use the list.
      tavernStatusViews: replyDisplay.statusViews || [],
      mvuReceipts: mvuReceiptsOf(chat),
      // Replies whose text is a 精修 (manual or automatic), by turn, for the small mark under them;
      // automatic ones (body.polish, they keep polishedFrom) are told apart in its title.
      polishedTurns: (Array.isArray(chat.messages) ? chat.messages : []).filter(message => message?.role === 'assistant' && (message.polished || message.polishedFrom)).map(message => Number(message.turn) || 0),
      autoPolishedTurns: (Array.isArray(chat.messages) ? chat.messages : []).filter(message => message?.role === 'assistant' && message.polishedFrom).map(message => Number(message.turn) || 0),
      tavernHelper: helperContext ? { ...helperContext, playerName: str(chat.macroState?.userName).trim() || '你', characterName: str(card?.name || chat.cardName), character: {name:str(card?.name || chat.cardName), path:str(chat.cardPath)}, openingHost: sessionOpeningDescriptor(chat, card), worldbook: helperWorldbook, globalVariables: await readPromptTemplateGlobalVariables(), characterVariables: cardExtensions.variables || {}, compatibilityCapabilities: TAVERN_COMPATIBILITY_CAPABILITIES, extensionSettings, regexScripts: { global: cardExtensions.globalRegexScripts || [], preset: applyRegexOverrides(activePresetSnapshot?.regexScripts || [], chat.regexOverrides && chat.regexOverrides.preset, 'preset'), character: cardExtensions.characterRegexScripts || [] } } : null,
      tavernMvuRuntime: chat.mvu && chat.mvu.enabled === true ? {
        owner: chat.mvu.owner === 'official' ? 'official' : 'legacy',
        commit: OFFICIAL_MVU_VERSION.commit,
        assetUrl: OFFICIAL_MVU_VERSION.assetUrl
      } : null,
      tavernHelperScripts: helperRuntime.scripts,
      tavernHelperScriptDiagnostics: helperRuntime.diagnostics,
      tavernRemoteAssetPins: Array.isArray(cardExtensions.remoteAssetPins) ? cardExtensions.remoteAssetPins : [],
      tavernHelperWorldbook: helperWorldbook,
      tavernRuntimePolicy: { trustedCardMode: runtimeSettings.trustedCardMode, frameSizing: cardExtensions.frameSizing },
      presentationWarnings: (Array.isArray(chat.presentationWarnings) ? chat.presentationWarnings : []).concat(
        chat.importHistory?.rescue ? [rescueHistoryNotice(chat.importHistory.rescue)] : [],
        chat.importHistory?.contextPreparation?.status === 'trimmed'
          ? ['导入记录较长：已保留开头和最近完整轮次，中间 ' + chat.importHistory.contextPreparation.droppedRounds + ' 轮暂不随模型请求发送，历史正文仍可召回。'] : []),
      worldBookError: chat.worldBookError || null,
      foregroundError: chat.foregroundError || null,
      lastWorldBookRecall: chat.lastWorldBookRecall || null,
      activity,
      settleStatus: activity.busy ? 'running' : (activity.phase === 'failed' && activity.role === 'settlement' ? 'error' : 'done'),
      settleError: activity.reason === 'interrupted' ? '后台结算已中断，请重试结算。' : (chat.settleError || null),
      settlementTurn: settlementTurn(chat),
      scriptProgress: scriptProgress,
      updatedAt: chat.updatedAt || 0
    }
  }
  // Derived from the newest messages; every projection (full or incremental) recomputes them,
  // so plugin actions never target a turn from an earlier view.
  function latestTurnFields(chat) {
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    const debugTurns = []
    for (let index = messages.length - 1; index >= 0 && debugTurns.length < 12; index--) {
      const message = messages[index]
      if (!message || message.role !== 'assistant') continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      const source = (str(message.sourceText) || str(message.text)).replace(/\s+/g, ' ').trim()
      debugTurns.push({ turn, preview: source.slice(0, 90), chars: source.length })
    }
    const latestAssistantTurn = Number(debugTurns[0]?.turn) || 0
    const liveSession = sessionStore.get(str(chat.sessionId)) || agentRegistry.get(str(chat.sessionId))?.session
    const latestAssistant = latestAssistantTurn > 0 ? assistantResultForTurn(liveSession, latestAssistantTurn) : null
    return { debugTurns, latestAssistantTurn, latestAssistantMessageId: str(latestAssistant?.event?.data?.message?.id) }
  }
  function replyProjectionsOf(chat) {
    const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
    const projections = []
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]
      if (!message || message.role !== 'assistant') continue
      const displayText = Object.prototype.hasOwnProperty.call(message, 'displayText') ? str(message.displayText) : str(message.text)
      const mode = str(message.displayMode) || 'markdown'
      if (displayText === str(message.text) && mode !== 'html' && mode !== 'rich') continue
      const turn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (turn === 0) continue
      projections.push({
        version: Math.max(1, Number(message.projectionVersion) || 1),
        turn,
        text: displayText,
        mode,
        warnings: Array.isArray(message.projectionWarnings) ? message.projectionWarnings : []
      })
    }
    return projections
  }
  function withLegacyPresentationProjection(chat, projections) {
    const legacy = chat && chat.presentation
    if (!legacy || typeof legacy !== 'object' || str(legacy.html) === '') return Array.isArray(projections) ? projections : []
    const result = Array.isArray(projections) ? projections.slice() : []
    const turn = Math.max(1, Number(legacy.turn) || (legacy.source === 'opening' ? 1 : 0))
    if (result.some(function (projection) { return Number(projection.turn) === turn })) return result
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    let target = null
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message || message.role !== 'assistant' || Object.prototype.hasOwnProperty.call(message, 'sourceText')) continue
      const messageTurn = Math.max(0, Number(message.turn) || (message.greeting === true ? 1 : 0))
      if (messageTurn === turn || (turn > 1 && target === null)) target = message
      if (messageTurn === turn) break
    }
    if (target === null) return result
    const projected = projectRuntimeReply(str(target.text) + '\n\n' + str(legacy.html))
    result.push({
      version: 2,
      turn,
      text: projected.displayText,
      mode: projected.displayMode,
      parts: projected.displayParts,
      warnings: ['旧会话兼容：正文与历史人物卡界面已在原消息位置合并显示。'].concat(projected.warnings)
    })
    return result.sort(function (left, right) { return Number(left.turn) - Number(right.turn) })
  }
  async function scriptPreviewOf(chat) {
    if ((chat.mode || 'story') !== 'script') return null
    const script = await readScript(chat.cardPath)
    if (script === undefined || !Array.isArray(script.chunks)) return null
    return scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'preview' } })
  }
  const sessionStateView = createSessionStateView({
    sharedReceipts: true, sharedMappings: true,
    activity: chat => activityOf(chat),
    evidence: sessionId => sessionDebugEvidence(sessionId, true)
  })
  function mvuReceiptsOf(chat, changes) { return sessionStateView.receipts(chat, changes) }
  function rollbackViewFields(chat, evidence, changes) { return sessionStateView.rollback(chat, evidence, changes) }
  // Derived from live session events, which change without a chat revision (see conversation-fork-targets.js).
  function forkTurnsForChat(chat) {
    const session = sessionStore.get(str(chat?.sessionId)) || agentRegistry.get(str(chat?.sessionId))?.session
    return forkTargetsFromSession(session, chat?.regeneratedDshTurns)
  }
  // The newest player input that actually committed a Chat message. Failed or
  // withdrawn turns keep only an append node in the transcript, so they must not
  // offer in-place editing (their input is recovered with 「撤回这条输入」).
  function latestCommittedUserTurnForChat(chat) {
    const messages = Array.isArray(chat?.messages) ? chat.messages : []
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message || message.role !== 'user' || message.greeting === true) continue
      const reply = messages[index + 1]
      const turn = Number(reply?.native?.turn) || Number(reply?.nativeAnchor?.turn) || Number(message.bodyEdit?.turn) || 0
      if (turn > 0) return turn
    }
    return 0
  }
  // The newest failed turn whose input has not been superseded by a new player
  // message. Its surface is left in place until the player retries, withdraws or
  // sends a new message, so the input stays available for an in-place edit.
  function failedUserInputTurnsForChat(chat) {
    const session = sessionStore.get(str(chat?.sessionId)) || agentRegistry.get(str(chat?.sessionId))?.session
    if (!session) return []
    const events = sessionEvents(session)
    let failed = 0
    let endSeq = 0
    for (const event of events) {
      if (event.type !== 'turn/end' || !isFailedTurnEnd(event.data?.reason?.kind)) continue
      const turn = Number(event.data?.turn) || 0
      if (turn <= failed) continue
      failed = turn
      endSeq = Number(event.seq) || 0
    }
    if (!failed) return []
    if (events.some(event => isNewTurnInput(event) && Number(event.seq) > endSeq)) return []
    const input = inputEventForTurn(session, failed)
    return input && inputKind(input.data) === 'player' ? [failed] : []
  }
  // Player inputs the page may edit: only those still on the model surface. A
  // failed or withdrawn turn is removed from the surface while its append node
  // stays in the transcript, so it must not offer in-place editing.
  function editableUserInputTurnsForChat(chat) {
    const session = sessionStore.get(str(chat?.sessionId)) || agentRegistry.get(str(chat?.sessionId))?.session
    if (!session || !Array.isArray(session.surface?.nodes)) return []
    const events = sessionEvents(session)
    const bySeq = new Map(events.map(event => [Number(event.seq), event]))
    const turnOf = new Map()
    let current = 0
    for (const event of events) {
      if (event.type === 'turn/start') current = Number(event.data?.turn) || 0
      turnOf.set(Number(event.seq), current)
    }
    const turns = new Set()
    for (const seq of session.surface.nodes) {
      const event = bySeq.get(Number(seq))
      if (!event || event.type !== 'user/message' || inputKind(event.data) !== 'player') continue
      turns.add(turnOf.get(Number(seq)) || 0)
      let cursor = event
      for (let guard = 0; guard < 32; guard += 1) {
        const op = cursor.surfaceOp
        if (!op || op.op !== 'replace') break
        const original = bySeq.get(Number(op.startSeq))
        if (!original) break
        turns.add(turnOf.get(Number(op.startSeq)) || 0)
        cursor = original
      }
    }
    return [...turns].filter(turn => turn > 0).sort((left, right) => left - right)
  }
  // The row plan (Wiki「设计：transcript-row-plan」) over what the view holds — the
  // window of floors, or the whole short history — and the log since its first round, as
  // turn-keyed exceptions. The page shows exactly the rows it plans. The log grows every
  // turn without a save change, so every projection, cached or not, plans again; the cost
  // follows the view's floors, never the length of the game.
  function transcriptPlanFields(chat, evidence, replacing, keepInput) {
    const messages = chat.messages
    if (!evidence.loaded || !['story', 'script'].includes(chat.mode || 'story') || !messages || !Number.isSafeInteger(messages.length)) return { transcriptTurns: null, transcriptFrom: null }
    const floors = new Array(messages.length)
    for (let index = 0; index < messages.length; index++) floors[index] = messages[index]
    const plan = planTranscriptWindow({ messages: floors, events: evidence.events, partial: chat.windowRevision !== undefined,
      regeneration: { replacing, inProgress: chat.regenInProgress === true }, keepInput })
    return { transcriptTurns: plan.turns, transcriptFrom: plan.from }
  }
  async function volatileSessionViewFields(chat, activity, changes) {
    const fields = sessionStateView.volatile(chat, activity, changes)
    return { ...fields, statusBarPlacement: (await readTavernSettings()).defaultPlaySettings?.statusBarPlacement === 'body' ? 'body' : 'sidebar', forkTurnsByMessageId: forkTurnsForChat(chat), userInputEdits: userInputEditsOf(chat), editableUserInputTurns: editableUserInputTurnsForChat(chat), latestCommittedUserTurn: latestCommittedUserTurnForChat(chat), failedUserInputTurns: failedUserInputTurnsForChat(chat),
      cardSave: cardSaveViewOf(chat),
      ...transcriptPlanFields(chat, sessionDebugEvidence(chat.sessionId), fields.replacingDshTurns, fields.keptInputTurns) }
  }

  // The card the workbench wrote in a native turn, as a plain read-only fact.
  function cardSaveViewOf(chat) {
    const save = chat && chat.lastCardSave
    if (save === null || typeof save !== 'object') return null
    const turn = Math.max(0, Number(save.turn) || 0)
    const path = str(save.path)
    if (turn === 0 || path === '') return null
    return { turn: turn, path: path, createsCard: save.createsCard === true, changed: save.changed === true }
  }

  async function projectCachedSessionView(chat, previous, activity) {
    const mode = chat.mode || 'story'
    const reused = Object.assign({}, previous, await volatileSessionViewFields(chat, activity, {baseRevision:chat._storageRevision,indices:[],layoutChanged:false}))
    if (mode === 'script') reused.scriptProgress = await scriptProgressOf(chat)
    return reused
  }
  // The volatile fields reset it; every partial projection of a script game recomputes it.
  async function scriptProgressOf(chat) {
    return await requestPerformance.stage('scriptProgress', async () => {
      const script = await readScript(chat.cardPath)
      return script !== undefined && Array.isArray(script.chunks)
        ? scriptContinuity.inspect({ script: script, state: chat.scriptState, request: { kind: 'progress' } })
        : null
    })
  }
  async function projectDirtySessionView(chat, previous, dirtyMessageIndices, activity, {layoutChanged,layoutFrom,changedHeaderFields,runtimeInputChanges} = {}) {
    const card = await readChatCard(chat)
    const mode = chat.mode || 'story'
    const previousMessages = previous.tavernHelper.messages
    const changes = {baseRevision:previous.tavernHelper.stateRevision,indices:[...dirtyMessageIndices],layoutChanged,changedHeaderFields}
    const next = Object.assign({}, previous, await volatileSessionViewFields(chat, activity, changes), {
      posture: chat.posture || '',
      postureEnabled: chat.backgroundTasks?.posture !== false,
      styleReference: latestStyleReference(chat),
      styleReferenceEnabled: chat.backgroundTasks?.styleReference === true && (chat.mode || 'story') === 'story',
      guides: Array.isArray(chat.guides) ? chat.guides : [],
      // Header state a background task rewrites without touching any message.
      ledger: readLedger(chat.ledger),
      ledgerTask: projectLedgerTask(chat),
      characterDesigns: projectCharacterDesignDocument(chat.characterDesignDocument),
      characterDesignTask: projectCharacterDesignTask(chat),
      ...latestTurnFields(chat)
    })
    if (mode === 'script') next.scriptProgress = await scriptProgressOf(chat)
    Object.assign(next,inputFieldsProjection.project(chat,{baseRevision:changes.baseRevision,indices:dirtyMessageIndices,changedHeaderFields,runtimeInputChanges}))
    const helperCore = await requestPerformance.stage('helperMessagesProjection', () => projectTavernHelperContext(chat, {
      previousMessages, previousContext:previous.tavernHelper, indexed:true, layoutChanged, layoutFrom,
      dirtyIndices: dirtyMessageIndices
    }))
    next.tavernHelper = Object.assign({}, previous.tavernHelper, helperCore, {
      openingHost: previous.tavernHelper.openingHost,
      worldbook: previous.tavernHelper.worldbook,
      globalVariables: previous.tavernHelper.globalVariables,
      characterVariables: previous.tavernHelper.characterVariables,
      compatibilityCapabilities: previous.tavernHelper.compatibilityCapabilities,
      extensionSettings: previous.tavernHelper.extensionSettings,
      regexScripts: {
        global: previous.tavernHelper.regexScripts?.global || [],
        preset: applyRegexOverrides(previous.tavernHelper.regexScripts?.preset || [], chat.regexOverrides && chat.regexOverrides.preset, 'preset'),
        character: applyRegexOverrides(previous.tavernHelper.regexScripts?.character || [], chat.regexOverrides && chat.regexOverrides.card, 'card')
      }
    })
    delete next.tavernHelper.messagesPending
    if (mode === 'story' || mode === 'script') {
      let cardExtensions = { regexScripts: [], helperScripts: [] }
      try { cardExtensions = await readCardExtensions(chat.cardPath, chat) || cardExtensions } catch (_error) { cardExtensions = { regexScripts: [], helperScripts: [] } }
      const activePresetSnapshot = groupOfMode(chat.mode) === 'play' && chat.runtimePresetSnapshot && typeof chat.runtimePresetSnapshot === 'object'
        ? chat.runtimePresetSnapshot : null
      next.runtimePreset = activePresetSnapshot === null ? null : { id: activePresetSnapshot.presetPath, name: activePresetSnapshot.presetName }
      const presetRegexScripts = Array.isArray(activePresetSnapshot && activePresetSnapshot.regexScripts) ? activePresetSnapshot.regexScripts : []
      // Rebuild the helper-visible regex list from fresh sources so resetting a
      // conversation override cannot leave the previous (overridden) copy behind.
      if (next.tavernHelper) next.tavernHelper.regexScripts = {
        global: cardExtensions.globalRegexScripts || [],
        preset: applyRegexOverrides(presetRegexScripts, chat.regexOverrides && chat.regexOverrides.preset, 'preset'),
        character: cardExtensions.characterRegexScripts || []
      }
      let replyDisplay = await requestPerformance.stage('historyProjection', () => incrementalReplyView.project(chat, {
        charName: chat.cardName, macroState: chat.macroState,
        regexScripts: composeTavernRegexScripts(cardExtensions, presetRegexScripts, chat.regexOverrides && chat.regexOverrides.preset),
        placement: 2, isMarkdown: true, isEdit: false, depth: 0
      }, { charName: chat.cardName, macroState: chat.macroState, regexScripts: cardExtensions.regexScripts }, {shared:true}))
      const renderChat = {...chat,messages:createScopedMessages(chat.messages.length,[],index=>{const message=chat.messages[index];return message.variables ? message : {...message,variables:helperCore.messages[index]?.swipes_data || []}})}
      replyDisplay = await liveCardUpdate.project(renderChat, card, replyDisplay, {charName:chat.cardName,macroState:chat.macroState,regexScripts:cardExtensions.regexScripts})
      replyDisplay.projections = withLegacyPresentationProjection(chat, replyDisplay.projections)
      next.replyProjections = replyDisplay.projections
      next.tavernStatusViews = replyDisplay.statusViews || []
    }
    return next
  }
  async function projectFullSessionView(chat, { windowHelperMessages = false, inputChanges, deferResources } = {}) {
    const mode = chat.mode || 'story', isCard = mode === 'card', cardPath = str(chat.cardPath)
    let card = null, cardReadError = null
    try { card = isCard && cardPath === '' ? null : await requestPerformance.stage('readCard', () => readChatCard(chat)) }
    catch (error) {
      if (!isCard) throw error
      cardReadError = '人物卡暂时无法读取，请在工作台校验并修复：' + chat.cardPath
      card = { name: chat.cardName || chat.cardPath }
    }
    const result = await requestPerformance.stage('projectView', () => view(chat, card, true, {
      skeletonUntil: windowHelperMessages === true, inputChanges, deferResources
    }))
    if (cardReadError) result.cardReadError = cardReadError
    if (isCard) result.workspace = workspaceViewOf(chat)
    if (mode === 'script') result.scriptPreview = await requestPerformance.stage('scriptPreview', () => scriptPreviewOf(chat))
    return result
  }
  async function projectOpeningWindow(window, options = {}) {
    // Disable revision caches for this partial input. It must never replace a
    // full history projection or be used as an editable Chat baseline.
    // The undo point still compares against the window's real revision.
    const chat={...window.chat,_storageRevision:undefined,windowRevision:window.revision}
    const card=await readChatCard(chat)
    const result=await view(chat,card,false,{openingWindow:true,deferResources:options.deferResources,resourceRevision:window.revision})
    result.historyWindow={onDemand:true,from:window.from,to:window.to,messageCount:window.messageCount,revision:window.revision}
    if(result.tavernHelper){
      const helper=result.tavernHelper
      // Transport only loaded rows; the client adapts absolute ids at the
      // legacy synchronous Helper boundary without sending N placeholders.
      const messages=helper.messages.map((row,index)=>({...row,message_id:window.from+index}))
      result.tavernHelper={...helper,stateRevision:window.revision,messages,
        turnMessageIds:Object.fromEntries(Object.entries(helper.turnMessageIds).map(([turn,index])=>[turn,window.from+index])),
        historyAccess:helperHistoryAccess.issue({chatId:chat.id,revision:window.revision,messageCount:window.messageCount})}
    }
    return result
  }

  return Object.freeze({ view, status: chat => sessionStateView.status(chat), stats: () => incrementalReplyView.stats(),
    project: Object.freeze({ full: projectFullSessionView, cached: projectCachedSessionView, dirty: projectDirtySessionView, opening: projectOpeningWindow }) })
}
