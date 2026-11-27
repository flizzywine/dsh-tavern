import { readHostSessionEvents, withHostSession } from '../host/sessions.js'
import { assertConversationForkable, cardWorkbenchForkPoint, conversationForkReceipt, forkConversationChat } from './conversation-fork.js'
import { conversationForkBoundary, conversationStateAtMessage, conversationStateAtTurn, FORK_BOUNDARY_MISSING, FORK_BOUNDARY_UNSAFE } from './conversation-fork-point.js'
import { legacyMessageUid } from './message-uid.js'
import { computeSceneTarget } from './scene-illustration.js'
import { sessionEvents } from './session-events.js'
import { upgradeReferences, upgradedAnchor } from './session-upgrade-references.js'

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

export function createConversationForkRuntime({
  chatForSession, readChat, readChatRevision, updateChatHeader, conversationRegistry,
  foregroundSessionHost, storyReconciliation, saveMaintenance, sceneWorldbookArchive,
  pluginApi, getSessionController, archiveSession, uid, logger
}) {
  const { sessions: sessionStore, agents: agentRegistry } = foregroundSessionHost
  const { assertBlankStoryForkTarget, seedNativeStory } = storyReconciliation

  async function planFork({ chatId: sourceChatId, sessionId: sourceSessionId, turn: requestedTurn, messageIndex: requestedMessageIndex, revision: requestedRevision, messageUid: requestedMessageUid }) {
    const source = str(sourceChatId) === '' ? await chatForSession(str(sourceSessionId)) : await readChat(str(sourceChatId))
    if (!source) throw new Error('找不到要分叉的源对话')
    assertConversationForkable(source, { agentRunning: agentRegistry.get(source.sessionId)?.phase?.kind === 'running' })
    if (requestedMessageIndex !== undefined && requestedMessageIndex !== null) {
      if (!Number.isSafeInteger(requestedMessageIndex) || requestedMessageIndex < 0) throw new Error('分叉消息位置无效')
      const messageUid = requestedMessageUid === undefined || requestedMessageUid === null ? '' : str(requestedMessageUid)
      if (requestedMessageUid !== undefined && requestedMessageUid !== null && messageUid === '') throw new Error('分叉消息身份无效')
      let requestedIndex = requestedMessageIndex
      if (messageUid) {
        const matches = []
        for (let index = 0; index < (source.messages || []).length; index++) {
          if (legacyMessageUid(source.messages[index], index) === messageUid) matches.push(index)
        }
        if (matches.length !== 1) throw new Error('分叉消息已经变化，请重新选择')
        requestedIndex = matches[0]
      } else if (requestedRevision !== source._storageRevision) throw new Error('剧情已变化，请重新选择分叉消息')
      const { state, turn, messageIndex } = await conversationStateAtMessage(source, requestedIndex, readChatRevision)
      // A story fork starts a blank native Session. The committed Chat prefix is
      // bound first; native repair then projects that prefix into model context.
      return { source, state, turn, messageIndex, atSeq: null, storyDirect: true, ...(messageUid ? { messageUid } : {}) }
    }
    const { state, turn, messageIndex } = await conversationStateAtTurn(source, requestedTurn, readChatRevision)
    return withHostSession(foregroundSessionHost, source.sessionId, session => {
      const references = upgradeReferences(sessionEvents(session))
      const mapped = structuredClone(state)
      for (const message of mapped.messages || []) {
        if (message.nativeAnchor) message.nativeAnchor = upgradedAnchor(message.nativeAnchor, references)
        if (message.bodyEdit) message.bodyEdit = { ...message.bodyEdit, seq: references.sequence(message.bodyEdit.seq, message.bodyEdit.formatVersion), formatVersion: 4 }
      }
      // A turn whose body was rewritten after its own turn/end (an edit, a polish
      // write-back, a rescued stream) no longer has a native boundary that carries that
      // text. A story fork rebuilds native context from the message prefix, so take that
      // path instead of refusing a branch the save can still cut.
      let atSeq = null
      try {
        atSeq = conversationForkBoundary(session, state, turn)
      } catch (error) {
        if (error?.code !== FORK_BOUNDARY_MISSING && error?.code !== FORK_BOUNDARY_UNSAFE) throw error
      }
      if (atSeq === null) {
        const messageUid = legacyMessageUid(source.messages?.[messageIndex], messageIndex)
        return { source, state: mapped, turn, messageIndex, atSeq: null, storyDirect: true, ...(messageUid ? { messageUid } : {}) }
      }
      return { source, state: mapped, turn, atSeq, storyDirect: false }
    })
  }
  // Plugin data and media are bound to text versions, whose keys hash the game id:
  // map the fork's visible turns to the new game's keys. A failure never undoes the fork.
  async function forkPluginState(source, state, fork, lastTurn, includedTurns) {
    try {
      const keyMap = new Map()
      for (const turn of await pluginApi.forkTurns(source.id)) {
        // The selected message prefix, not a numeric upper bound, defines the
        // branch. Legacy saves may contain missing, duplicate or reordered turns.
        if (!includedTurns.has(Number(turn))) continue
        try { keyMap.set(turn + '\u0000' + computeSceneTarget({ ...state, id: source.id }, turn).key, computeSceneTarget(fork, turn).key) } catch {}
      }
      await pluginApi.gameForked({ sourceChatId: source.id, targetChatId: fork.id, targetSessionId: fork.sessionId, keyMap })
      pluginApi.timelineChanged(fork.sessionId, { kind: 'fork', turn: lastTurn, fromGameId: source.sessionId })
    } catch (error) { console.warn('dsh-tavern: 分叉时处理插件数据失败:', str(error?.message || error)) }
  }

  async function forkWorkbench({ sessionId, messageId } = {}) {
    const source = await chatForSession(str(sessionId))
    if (source?.mode !== 'card' || source.requestMode === 'sillytavern') throw new Error('找不到当前卡片工作台对话')
    if (typeof messageId !== 'string' || !messageId) throw new Error('请选择一条已完成的回复')
    const controller = getSessionController()
    if (typeof controller?.fork !== 'function') throw new Error('当前 DSH 版本不支持对话分支')
    const { atSeq, turn, messages } = cardWorkbenchForkPoint(await readHostSessionEvents(foregroundSessionHost, source.sessionId), messageId)
    const { sessionId: targetId } = await controller.fork({ sessionId: source.sessionId, atSeq })
    const fork = forkConversationChat({ ...source, messages }, { chatId: uid('chat'), sessionId: targetId, id: uid, lastNativeTurn: turn })
    Object.assign(fork.forkedFrom, { turn, atSeq })
    fork.title = (source.title || source.cardName || '卡片工作台') + ' · 分支'
    fork.pendingCardChanges = {}
    if (fork.workspace) fork.workspace.prepared = null
    if (Number(fork.lastCardSave?.turn) > turn) delete fork.lastCardSave
    delete fork.lastOpenedAt
    delete fork.contextCompaction
    try {
      await conversationRegistry.publish(fork)
    } catch (error) {
      try { await archiveSession(targetId) }
      catch (archiveError) { logger.warn('dsh-tavern: 清理工作台分支失败', archiveError) }
      throw error
    }
    try { await controller.rename?.({ sessionId: targetId, title: fork.title }) }
    catch (error) { logger.warn('dsh-tavern: 工作台分支已创建，但自动命名失败', error) }
    return conversationForkReceipt(fork, { lastTurn: turn, messageCount: messages.length })
  }

  async function forkChat(args = {}) {
    const { targetSessionId, sourceRevision: expectedRevision, atSeq: expectedAtSeq } = args
    const { source, state, turn, atSeq, messageIndex, storyDirect, messageUid } = await planFork({ ...args, revision: expectedRevision })
    // Stable story identity covers unrelated writes between prepare and execute.
    // Legacy story requests and native atSeq forks retain their original fences.
    const sourceChanged = !(storyDirect && messageUid) && expectedRevision !== source._storageRevision
    if (sourceChanged || (!storyDirect && expectedAtSeq !== atSeq)) throw new Error('源对话已变化，请重新选择分叉位置')
    const targetId = str(targetSessionId)
    if (targetId === '' || await chatForSession(targetId) !== undefined) throw new Error('分叉目标必须是尚未绑定对话的新 Session')
    let targetHandle
    let target = sessionStore.get(targetId) || agentRegistry.get(targetId)?.session
    try {
      if (!target) { targetHandle = await agentRegistry.resume({ resumeSessionId: targetId }); target = targetHandle.agent.session }
      if (!target) throw new Error('分叉目标原生会话尚未就绪')
      if (storyDirect) assertBlankStoryForkTarget(targetId, target)
      else {
        const targetEnd = sessionEvents(target).findLast(event => event.type === 'turn/end')
        if (!targetEnd || targetEnd.seq !== atSeq) throw new Error('原生分叉没有停在指定回合，已拒绝绑定游戏状态')
      }
      const lastNativeTurn = storyDirect ? 0 : Number(sessionEvents(target).findLast(event => event.type === 'turn/start')?.data?.turn) || 0
      const includedTurns = new Set((state.messages || []).filter(message => message?.role === 'assistant')
        .map(message => Number(message.turn)).filter(turn => Number.isSafeInteger(turn) && turn >= 0))
      const lastStoryTurn = [...includedTurns].reduce((highest, turn) => Math.max(highest, turn), 0)
      // Imported rows may contain arbitrary turn labels. Bound how many synthetic
      // events a blank Session can write before publishing a new Chat for it.
      if (storyDirect && lastStoryTurn > 100_000) throw new Error('分叉前缀的轮号超过原生上下文可重建范围')
      const fork = forkConversationChat(state, { chatId: uid('chat'), sessionId: targetId, id: uid, now: Date.now, lastNativeTurn })
      fork.forkedFrom = { ...fork.forkedFrom, chatId: source.id, sessionId: source.sessionId, storageRevision: source._storageRevision,
        stateChatId: state.id, stateRevision: state._storageRevision, turn, ...(storyDirect ? { messageIndex, atSeq: null } : { atSeq }) }
      if (storyDirect) {
        fork.nativeSync = { status: 'stale', reason: '故事分叉等待原生上下文同步', at: Date.now() }
        // Do not suppress opening recovery until the native prefix really exists.
        fork.nativeOpeningAppended = false
      }
      await conversationRegistry.publish(fork, storyDirect ? {
        assertUnboundSession: () => assertBlankStoryForkTarget(targetId, target)
      } : undefined)
      await saveMaintenance.recordFork(fork).catch(error => console.warn('dsh-tavern: 记录分叉来源失败', str(error?.message || error)))
      await sceneWorldbookArchive.copyRefs(state.id, fork.id, includedTurns).catch(() => {})
      await forkPluginState(source, state, fork, turn, includedTurns)
      if (storyDirect) {
        const repaired = await seedNativeStory(targetId, target, lastStoryTurn, '故事分叉后按消息历史建立原生上下文')
          .catch(error => { console.warn('dsh-tavern: 故事分叉原生上下文修复失败:', str(error?.message || error)); return null })
        if (repaired?.applied) {
          fork.nativeOpeningAppended = true
          await updateChatHeader(fork.id, ['nativeOpeningAppended'], () => ({ nativeOpeningAppended: true }), { source: 'conversation.story-fork-native-ready' })
            .catch(error => console.warn('dsh-tavern: 保存故事分叉开场白状态失败:', str(error?.message || error)))
        }
      }
      const receiptTurn = turn > 0 ? turn : lastStoryTurn
      return conversationForkReceipt(fork, { lastTurn: receiptTurn, messageCount: fork.messages.length })
    } finally {
      if (targetHandle) await targetHandle.dispose().catch(error => console.warn('dsh-tavern: 释放分叉目标 Session 句柄失败:', str(error?.message || error)))
    }
  }

  async function prepare(args = {}) {
    const { source, turn, atSeq, messageIndex, messageUid, storyDirect } = await planFork(args)
    return { turn, atSeq, sourceRevision: source._storageRevision, messageIndex, messageUid, storyDirect: storyDirect === true }
  }

  return { prepare, forkChat, forkWorkbench }
}
