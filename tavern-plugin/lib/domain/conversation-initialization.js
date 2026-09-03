import { createHash } from 'node:crypto'
import { cardOpeningChoices, resolveCardOpening } from './card-openings.js'
import { projectAgentContent, projectOpeningCommit } from './runtime-content-projection.js'
import { OFFICIAL_MVU_VERSION } from './official-mvu-assets.js'
import { createScriptContinuity } from './script-continuity.js'
import { bindSceneWorldbook } from './scene-worldbook.js'
import { snapshotBackgroundModel } from './background-model-selection.js'

function str(value) { return value === undefined || value === null ? '' : String(value) }
function groupOfMode(mode) { return !mode || mode === 'story' || mode === 'script' ? 'play' : 'card' }

/** Owns initialization, repeat-entry and opening recovery; never generates a model turn. */
export function createConversationInitialization(options) {
  const { cards, chats, snapshots, native, presets, settings, cardGreeting, emptyCardWorkspace, present } = options
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

  function newChat(card, mode, requestMode) {
    const chatMode = mode === 'card' ? 'card' : (mode === 'script' ? 'script' : 'story')
    const hasCard = card !== null && card !== undefined && str(card.path) !== ''
    return {
      id: id('chat'),
      cardPath: hasCard ? card.path : '',
      cardName: hasCard ? card.name : '卡片工作台',
      mode: chatMode,
      requestMode: requestMode === 'sillytavern' && chatMode !== 'card' ? 'sillytavern' : 'dsh',
      scriptState: chatMode === 'script' ? { cursor: 0, recalledChunkIds: [], prepared: null, lastReference: null, totalChunks: 0, title: '', scriptVersion: 0 } : null,
      workspace: chatMode === 'card' ? emptyCardWorkspace() : null,
      messages: [],
      posture: '',
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
      pendingCardChanges: {},
      createdAt: now(),
      updatedAt: now()
    }
  }

  async function initialize({ cardPath, sessionId, mode, openingId, userName, requestMode, userProfileEnabled }) {
    if (requestMode === 'sillytavern') throw new Error('兼容模式已停用')
    const currentSettings = await settings()
    const effectiveRequestMode = 'dsh'
    const requestedMode = mode === 'card' || mode === 'revision' || mode === 'extract' ? 'card' : (mode === 'script' ? 'script' : (mode === 'story' ? 'story' : null))
    const card = str(cardPath) === '' && requestedMode === 'card' ? null : await cards.read(cardPath)
    if (card === undefined) throw new Error('人物卡不存在: ' + cardPath)
    // 游玩模式内部仍是 story/script 两类：人物卡已绑定剧本时必须走剧本（script）。
    const script = card === null ? undefined : await cards.script(cardPath)
    const hasScript = script !== undefined && Array.isArray(script.chunks) && script.chunks.length > 0
    let chatMode = requestedMode
    if (chatMode === null || mode === 'play') chatMode = hasScript ? 'script' : 'story'
    if (chatMode === 'script' && !hasScript) throw new Error('该人物卡尚未绑定剧本文件，请先在卡片模式绑定剧本')
    if (chatMode === 'story' && hasScript) chatMode = 'script'
    if (typeof sessionId === 'string' && sessionId !== '') {
      const current = await chats.resolve(sessionId)
      if (current && current.requestMode === 'sillytavern') throw new Error('兼容模式已停用，原对话存档保留，请新建游玩对话')
      // 同一大模式（游玩/卡片）内复用当前会话；旧的自由故事会话不会被强行切换成剧本。
      if (current !== undefined && current.cardPath === str(cardPath) && groupOfMode(current.mode) === groupOfMode(chatMode)) {
        if (groupOfMode(current.mode) === 'play') await snapshots.ensure(current, card)
        await appendNativeOpening(sessionId, current, card, undefined, true)
        return await present(current, card)
      }
    }
    const macroState = { userName: str(userName).trim().slice(0, 80) || '你', local: {}, global: {} }
    const runtimePresetSnapshot = groupOfMode(chatMode) === 'play' ? await presets.fullSnapshot() : null
    const openingSourceText = chatMode === 'card' ? cardGreeting() : resolveCardOpening(card, openingId)
    const openingExtensions = chatMode === 'card' ? null : await cards.extensions(cardPath)
    const openingChoices = chatMode === 'card' ? [] : cardOpeningChoices(card)
    const selectedOpeningIndex = str(openingId) === '' ? 0 : Math.max(0, openingChoices.findIndex(function (choice) { return choice.id === str(openingId) }))
    const usesMvu = chatMode !== 'card' && (
      (Array.isArray(openingExtensions && openingExtensions.mvuResources) && openingExtensions.mvuResources.some(function (item) { return item.enabled !== false }))
      || openingChoices.some(function (choice) { return /<(?:initvar|json_?patch)>|_\.(?:set|insert|assign|remove|unset|delete|add)\(/i.test(choice.text) })
    )
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
    const greeting = openingProjection.sessionText
    // connectWorkspace 返回时，Agent 注册偶尔仍在异步完成。先等到原生会话可写，
    // 再落盘 Tavern 对话，避免失败时留下只有映射、没有原生开场白的半初始化记录。
    const openingTarget = typeof sessionId === 'string' && sessionId !== '' ? await native.wait(sessionId) : undefined
    const chat = newChat(card, chatMode || 'story', effectiveRequestMode)
    chat.bypassPlanId = runtimePresetSnapshot && runtimePresetSnapshot.planId || ''
    chat.runtimePresetSnapshot = runtimePresetSnapshot
    chat.runtimePresetPath = ''
    chat.macroState = macroState
    chat.userProfileEnabled = groupOfMode(chat.mode) === 'play' && userProfileEnabled === true
    chat.webSearchEnabled = groupOfMode(chat.mode) === 'play' && currentSettings.webSearchEnabled === true
    chat.backgroundModelSelection = groupOfMode(chat.mode) === 'play'
      ? snapshotBackgroundModel(currentSettings.backgroundModel, native.selection(sessionId))
      : null
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
    if (groupOfMode(chat.mode) === 'play') {
      await snapshots.prepare(chat, card)
    }
    chat.openingText = greeting
    chat.presentationWarnings = openingProjection.warnings
    if (chat.mode === 'script') {
      chat.scriptState = scriptContinuity.startAligned(script, greeting, card.script_start)
    }
    if (typeof sessionId === 'string') chat.sessionId = sessionId
    if (greeting !== '') chat.messages.push(bindSceneWorldbook(Object.assign({
      role: 'assistant',
      text: greeting,
      sourceText: openingSourceText,
      projectionText: openingProjection.renderedText,
      displayText: openingProjection.displayText,
      displayMode: openingProjection.displayMode,
      projectionVersion: 2,
      projectionWarnings: openingProjection.warnings,
      ts: now(),
      greeting: true,
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
    }), chat.sceneOpeningWorldbook))
    delete chat.sceneOpeningWorldbook
    const hasSession = typeof sessionId === 'string' && sessionId !== ''
    await chats.publish(chat)
    if (hasSession) await appendNativeOpening(sessionId, chat, card, openingTarget)
    return await present(chat, card)
  }


  function openingText(chat, card) {
    if ((chat.mode || 'story') === 'card') return cardGreeting()
    if (typeof chat.openingText === 'string') return chat.openingText
    const greeting = Array.isArray(chat.messages) ? chat.messages.find(message => message && message.greeting === true && typeof message.text === 'string') : undefined
    if (greeting !== undefined) return greeting.text
    const projection = projectAgentContent(card.first_mes, { charName: str(card && card.name), macroState: chat.macroState || {} })
    Object.assign(chat.macroState || (chat.macroState = {}), projection.macroState)
    return projection.renderedText
  }

  function openingId(chat) {
    // Stable identity in the existing message.id field: a retry after flush/crash
    // can recognize its own greeting without another save-format field or event.
    return 'tavern-opening:' + createHash('sha256').update(str(chat.id)).digest('hex')
  }

  function appendOpeningEvents(session, chat, text, selected, recovering) {
    // DSH adds a seed boundary on restore; it is not part of the opening turn.
    const openingEvents = () => session.events.filter(event => event.type !== 'session/end-seed')
    const events = openingEvents()
    const messageId = openingId(chat)
    const stages = [
      ['turn/start', { turn: 1 }],
      ['step/start', { turn: 1, step: 1 }],
      ['assistant/message', { turn: 1, step: 1, message: { id: messageId, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: selected.provider, model: selected.model } } }, { surfaceOp: 'append', sourceEventSeqs: [] }],
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
          && events[index - 2]?.type === 'turn/start' && events[index - 2]?.data.turn === 1
          && events[index - 1]?.type === 'step/start' && events[index - 1]?.data.step === 1
          && events[index + 1]?.type === 'step/end' && events[index + 1]?.data.turn === 1
          && events[index + 2]?.type === 'turn/end' && events[index + 2]?.data.turn === 1
      })
    }
    let start = messageIndex >= 0 ? messageIndex - 2 : events.length
    // An append can fail synchronously before the message. Only reuse the
    // unfinished trailing opening prefix, never delete or rewrite DSH history.
    if (messageIndex < 0 && events.at(-1)?.type === 'step/start' && events.at(-1)?.data.turn === 1 && events.at(-1)?.data.step === 1 && events.at(-2)?.type === 'turn/start' && events.at(-2)?.data.turn === 1) start -= 2
    else if (messageIndex < 0 && events.at(-1)?.type === 'turn/start' && events.at(-1)?.data.turn === 1) start -= 1
    for (let index = 0; index < stages.length; index++) {
      const [type, data, intent] = stages[index]
      const existing = openingEvents()[start + index]
      if (existing) {
        if (existing.type !== type || existing.data?.turn !== 1 || (data.step !== undefined && existing.data.step !== 1)) throw new Error('开场白事件不完整且已被其他操作推进，拒绝重复写入')
        continue
      }
      if (intent) session.append(type, data, intent)
      else session.append(type, data)
    }
  }

  async function appendNativeOpening(sessionId, chat, card, readyTarget, recovering = false) {
    if (chat.nativeOpeningAppended === true) return
    const text = openingText(chat, card)
    const target = readyTarget || await native.wait(sessionId)
    if (groupOfMode(chat.mode) === 'play' && chat.requestMode !== 'sillytavern') {
      await native.ensurePrefix(target.session, await snapshots.ensure(chat, card))
      await native.flush(target.session)
    }
    if (text !== '') {
      if (target.agent === undefined) logger.warn('dsh-tavern: Agent 尚未注册，直接使用已绑定 Session 写入开场白', { sessionId })
      const selected = native.selection(sessionId) || { provider: 'dsh-tavern', model: 'character-card' }
      appendOpeningEvents(target.session, chat, text, selected, recovering)
      if (target.agent?.phase?.kind === 'idle') target.agent.phase.lastTurn = Math.max(Number(target.agent.phase.lastTurn) || 0, 1)
      await native.flush(target.session)
    }
    // Publish the marker in memory only after durable save succeeds.
    const draft = Object.assign({}, chat, { nativeOpeningAppended: true })
    const saved = await chats.write(draft, { source: 'opening.native-append' })
    const committed = saved && typeof saved === 'object' ? saved : draft
    for (const field of Object.keys(chat)) if (!Object.hasOwn(committed, field)) delete chat[field]
    Object.assign(chat, committed)
  }

  async function recover(sessionId) {
    const chat = await chats.resolve(sessionId)
    if (chat === undefined) return null
    const card = (chat.mode || 'story') === 'card' && str(chat.cardPath) === '' ? null : await cards.readChat(chat)
    await appendNativeOpening(sessionId, chat, card, undefined, true)
    return await present(chat, card)
  }

  return Object.freeze({
    start: input => serialize(input.sessionId, () => initialize(input)),
    ensureOpening: sessionId => serialize(sessionId, () => recover(sessionId))
  })
}
