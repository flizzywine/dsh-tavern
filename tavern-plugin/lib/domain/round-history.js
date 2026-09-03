import { sessionEvents } from './session-events.js'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { clearRegenerationAttemptSurface, locateRegenerationSurface, locateRollbackSurface, planRegenerationSurface } from './rollback-surface.js'
import { assertRegenerationSourceCurrent, replaceLastRound } from './last-round-replacement.js'
import { diagnosticIdentity, regenerationTargetDiagnostic } from './regeneration-diagnostics.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function selectRegenerationTarget(chat, session, observe) {
  const nodes = (session.surface !== undefined && Array.isArray(session.surface.nodes)) ? session.surface.nodes : []
  const eventStart = sessionEvents(session).length
  const msgs0 = chat.messages || []
  let oldAssistantIndex = -1
  for (let i = msgs0.length - 1; i >= 0; i--) {
    const m = msgs0[i]
    if (m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true) {
      oldAssistantIndex = i
      break
    }
  }
  function report(reason, target) {
    if (typeof observe !== 'function') return
    try { observe(regenerationTargetDiagnostic(chat, session, { reason, assistantIndex: oldAssistantIndex, target })) } catch { /* Diagnostics never change selection. */ }
  }
  if (oldAssistantIndex < 1 || msgs0[oldAssistantIndex - 1] === null || typeof msgs0[oldAssistantIndex - 1] !== 'object' || msgs0[oldAssistantIndex - 1].role !== 'user') {
    report(oldAssistantIndex < 0 ? 'no-non-greeting-assistant' : oldAssistantIndex === 0 ? 'assistant-at-start'
      : msgs0[oldAssistantIndex - 1] === null || typeof msgs0[oldAssistantIndex - 1] !== 'object' ? 'previous-message-invalid' : 'previous-message-not-user')
    throw new Error('没有可重新生成的玩家输入与正文组合')
  }
  const target = locateRegenerationSurface({ events: sessionEvents(session), nodes, turn: msgs0[oldAssistantIndex].turn })
  if (target === null) { report('native-target-missing'); throw new Error('原生消息流中找不到与当前剧情轮次对应的正文消息') }
  report('selected', target)
  const oldSeq = target.assistantSeq
  const oldTurn = target.turn
  const oldSource = target.source
  return { nodes, eventStart, msgs0, oldAssistantIndex, oldSeq, oldTurn, oldSource }
}

/**
 * Own replacement/rollback ordering across stored story, DSH surface and scripts.
 * Timeline owns revisions; this module owns the workflow, including aborts.
 * Callers supply host adapters, never intermediate rollback or swipe state.
 */
export function createRoundHistory({ chats, sessions, scripts, timeline, queueSettlement, present, diagnostics }) {
  const { read: readChat, forSession: chatForSession, readCard: readChatCard,
    readRevision: readChatRevision, write: writeChat, update: updateChat } = chats
  const { read: readScript, continuity: scriptContinuity } = scripts
  const tavernScriptHostAdapter = scripts
  const storyTimeline = timeline
  const view = present
  const pendingRollbacks = new Set()

  function assertRollbackIdle(chat) {
    const agent = sessions.get(chat.sessionId)
    const unfinished = Object.values(storyTimeline.inspect({ chat }).operations || {}).some(function (operation) {
      return operation && (operation.status === 'running' || (operation.kind === 'body' && operation.status === 'foreground-completed'))
    })
    if (agent?.phase?.kind === 'running' || unfinished || chat.regenInProgress === true) throw new Error('当前轮次尚未完成生成或后台处理，请等待完成后再回退')
  }

  function assertRollbackSnapshot(current, expected) {
    if (!isDeepStrictEqual(current, expected)) throw new Error('回退期间聊天已被其他操作修改，请刷新后重试')
  }

  async function prepareRollbackIntent(chat, intent) {
    const target = storyTimeline.rollbackTarget({ chat })
    if (target === null) return intent
    const beforeChat = await readChatRevision(chat.id, target.beforeRevision)
    if (beforeChat === undefined) throw new Error('找不到剧情 checkpoint 对应的历史 Chat revision: ' + target.beforeRevision)
    return Object.assign({}, intent, { beforeChat })
  }
  async function regenBody(chatId, guidance, sessionId) {
    let chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    const activeRound = Object.values(storyTimeline.inspect({ chat }).operations || {}).find(function (operation) {
      return operation && operation.kind === 'body' && operation.status === 'foreground-completed'
    })
    if (activeRound !== undefined) throw new Error('当前轮次尚未完成状态结算，不能重新生成正文')
    if (chat.regenInProgress === true) throw new Error('正文正在重新生成，请等待完成')
    const card = await readChatCard(chat)
    const storedSessionId = chat.sessionId
    if (typeof sessionId === 'string' && sessionId !== '') chat.sessionId = sessionId
    if (typeof chat.sessionId !== 'string' || chat.sessionId === '') throw new Error('会话未绑定 DSH 会话')
    const agent = sessions.get(chat.sessionId)
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    const session = agent.session
    let selection, evidence
    try { selection = selectRegenerationTarget(chat, session, diagnostics ? value => { evidence = value } : undefined) }
    finally {
      if (evidence) {
        try { await diagnostics.record(chat.sessionId, { stage: 'regeneration-target', diagnosticId: randomUUID(),
          outcome: evidence.reason === 'selected' ? 'selected' : 'rejected', ...evidence,
          guidanceProvided: typeof guidance === 'string' && guidance.trim().length > 0,
          binding: { requested: diagnosticIdentity(sessionId), stored: diagnosticIdentity(storedSessionId), effective: diagnosticIdentity(chat.sessionId),
            overridden: Boolean(sessionId && sessionId !== storedSessionId) },
          agent: { phase: ['running', 'idle'].includes(agent.phase?.kind) ? agent.phase.kind : 'other', lastTurn: Number.isFinite(agent.phase?.lastTurn) ? agent.phase.lastTurn : null } }) }
        catch { /* Recording failure must not affect regeneration or replace its error. */ }
      }
    }
    const { eventStart, msgs0, oldAssistantIndex, oldSeq, oldTurn, oldSource } = selection
    const originalUserText = str(msgs0[oldAssistantIndex - 1].text).trim()
    const originalChat = structuredClone(chat)
    let restored = false
    async function restoreFailedRegen() {
      if (restored) return
      restored = true
      await updateChat(chat.id, function (current) {
        if (!current || typeof current !== 'object') return current
        return storyTimeline.apply({ chat: current, intent: { kind: 'replacement.abort', restoreChat: originalChat } }).chat
      }, { source: 'foreground.regen-abort' })
      clearRegenerationAttemptSurface({ session, eventStart })
    }
    let legacyBefore = null
    if (storyTimeline.inspect({ chat }).checkpointCount === 0) {
      let rollbackCommit = null
      if (chat.nativeCommits !== null && typeof chat.nativeCommits === 'object') {
        const keys = Object.keys(chat.nativeCommits).map(Number).filter(Number.isFinite).sort(function (a, b) { return b - a })
        for (const key of keys) {
          const value = chat.nativeCommits[String(key)]
          if (value && str(value.userText).trim() === originalUserText) { rollbackCommit = value; break }
        }
      }
      const before = rollbackCommit && rollbackCommit.before && typeof rollbackCommit.before === 'object' ? rollbackCommit.before : {}
      legacyBefore = {
        messages: msgs0.slice(0, oldAssistantIndex - 1), posture: str(before.posture), scriptState: chat.scriptState,
        candidates: null, settleStatus: 'idle', settleError: null, lastSettle: null,
        preparedWorldBookContext: str(before.preparedWorldBookContext),
        preparedWorldBook: before.preparedWorldBook || null,
        participants: {}
      }
      if ((chat.mode || 'story') === 'script') {
        const script = await readScript(chat.cardPath)
        if (script === undefined || !Array.isArray(script.chunks)) throw new Error('剧本文件不存在，无法重新生成正文')
        const revision = before.scriptRevision && typeof before.scriptRevision === 'object' ? before.scriptRevision : null
        const reference = rollbackCommit && rollbackCommit.scriptReference && typeof rollbackCommit.scriptReference === 'object' ? rollbackCommit.scriptReference : null
        legacyBefore.scriptState = scriptContinuity.transition({ script, state: chat.scriptState, event: { kind: 'restore', revision, reference } }).state
      }
    }
    const rollbackIntent = await prepareRollbackIntent(chat, { kind: 'turn.rollback', turn: oldTurn, legacyBefore })
    const lifecycleRevision = Math.max(0, Number(originalChat.tavernHelperLifecycleRevision) || 0) + 1
    chat = await updateChat(chat.id, function (current) {
      assertRegenerationSourceCurrent({ originalChat, currentChat: current, assistantIndex: oldAssistantIndex })
      const next = storyTimeline.apply({ chat: current, intent: rollbackIntent }).chat
      next.tavernHelperLifecycleRevision = lifecycleRevision
      next.regenInProgress = true
      return next
    }, { source: 'rollback.regen' })
    const rolledMessageCount = (chat.messages || []).length
    const guide = str(guidance).trim()
    const syntheticText = '【重新生成正文】\n原玩家输入：\n' + originalUserText + '\n\n指导意见：\n' + (guide !== '' ? guide : '（无）') + '\n\n请根据原玩家输入和指导意见重新生成小说正文。'
    const beforeLastTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : 0
    try {
      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: syntheticText }],
        source: { kind: 'plugin', plugin: 'dsh-tavern-regen' }
      })
      await agent.whenIdle()
    } catch (error) {
      await restoreFailedRegen()
      throw error
    }
    const syntheticTurn = agent.phase !== undefined && agent.phase !== null && Number.isFinite(Number(agent.phase.lastTurn)) ? Number(agent.phase.lastTurn) : (beforeLastTurn + 1)
    const latest = await readChat(chat.id)
    if (latest === undefined) {
      await restoreFailedRegen()
      throw new Error('聊天不存在: ' + chat.id)
    }
    const latestMsgs = latest.messages || []
    if (latestMsgs.length < rolledMessageCount + 2) {
      await restoreFailedRegen()
      throw new Error('重新生成流程未产生新的用户/助手回合')
    }
    const regeneratedUser = latestMsgs[latestMsgs.length - 2]
    const newAssistant = latestMsgs[latestMsgs.length - 1]
    if (regeneratedUser === null || typeof regeneratedUser !== 'object' || regeneratedUser.role !== 'user' ||
        newAssistant === null || typeof newAssistant !== 'object' || newAssistant.role !== 'assistant' || Number(newAssistant.turn) !== syntheticTurn) {
      await restoreFailedRegen()
      throw new Error('重新生成流程未产生正文')
    }
    const body = str(newAssistant.text).trim()
    if (body === '') {
      await restoreFailedRegen()
      throw new Error('重新生成失败：模型返回空文本')
    }
    const committedChat = await updateChat(latest.id, function (current) {
      const currentMessages = Array.isArray(current && current.messages) ? current.messages : []
      const currentUser = currentMessages[currentMessages.length - 2]
      const currentAssistant = currentMessages[currentMessages.length - 1]
      if (currentMessages.length < rolledMessageCount + 2 || currentUser === null || typeof currentUser !== 'object' || currentUser.role !== 'user' ||
          currentAssistant === null || typeof currentAssistant !== 'object' || currentAssistant.role !== 'assistant' || Number(currentAssistant.turn) !== syntheticTurn ||
          str(currentAssistant.text).trim() !== body) throw new Error('重新生成流程的正文已被另一项操作修改')
      const merged = replaceLastRound({ originalChat, regeneratedChat: current, assistantIndex: oldAssistantIndex })
      const next = merged.chat
      if (next.nativeCommits !== null && typeof next.nativeCommits === 'object') delete next.nativeCommits[String(syntheticTurn)]
      next.nativeCommits = next.nativeCommits && typeof next.nativeCommits === 'object' ? structuredClone(next.nativeCommits) : {}
      if (originalChat.nativeCommits && originalChat.nativeCommits[String(oldTurn)]) next.nativeCommits[String(oldTurn)] = structuredClone(originalChat.nativeCommits[String(oldTurn)])
      delete next.regenInProgress
      next.settleStatus = 'pending'
      next.settleError = null
      next.tavernHelperLifecycleRevision = lifecycleRevision + 1
      next.suppressedDshTurns = Array.from(new Set((Array.isArray(next.suppressedDshTurns) ? next.suppressedDshTurns : []).concat([syntheticTurn])))
      return next
    }, { source: 'foreground.regen-commit' })
    // 把旧正文、失败残留、合成输入和新模型节点折叠为唯一的新正文。
    const currentNodes = session.surface !== undefined && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
    const replacement = planRegenerationSurface({
      events: sessionEvents(session),
      nodes: currentNodes,
      oldAssistantSeq: oldSeq,
      eventStart
    })
    // 重生成正文与后台结算共同组成替代 Round；结算成功前不替换旧正文。
    let settledChat
    try {
      await queueSettlement(committedChat.id)
      settledChat = await readChat(committedChat.id)
      if (settledChat === undefined) throw new Error('重新生成结算后找不到聊天')
      const incompleteRound = Object.values(storyTimeline.inspect({ chat: settledChat }).operations || {}).find(function (operation) {
        return operation && operation.kind === 'body' && operation.status === 'foreground-completed'
      })
      if (incompleteRound !== undefined) throw new Error('重新生成正文的后台结算尚未完成，请先重试结算')
    } catch (error) {
      await restoreFailedRegen()
      throw error
    }
    session.append('assistant/message', {
      turn: oldTurn,
      step: 1,
      message: { id: randomUUID(), role: 'assistant', content: [{ type: 'text', text: body }], source: oldSource }
    }, {
      surfaceOp: { op: 'replace', start: replacement.start, end: replacement.end },
      sourceEventSeqs: replacement.shadowedSeqs
    })
    const result = await view(settledChat, card)
    result.adopted = { text: body, guidance: guide, hiddenTurn: oldTurn, syntheticTurn: syntheticTurn }
    return result
  }

  // ---------- 回退本轮（删除最近一次用户输入 + LLM 输出） ----------
  async function rollbackTurn(sessionId, chatId) {
    const chat = str(chatId) === '' ? await chatForSession(sessionId) : await readChat(chatId)
    if (chat === undefined) throw new Error('聊天不存在: ' + chatId)
    if (pendingRollbacks.has(chat.id)) throw new Error('正在回退本轮，请等待完成')
    pendingRollbacks.add(chat.id)
    try { return await rollbackChat(chat) }
    finally { pendingRollbacks.delete(chat.id) }
  }

  async function rollbackChat(chat) {
    assertRollbackIdle(chat)
    const originalChat = structuredClone(chat)
    const mode = chat.mode || 'story'
    if (mode !== 'story' && mode !== 'script') throw new Error('仅游玩模式支持回退本轮')
    const card = await readChatCard(chat)
    const agent = sessions.get(chat.sessionId)
    if (agent === undefined || agent.session === undefined) throw new Error('无法访问 DSH 会话: ' + chat.sessionId)
    const session = agent.session
    const events = sessionEvents(session)
    const nodes = session.surface !== undefined && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
    const rollbackSurface = locateRollbackSurface({ events, nodes })
    if (rollbackSurface === null) throw new Error('原生消息流中找不到可回退的用户输入与正文组合')
    const hiddenTurn = rollbackSurface.turn
    const shadowedSeqs = rollbackSurface.shadowedSeqs

    // 1) 定位要回退的最后一组 user + assistant
    const msgs = chat.messages || []
    let assistantIndex = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m !== null && typeof m === 'object' && m.role === 'assistant' && m.greeting !== true) {
        assistantIndex = i
        break
      }
    }
    if (assistantIndex < 0 || assistantIndex - 1 < 0) throw new Error('没有可回退的用户输入与正文组合')
    if (msgs[assistantIndex - 1] === null || typeof msgs[assistantIndex - 1] !== 'object' || msgs[assistantIndex - 1].role !== 'user') throw new Error('最后一组消息不是用户输入 + 正文')
    const removedUserText = str(msgs[assistantIndex - 1].text).trim()
    const removedAssistantText = str(msgs[assistantIndex].text).trim()
    // 2) 旧对话从 native commit 生成一次性迁移 checkpoint；新对话直接使用权威 checkpoint
    let rollbackCommit = null
    let rollbackCommitKey = ''
    if (chat.nativeCommits !== null && typeof chat.nativeCommits === 'object') {
      const keys = Object.keys(chat.nativeCommits).map(Number).filter(Number.isFinite).sort(function (a, b) { return b - a })
      for (const key of keys) {
        const commit = chat.nativeCommits[String(key)]
        if (commit !== null && typeof commit === 'object' && str(commit.userText).trim() === removedUserText) {
          rollbackCommit = commit
          rollbackCommitKey = String(key)
          break
        }
      }
    }
    const before = rollbackCommit !== null && rollbackCommit.before !== null && typeof rollbackCommit.before === 'object' ? rollbackCommit.before : null
    const legacyBefore = {
      messages: msgs.slice(0, assistantIndex - 1),
      posture: before !== null && typeof before.posture === 'string' ? before.posture : '',
      scriptState: chat.scriptState,
      candidates: null,
      settleStatus: 'idle',
      settleError: null,
      lastSettle: null,
      participants: {}
    }
    if (mode === 'script' && storyTimeline.inspect({ chat }).checkpointCount === 0) {
      const script = await readScript(chat.cardPath)
      if (script === undefined || !Array.isArray(script.chunks)) throw new Error('剧本文件不存在，无法回退剧本状态')
      const revision = before !== null && before.scriptRevision !== null && typeof before.scriptRevision === 'object'
        ? before.scriptRevision
        : (before !== null && before.scriptState !== null && typeof before.scriptState === 'object' ? before.scriptState : null)
      const reference = rollbackCommit !== null && rollbackCommit.scriptReference !== null && typeof rollbackCommit.scriptReference === 'object' ? rollbackCommit.scriptReference : null
      legacyBefore.scriptState = scriptContinuity.transition({ script: script, state: chat.scriptState, event: { kind: 'restore', revision: revision, reference: reference } }).state
    }
    const rollbackIntent = await prepareRollbackIntent(chat, { kind: 'turn.rollback', turn: hiddenTurn, legacyBefore })
    assertRollbackIdle(chat)
    const rolled = storyTimeline.apply({ chat, intent: rollbackIntent })
    chat = rolled.chat
    if (rollbackCommitKey !== '') delete chat.nativeCommits[rollbackCommitKey]
    chat.tavernHelperLifecycleRevision = Math.max(0, Number(chat.tavernHelperLifecycleRevision) || 0) + 1
    chat.suppressedDshTurns = Array.from(new Set((Array.isArray(chat.suppressedDshTurns) ? chat.suppressedDshTurns : []).concat([hiddenTurn])))
    chat.updatedAt = Date.now()
    chat = await updateChat(chat.id, current => {
      assertRollbackSnapshot(current, originalChat)
      assertRollbackIdle(current)
      return chat
    }, { source: 'rollback' })

    // 3) 原生消息面：用空消息替换最近一轮的所有 surface 节点（模型不再看到），UI 由客户端隐藏对应 turn tail
    try {
      assertRollbackIdle(chat)
      session.append('assistant/message', {
        turn: rollbackSurface.turn,
        step: rollbackSurface.step,
        message: {
          id: randomUUID(),
          role: 'assistant',
          content: [],
          source: rollbackSurface.source
        }
      }, {
        surfaceOp: { op: 'replace', start: rollbackSurface.userSeq, end: rollbackSurface.endSeq },
        sourceEventSeqs: shadowedSeqs
      })
    } catch (error) {
      // Keep append-only history intact. A rejected surface replacement must not consume the story checkpoint.
      try {
        await updateChat(chat.id, current => {
          assertRollbackSnapshot(current, chat)
          return storyTimeline.apply({ chat: current, intent: { kind: 'replacement.abort', restoreChat: originalChat } }).chat
        }, { source: 'rollback.abort' })
      } catch (restoreError) {
        throw new Error('回退失败且剧情恢复未完成：' + str(error?.message || error) + '；' + str(restoreError?.message || restoreError), { cause: error })
      }
      throw error
    }
    // Notify scripts only after both authoritative story and native surface have committed.
    let rollbackWarning = ''
    try {
      await tavernScriptHostAdapter.dispatchEvent({ sessionId: chat.sessionId, chat, name: 'MESSAGE_DELETED', args: [(chat.messages || []).length] })
    } catch (error) { rollbackWarning = '回退已完成，但脚本联动失败：' + str(error?.message || error) }
    const result = await view(chat, card)
    if (rollbackWarning !== '') result.rollbackWarning = rollbackWarning
    result.rolledBack = { hiddenTurn: hiddenTurn, removedUserText: removedUserText, removedAssistantText: removedAssistantText }
    return result
  }

  return Object.freeze({ regenerate: regenBody, rollback: rollbackTurn })
}
