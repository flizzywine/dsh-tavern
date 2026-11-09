import { applyOpeningCommand } from './opening-command.js'
import { ensureOpeningTurn, releaseOpeningTurn, sessionEvents, appendSessionEvent } from './session-events.js'
import { nativeOpeningMessageId } from './native-opening.js'
import { cardOpeningChoices, resolveCardOpening } from './card-openings.js'
import { projectAgentContent, projectOpeningCommit } from './runtime-content-projection.js'
import { OFFICIAL_MVU_VERSION } from './official-mvu-assets.js'
import { createScriptContinuity } from './script-continuity.js'
import { normalizeBackgroundModel } from './background-model-selection.js'
import { normalizeConfiguredBackgroundTasks, normalizePlayDefaults } from './tavern-settings.js'
import { ensureSessionSeedTrajectory } from './session-seed-trajectory.js'
import { defaultUserPreferenceProfile } from './user-preference-profile.js'
import { replyProse, writeReplyProse } from './reply-prose.js'
import { projectReplyLayers } from './reply-presentation.js'
import { composeTavernRegexScripts } from './card-extension-reading.js'
import { assertOpeningIdle, findSessionOpening, renameOpeningPlayerSlots, replaceSessionOpening, selectSessionOpening, sessionOpeningDescriptor } from './session-opening.js'

function str(value) { return value === undefined || value === null ? '' : String(value) }
function groupOfMode(mode) { return !mode || mode === 'story' || mode === 'script' ? 'play' : 'card' }

/** Owns initialization, repeat-entry and opening recovery; never generates a model turn. */
export function createConversationInitialization(options) {
  const { cards, chats, snapshots, native, presets, settings, emptyCardWorkspace, present, timeline } = options
  if (!timeline || typeof timeline.apply !== 'function') throw new Error('Conversation Initialization 缺少 Story Timeline')
  const trace = options.trace || { stage: (_name, run) => run() }
  const id = options.id
  const now = options.now || Date.now
  const logger = options.logger || console
  const scriptContinuity = createScriptContinuity()
  const pending = new Map()

  function serialize(sessionId, work) {
    const key = typeof sessionId === 'string' ? sessionId : ''
    if (!key) return work()
    const previous = pending.get(key) || Promise.resolve()
    const operation = previous.catch(function () {}).then(work)
    pending.set(key, operation)
    return operation.finally(function () { if (pending.get(key) === operation) pending.delete(key) })
  }

  function newChat(card, mode) {
    const chatMode = mode === 'card' ? 'card' : (mode === 'script' ? 'script' : 'story')
    const hasCard = card !== null && card !== undefined && str(card.path) !== ''
    const chat = {
      id: id('chat'),
      cardPath: hasCard ? card.path : '',
      cardName: hasCard ? card.name : '卡片工作台',
      mode: chatMode,
      requestMode: 'dsh',
      scriptState: chatMode === 'script' ? { cursor: 0, recalledChunkIds: [], prepared: null, lastReference: null, totalChunks: 0, title: '', scriptVersion: 0 } : null,
      workspace: chatMode === 'card' ? emptyCardWorkspace() : null,
      messages: [],
      posture: '',
      ledger: null,
      sessionId: '',
      guides: [],
      bypassPlanId: '',
      runtimePresetSnapshot: null,
      cardContextSnapshot: '',
      cardContextSnapshotVersion: 0,
      userProfileEnabled: false,
      userProfileRevision: 0,
      userProfileContextSnapshot: '',
      webSearchEnabled: false,
      backgroundModelSelection: null,
      macroState: { userName: '你', local: {}, global: {} },
      settleStatus: 'idle',
      settleError: null,
      lastSettle: null,
      foregroundError: null,
      preparedWorldBookContext: '',
      preparedWorldBook: null,
      nativeCommits: {},
      suppressedDshTurns: [],
      regeneratedDshTurns: {},
      pendingCardChanges: {},
      createdAt: now(),
      updatedAt: now()
    }
    return timeline.apply({ chat, intent: { kind: 'ensure' } }).chat
  }

  async function playPresetSnapshot() {
    const prepared = typeof presets.claimPreparedFullSnapshot === 'function'
      ? await presets.claimPreparedFullSnapshot()
      : undefined
    return prepared === undefined ? await presets.fullSnapshot() : prepared
  }

  async function initialize({ cardPath, sessionId, mode, openingId, userName, requestMode, preparation, cardTask, importDraft = false }) {
    if (requestMode === 'sillytavern') throw new Error('silly 模式已停用')
    const requestedMode = mode === 'card' || mode === 'revision' || mode === 'extract' ? 'card' : (mode === 'script' ? 'script' : (mode === 'story' ? 'story' : null))
    const withoutCard = str(cardPath) === '' && requestedMode === 'card'
    // These inputs only depend on the requested path, not on one another. Starting
    // them together matters on mobile storage, where serial reads dominate creation.
    const cardRead = withoutCard ? Promise.resolve(null) : trace.stage('card', () => cards.read(cardPath))
    // Extension discovery reads the same workspace. Let the card read finish any
    // legacy migration first instead of racing a second migration of the same file.
    const extensionsRead = requestedMode === 'card' ? Promise.resolve(null)
      : cardRead.then(() => trace.stage('extensions', () => cards.extensions(cardPath)))
    const [currentSettings, card, cardDefaults, script, openingExtensions] = await Promise.all([
      trace.stage('settings', () => settings()),
      cardRead,
      !withoutCard && typeof cards.startDefaults === 'function'
        ? trace.stage('cardDefaults', () => cards.startDefaults(cardPath).catch(() => null)) : Promise.resolve(null),
      withoutCard ? Promise.resolve(undefined) : trace.stage('script', () => cards.script(cardPath)),
      extensionsRead
    ])
    if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    let defaults = normalizePlayDefaults(currentSettings.defaultPlaySettings)
    // A DSH card may suggest a preset and a few settings for its new games; the player's global defaults fill the rest.
    if (cardDefaults?.settings) defaults = normalizePlayDefaults({ ...defaults, ...cardDefaults.settings, backgroundTasks: { ...defaults.backgroundTasks, ...(cardDefaults.settings.backgroundTasks || {}) } })
    // 游玩模式内部仍是 story/script 两类：人物卡已绑定剧本时必须走剧本（script）。
    const hasScript = script !== undefined && Array.isArray(script.chunks) && script.chunks.length > 0
    let chatMode = requestedMode
    if (chatMode === null || mode === 'play') chatMode = hasScript ? 'script' : 'story'
    if (chatMode === 'script' && !hasScript) throw new Error('该人物卡尚未绑定剧本文件，请先在卡片模式绑定剧本')
    if (chatMode === 'story' && hasScript) chatMode = 'script'
    if (typeof sessionId === 'string' && sessionId !== '') {
      const current = await trace.stage('session', () => chats.resolve(sessionId))
      if (current?.requestMode === 'sillytavern') throw new Error('silly 模式已停用')
      // 同一大模式（游玩/卡片）内复用当前会话；旧的自由故事会话不会被强行切换成剧本。
      if (current !== undefined && current.cardPath === str(cardPath) && groupOfMode(current.mode) === groupOfMode(chatMode)) {
        return await trace.stage('reopen', async () => {
          if (groupOfMode(current.mode) === 'play') await snapshots.ensure(current, card)
          await appendNativeOpening(sessionId, current, card, undefined, true)
          return await present(await syncOpeningSwitch(current), card)
        })
      }
    }
    const scriptStart = groupOfMode(chatMode) === 'play' ? preparation?.startCommand?.scriptStart : undefined
    if (scriptStart?.mode === 'story') chatMode = 'story'
    if (scriptStart?.chunk !== undefined && (!hasScript || scriptStart.chunk > script.chunks.length)) {
      throw new Error('开局剧本块不存在，请重新选择起点')
    }
    // A submitted form owns its name; the picker may still carry the preview default.
    const openingUserName = groupOfMode(chatMode) === 'play' ? preparation?.startCommand?.userName : undefined
    const macroState = { userName: str(openingUserName ?? userName).trim().slice(0, 80) || defaults.playerName, local: {}, global: {} }
    const runtimePresetSnapshot = groupOfMode(chatMode) !== 'play' ? null
      : cardDefaults?.presetPath ? await trace.stage('preset', () => presets.fullSnapshot(cardDefaults.presetPath).catch(() => playPresetSnapshot())) : await trace.stage('preset', () => playPresetSnapshot())
    // The card workbench opens empty: no greeting is shown or sent to the model.
    let openingSourceText = chatMode === 'card' ? '' : resolveCardOpening(card, openingId)
    // Card workbenches skip opening extensions in the initial read above.
    const openingChoices = chatMode === 'card' ? [] : cardOpeningChoices(card)
    const selectedOpeningIndex = str(openingId) === '' ? 0 : Math.max(0, openingChoices.findIndex(function (choice) { return choice.id === str(openingId) }))
    const usesMvu = chatMode !== 'card' && (
      (Array.isArray(openingExtensions && openingExtensions.mvuResources) && openingExtensions.mvuResources.some(function (item) { return item.enabled !== false }))
      || openingChoices.some(function (choice) { return /<(?:initvar|json_?patch)>|_\.(?:set|insert|assign|remove|unset|delete|add)\(/i.test(choice.text) })
    )
    if (preparation?.openingMessages && groupOfMode(chatMode) === 'play') {
      for (const choice of openingChoices) {
        const preparedText = preparation.openingMessages[choice.id];
        if (typeof preparedText === 'string') choice.text = preparedText;
      }
      openingSourceText = openingChoices[selectedOpeningIndex]?.text ?? openingSourceText;
    }
    const openingRegexScripts = (Array.isArray(openingExtensions && openingExtensions.regexScripts) ? openingExtensions.regexScripts : []).concat(
      Array.isArray(runtimePresetSnapshot && runtimePresetSnapshot.regexScripts) ? runtimePresetSnapshot.regexScripts : []
    )
    const openingProjection = chatMode === 'card'
      ? { agentText: openingSourceText, renderedText: openingSourceText, sessionText: openingSourceText, displayText: openingSourceText, displayMode: 'markdown', displayParts: [{ kind: 'markdown', text: openingSourceText }], warnings: [], macroState }
      : projectOpeningCommit(openingSourceText, {
          charName: str(card.name),
          macroState,
          regexScripts: openingRegexScripts,
          regexPlacement: 2,
          isEdit: false,
          depth: 0
        })
    macroState.userName = openingProjection.macroState.userName
    macroState.local = openingProjection.macroState.local
    macroState.global = openingProjection.macroState.global
    // a card with an opening form replaces its greeting:
    // nothing is shown or sent. The greeting floor stays only to own the opening variables; its one
    // blank character keeps the native opening structure, which the chat and provider requests skip.
    const formOpening = Boolean(openingExtensions?.openingSetup) && openingProjection.sessionText !== ''
    // Keep an anchor in the DSH transcript for a selectable blank greeting.
    const greeting = formOpening || (openingChoices.length > 1 && openingProjection.sessionText === '')
      ? '\u3000' : openingProjection.sessionText
    // connectWorkspace 返回时，Agent 注册偶尔仍在异步完成。先等到原生会话可写，
    // 再落盘 Tavern 对话，避免失败时留下只有映射、没有原生开场白的半初始化记录。
    const openingTarget = typeof sessionId === 'string' && sessionId !== '' ? await trace.stage('waitSession', () => native.wait(sessionId)) : undefined
    const chat = newChat(card, chatMode || 'story')
    chat.bypassPlanId = runtimePresetSnapshot && runtimePresetSnapshot.planId || ''
    chat.runtimePresetSnapshot = runtimePresetSnapshot
    chat.runtimePresetPath = str(runtimePresetSnapshot && runtimePresetSnapshot.presetPath)
    chat.macroState = macroState
    // Card-bound card sessions, including the edit task, keep the card Agent persona
    // and receive the foreground card + constant-worldbook snapshot, frozen at start.
    // Play sessions keep no world book copy: they read the library, so an edit to
    // the book or the card takes effect in games that are already running.
    // Sessions created by the retired edit experiment keep their cardEditContext.
    if (chatMode === 'card' && card !== null) chat.cardReferenceContext = { version: 1 }
    // The sidebar setting is the sole opt-in; opening previews and legacy clients cannot override it.
    const selectedProfile = options.userPreferenceProfile
      ? await options.userPreferenceProfile.read()
      : null
    const profile = await defaultUserPreferenceProfile(options.userPreferenceProfile, selectedProfile)
    if (chat.mode === 'card') chat.userProfileManagementId = selectedProfile?.profileId || 'default'
    chat.userProfileId = profile?.profileId || 'default'
    chat.userProfileEnabled = profile?.hasConfirmed === true && profile.defaultEnabled === true
    chat.webSearchEnabled = groupOfMode(chat.mode) === 'play' && defaults.webSearchEnabled
    if (groupOfMode(chat.mode) === 'play') chat.worldbookStrategy = defaults.worldbookStrategy
    chat.conversationFeaturesVersion = 1
    chat.backgroundModelSelection = groupOfMode(chat.mode) === 'play' ? normalizeBackgroundModel(currentSettings.defaultBackgroundModel) : null
    chat.disabledWritingSkills = groupOfMode(chat.mode) === 'play' ? [...(currentSettings.defaultDisabledWritingSkills || [])] : []
    chat.backgroundConfigVersion = 1
    chat.backgroundTasks = normalizeConfiguredBackgroundTasks(groupOfMode(chat.mode) === 'play' ? defaults.backgroundTasks : {})
    chat.mvu = usesMvu ? {
      enabled: true,
      owner: 'official',
      runtime: 'magvarupdate',
      upstreamCommit: OFFICIAL_MVU_VERSION.commit,
      diagnostics: [],
      openingInitialization: {
        version: 2,
        status: 'pending'
      }
    } : { enabled: false }
    // The opening draft already projected this book; rebuilding the prefix from
    // that projection avoids a second read and inspect of the same document.
    // New games keep no copy: they follow the library, so an edit takes effect.
    const preparedBook = preparation && groupOfMode(chatMode) === 'play'
      ? (preparation.worldbook || null)
      : undefined
    await trace.stage('snapshot', () => snapshots.prepare(chat, card, preparedBook))
    chat.openingText = greeting
    chat.presentationWarnings = openingProjection.warnings
    if (chat.mode === 'script') {
      chat.scriptState = scriptContinuity.startAligned(script, greeting,
        scriptStart?.chunk !== undefined ? scriptStart.chunk - 1 : card.script_start)
      chat.scriptState = scriptContinuity.transition({ script, state: chat.scriptState,
        event: { kind: 'set-chunk-size', chunkSize: currentSettings.scriptChunkSize || 500 } }).state
    }
    if (typeof sessionId === 'string') chat.sessionId = sessionId
    if (greeting !== '') chat.messages.push(Object.assign({
      role: 'assistant',
      ...replyProse(formOpening ? greeting : openingSourceText, formOpening ? { ...openingProjection, projectionText: greeting, renderedText: greeting, sessionText: greeting, displayText: greeting, displayMode: 'markdown' } : openingProjection),
      stagePageVersion: 2,
      ts: now(),
      greeting: true,
      ...(!formOpening && openingChoices[selectedOpeningIndex] ? { openingChoiceId: openingChoices[selectedOpeningIndex].id } : {}),
      turn: 1
    }, usesMvu !== true ? {} : {
      swipeId: selectedOpeningIndex,
      swipes: openingChoices.map(function (choice) { return choice.text }),
      variables: openingChoices.map(function () { return {} }),
      mvu: {
        modified: false,
        diagnostics: [],
        events: []
      }
    }))
    if (preparation && groupOfMode(chatMode) === 'play') {
      chat.variables = structuredClone(preparation.variables || {});
      const opening = chat.messages.find(message => message.greeting);
      if (usesMvu && opening) {
        if (preparation.openingVariables) {
          opening.variables = openingChoices.map(choice => structuredClone(preparation.openingVariables[choice.id] || {}));
        }
        if (preparation.messageVariables) opening.variables[opening.swipeId || 0] = structuredClone(preparation.messageVariables);
        // Preserve completion only when every opening carries real MVU data.
        if (opening.variables.length && opening.variables.every(value => value && typeof value === 'object' && !Array.isArray(value) && value.stat_data !== undefined && value.schema !== undefined)) {
          chat.mvu.openingInitialization = { version: 2, status: 'complete', completedAt: Date.now() };
        }
      }
    }
    if (preparation && groupOfMode(chatMode) === 'play') {
      // Chat data a wizard saved before the first turn belongs to the new game.
      const opening = chat.messages.find(message => message.greeting)
      if (opening && preparation.openingPluginData) opening.tavernPluginData = structuredClone(preparation.openingPluginData)
      if (opening && preparation.messageVariables && !usesMvu) {
        if (!Array.isArray(opening.variables)) opening.variables = []
        opening.variables[opening.swipeId || 0] = structuredClone(preparation.messageVariables)
      }
      if (preparation.chatPluginMetadata) chat.tavernPluginMetadata = structuredClone(preparation.chatPluginMetadata)
      if (Array.isArray(preparation.tavernScriptPrompts) && preparation.tavernScriptPrompts.length) {
        chat.tavernScriptPrompts = structuredClone(preparation.tavernScriptPrompts)
      }
      // Floors created while the game did not exist yet keep their order behind the
      // greeting; the start command's system floor is applied after them.
      for (const row of preparation.preparedMessages || []) chat.messages.push(structuredClone(row))
      // The opening floor does not exist yet — the host sends it right after the
      // game is created — so keep what a wizard wrote for it until then.
      if (preparation.openingMessageVariables && Object.keys(preparation.openingMessageVariables).length) {
        chat.pendingOpeningMessageVariables = structuredClone(preparation.openingMessageVariables)
      }
    }
    if (preparation && groupOfMode(chatMode) === 'play') applyOpeningCommand(chat, preparation.startCommand, preparation.messageVariables, now)
    delete chat.sceneOpeningWorldbook
    const hasSession = typeof sessionId === 'string' && sessionId !== ''
    if (importDraft) {
      chat.messages = []
      chat.openingText = ''
      delete chat.sceneOpeningWorldbook
      return chat
    }
    // The workbench default follows the foreground default unless set on its own.
    const group = groupOfMode(chat.mode)
    const defaultModel = group === 'play' ? currentSettings.defaultForegroundModel
      : group === 'card' ? currentSettings.defaultWorkbenchModel || currentSettings.defaultForegroundModel : null
    if (openingTarget && defaultModel) await trace.stage('selectModel', () => native.selectModel(openingTarget, defaultModel))
    await trace.stage('publish', () => chats.publish(chat))
    if (hasSession) await trace.stage('nativeAppend', () => appendNativeOpening(sessionId, chat, card, openingTarget))
    // Match the client's first getSession resource contract. The startChat view
    // can then seed Helper iframes without a second RPC just for resource handles.
    return await trace.stage('present', () => present(chat, card, preparedBook === undefined
      ? { deferResources: true } : { worldBook: preparedBook, freshSnapshot: true, deferResources: true }))
  }


  function openingText(chat, card) {
    if ((chat.mode || 'story') === 'card') return ''
    if (typeof chat.openingText === 'string') return chat.openingText
    const greeting = Array.isArray(chat.messages) ? chat.messages.find(message => message && message.greeting === true && typeof message.text === 'string') : undefined
    if (greeting !== undefined) return greeting.text
    const projection = projectAgentContent(card.first_mes, { charName: str(card && card.name), macroState: chat.macroState || {} })
    Object.assign(chat.macroState || (chat.macroState = {}), projection.macroState)
    return projection.renderedText
  }

  function openingId(chat) { return nativeOpeningMessageId(chat.id) }

  function appendOpeningEvents(session, chat, text, recovering) {
    // DSH adds a seed boundary on restore; it is not part of the opening turn.
    const openingEvents = () => sessionEvents(session).filter(event => event.type !== 'session/end-seed')
    // The reserved opening turn/step was opened with the system head on V3+;
    // a legacy archive without that head opens it here, before the greeting.
    ensureOpeningTurn(session)
    const events = openingEvents()
    const messageId = openingId(chat)
    const stages = [
      ['assistant/message', { turn: 1, step: 1, message: {
        id: messageId,
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'dsh-tavern', model: 'character-card' }
      } }, { surfaceOp: 'append', sourceEventSeqs: [] }],
      ['step/end', { turn: 1, step: 1 }],
      ['turn/end', { turn: 1, reason: { kind: 'completed' } }]
    ]
    let messageIndex = events.findIndex(event => event.type === 'assistant/message' && event.data?.message?.id === messageId)
    if (messageIndex < 0 && recovering) {
      // Old versions used random UUIDs. Recognize only the exact standalone
      // opening envelope; never infer ownership from ordinary conversation text.
      messageIndex = events.findIndex((event, index) => {
        const message = event.data?.message
        return event.type === 'assistant/message' && event.data.turn === 1 && event.data.step === 1
          && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(str(message?.id)) && message.role === 'assistant'
          && message.source?.kind === 'model' && message.content?.length === 1 && message.content[0].type === 'text' && message.content[0].text === text
          && events[index + 1]?.type === 'step/end' && events[index + 1]?.data.turn === 1
          && events[index + 2]?.type === 'turn/end' && events[index + 2]?.data.turn === 1
      })
    }
    const start = messageIndex >= 0 ? messageIndex : events.length
    for (let index = 0; index < stages.length; index++) {
      const [type, data, intent] = stages[index]
      const existing = openingEvents()[start + index]
      if (existing) {
        if (existing.type !== type || existing.data?.turn !== 1 || (data.step !== undefined && existing.data.step !== 1)) throw new Error('开场白事件不完整且已被其他操作推进，拒绝重复写入')
        continue
      }
      if (intent) appendSessionEvent(session, type, data, intent)
      else appendSessionEvent(session, type, data)
    }
  }

  async function appendNativeOpening(sessionId, chat, card, readyTarget, recovering = false) {
    if (chat.nativeOpeningAppended === true) return
    const text = openingText(chat, card)
    const target = readyTarget || await native.wait(sessionId)
    if (groupOfMode(chat.mode) === 'play' && chat.requestMode !== 'sillytavern') {
      const prefix = await trace.stage('nativeSnapshot', () => snapshots.ensure(chat, card))
      await trace.stage('nativePrefix', () => native.ensurePrefix(target.session, prefix))
      await trace.stage('nativeSeed', () => ensureSessionSeedTrajectory(target.session))
      await trace.stage('nativeFlush', () => native.flush(target.session))
    }
    if (groupOfMode(chat.mode) === 'card') {
      const prefix = await trace.stage('nativeSnapshot', () => snapshots.ensure(chat, card))
      await trace.stage('nativePrefix', () => native.ensurePrefix(target.session, prefix))
      // A card-edit session mirrors the play session's prefix (prompt cache); the plain
      // workbench needs no scripted exchange: its role comes from the system prompt.
      if (chat.cardEditContext?.version === 1) await trace.stage('nativeSeed', () => ensureSessionSeedTrajectory(target.session))
      if (chat.cardEditContext?.version === 1) await trace.stage('nativeCardWorkspace', () => native.ensureCardWorkspace(target.session, chat))
      await trace.stage('nativeFlush', () => native.flush(target.session))
    }
    if (text !== '') {
      if (target.agent === undefined) logger.warn('dsh-tavern: Agent 尚未注册，直接使用已绑定 Session 写入开场白', { sessionId })
      appendOpeningEvents(target.session, chat, text, recovering)
      if (target.agent?.phase?.kind === 'idle') target.agent.phase.lastTurn = Math.max(Number(target.agent.phase.lastTurn) || 0, 1)
      await trace.stage('nativeFlush', () => native.flush(target.session))
    } else {
      // No greeting fills the reserved opening turn, so close it here and publish it as
      // used: the Agent numbers its next turn from the turn it can read, so it continues
      // after the reserved one instead of colliding with a turn left open.
      releaseOpeningTurn(target.session, target.agent)
      await trace.stage('nativeFlush', () => native.flush(target.session))
    }
    // Publish the marker in memory only after durable save succeeds. This is one
    // header field, not another whole-Chat clone/diff on a phone. Legacy adapters
    // retain their original full-write recovery contract.
    if (typeof chats.writeHeader === 'function') {
      const saved = await trace.stage('nativeMarker', () => chats.writeHeader(chat))
      chat.nativeOpeningAppended = true
      if (Number.isSafeInteger(saved?._storageRevision)) chat._storageRevision = saved._storageRevision
      if (Number.isFinite(saved?.updatedAt)) chat.updatedAt = saved.updatedAt
      return
    }
    const draft = Object.assign({}, chat, { nativeOpeningAppended: true })
    const saved = await trace.stage('nativeMarker', () => chats.write(draft, { source: 'opening.native-append' }))
    const committed = saved && typeof saved === 'object' ? saved : draft
    for (const field of Object.keys(chat)) if (!Object.hasOwn(committed, field)) delete chat[field]
    Object.assign(chat, committed)
  }

  async function recover(sessionId) {
    const chat = await chats.resolve(sessionId)
    if (chat === undefined) return null
    const card = (chat.mode || 'story') === 'card' && str(chat.cardPath) === '' ? null : await cards.readChat(chat)
    await appendNativeOpening(sessionId, chat, card, undefined, true)
    const synced = await syncOpeningSwitch(chat)
    return await present(synced, card)
  }

  // Chat is the durable selection. Reopen and first submission can finish an
  // interrupted write to the DSH history using this same operation.
  async function syncOpeningSwitch(chat, target) {
    if (!chat?.nativeOpeningSwitch) return chat
    target ||= await native.wait(chat.sessionId)
    replaceSessionOpening(target.session, chat)
    await native.flush(target.session)
    return await chats.update(chat.id, current => {
      if (!current.nativeOpeningSwitch) return
      delete current.nativeOpeningSwitch
      return current
    }, { source: 'opening.switch-synced', touchUpdatedAt: false }) || chat
  }

  async function switchOpening(sessionId, input) {
    native.assertReplacementAllowed()
    const original = await chats.resolve(sessionId)
    if (!original) throw new Error('找不到游玩对话')
    const target = await native.wait(sessionId)
    assertOpeningIdle(target)
    const chat = await syncOpeningSwitch(original, target)
    const card = await cards.readChat(chat)
    const selection = selectSessionOpening({ ...input, chat, card })
    const lifecycle = Number(chat.tavernHelperLifecycleRevision) || 0
    if (input.expectedOpeningVersion === undefined && input.expectedLifecycleRevision !== lifecycle) throw new Error('开场白已变化，请重新选择')
    if (selection.current) return { selectedIndex: input.swipeId, lifecycleRevision: lifecycle, openingVersion: sessionOpeningDescriptor(chat, card).version }
    const [extensions, script] = await Promise.all([
      cards.extensions(chat.cardPath, chat),
      chat.mode === 'script' ? cards.script(chat.cardPath) : null
    ])
    if (extensions?.openingSetup) throw new Error('此卡的开局表单需要在开局时选择')
    const saved = await chats.update(chat.id, current => {
      assertOpeningIdle(target)
      if ((Number(current.tavernHelperLifecycleRevision) || 0) !== lifecycle) throw new Error('开局状态已变化，请重新选择')
      selectSessionOpening({ ...input, chat: current, card })
      const nativeGreeting = findSessionOpening(target.session, current)
      if (!nativeGreeting) throw new Error('找不到本局开场白的原生消息')
      const projection = projectOpeningCommit(selection.text, {
        charName: card.name,
        macroState: { userName: current.macroState.userName, local: {}, global: {} },
        regexScripts: composeTavernRegexScripts(extensions, current.runtimePresetSnapshot?.regexScripts, current.regexOverrides?.preset),
        regexPlacement: 2, isEdit: false, depth: 0
      })
      const choices = cardOpeningChoices(card)
      const row = current.messages[0]
      const greeting = {
        ...replyProse(selection.text, projection),
        role: 'assistant', greeting: true, turn: 1, ts: row.ts, stagePageVersion: row.stagePageVersion,
        openingChoiceId: selection.id, openingSelectionRevision: lifecycle + 1
      }
      if (row.messageUid) greeting.messageUid = row.messageUid
      if (current.mvu?.enabled) {
        greeting.swipes = choices.map(choice => choice.text)
        greeting.swipeId = choices.findIndex(choice => choice.id === selection.id)
        greeting.variables = choices.map(() => ({}))
        greeting.mvu = { modified: false, diagnostics: [], events: [] }
        current.mvu = { ...current.mvu, diagnostics: [], openingInitialization: { version: 2, status: 'pending' } }
      }
      current.messages = [greeting]
      current.openingText = projection.sessionText || '\u3000'
      current.macroState = projection.macroState
      current.presentationWarnings = projection.warnings
      current.variables = {}
      delete current.tavernPluginMetadata
      delete current.tavernScriptPrompts
      if (script) {
        const chunkSize = current.scriptState?.chunkSize
        current.scriptState = scriptContinuity.startAligned(script, projection.sessionText, card.script_start)
        if (chunkSize !== undefined) current.scriptState = scriptContinuity.transition({
          script, state: current.scriptState, event: { kind: 'set-chunk-size', chunkSize }
        }).state
      }
      current.tavernHelperLifecycleRevision = lifecycle + 1
      current.nativeOpeningSwitch = { messageId: nativeGreeting.data.message.id }
      return current
    }, { source: 'opening.switch' })
    await syncOpeningSwitch(saved, target)
    return { selectedIndex: input.swipeId, lifecycleRevision: lifecycle + 1, openingVersion: sessionOpeningDescriptor(saved, card).version }
  }

  async function setPlayerName(sessionId, userName) {
    let chat = await chats.resolve(sessionId)
    if (!chat) throw new Error('当前会话没有绑定人物卡')
    if (chat.mode === 'card') throw new Error('卡片工作台不使用玩家称呼')
    chat = await syncOpeningSwitch(chat)
    const name = str(userName).trim().slice(0, 80) || '你'
    const opening = chat.messages[0]
    const previousName = str(chat.macroState?.userName) || '你'
    const projectionText = renameOpeningPlayerSlots(opening, { previousName, playerName: name, charName: str(chat.cardName) })
    const changed = projectionText !== null && projectionText !== opening.projectionText
    const extensions = changed ? await cards.extensions(chat.cardPath, chat) : null
    const target = changed && chat.nativeOpeningAppended ? await native.wait(sessionId) : null
    const saved = await chats.update(chat.id, current => {
      if (changed) {
        const row = current.messages[0]
        if (!row?.greeting || row.sourceText !== opening.sourceText || row.projectionText !== opening.projectionText) {
          throw new Error('开场白已变化，请重新保存玩家称呼')
        }
        if (target?.agent?.phase?.kind === 'running' || current.regenInProgress) throw new Error('请等当前生成结束后再修改玩家称呼')
        const projection = projectReplyLayers(row.sourceText, {
          projectionText, charName: current.cardName, macroState: { userName: name },
          regexScripts: composeTavernRegexScripts(extensions, current.runtimePresetSnapshot?.regexScripts, current.regexOverrides?.preset),
          placement: 2, isEdit: false, depth: 0
        })
        const nativeGreeting = target && findSessionOpening(target.session, current)
        if (nativeGreeting && projection.sessionText !== current.openingText) {
          native.assertReplacementAllowed()
          current.nativeOpeningSwitch = { messageId: nativeGreeting.data.message.id }
        }
        current.openingText = projection.sessionText
        writeReplyProse(row, row.sourceText, projection)
        delete row.displayRuntime
        if (row.tavernPluginData) {
          delete row.tavernPluginData.template_display
          delete row.tavernPluginData.template_rendered
        }
      }
      current.macroState = { local: {}, global: {}, ...current.macroState, userName: name }
      return current
    }, { source: 'player-name.set' })
    await syncOpeningSwitch(saved, target)
    return name
  }

  return Object.freeze({
    start: input => serialize(input.sessionId, () => initialize(input)),
    prepareImport: input => serialize(input.sessionId, () => initialize({ ...input, mode: 'play', requestMode: 'dsh', importDraft: true })),
    ensureOpening: sessionId => serialize(sessionId, () => recover(sessionId)),
    switchOpening: (sessionId, input) => serialize(sessionId, () => switchOpening(sessionId, input)),
    setPlayerName: (sessionId, userName) => serialize(sessionId, () => setPlayerName(sessionId, userName)),
    finishOpeningSwitch: sessionId => serialize(sessionId, async () => {
      const chat = await chats.openingSwitchState(sessionId)
      if (chat?.nativeOpeningSwitch) await syncOpeningSwitch(chat)
    })
  })
}
