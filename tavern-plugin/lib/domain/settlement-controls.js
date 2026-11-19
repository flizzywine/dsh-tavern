import { isOpeningAwaitingSettlement } from './background-task-coordinator.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// The DSH composer sends its stop action to the subagent service. Tavern's
// settlement workers are listed in that catalog but are owned by Tavern.
export function installSettlementSubagentStop(service, stopSettlementAgent) {
  const subagents = service?.[Symbol.for('cordis.original')] || service
  const original = subagents?.interruptByUser
  if (typeof original !== 'function') return () => {}
  const own = Object.hasOwn(subagents, 'interruptByUser')
  function interruptByUser(childSessionId) {
    const stopping = stopSettlementAgent(childSessionId)
    if (!stopping) return original.call(this, childSessionId)
    return stopping.then(() => ({ accepted: true }))
  }
  subagents.interruptByUser = interruptByUser
  return () => {
    if (subagents.interruptByUser !== interruptByUser) return
    if (own) subagents.interruptByUser = original
    else delete subagents.interruptByUser
  }
}

// What the player does to a game's background work: stop it, retry the latest reply's
// settlement, and start the settlement an older opening still waits for.
// `deps` is read on each call, so a test may swap a service after creation.
export function createSettlementControls(deps) {
  async function stopBackground(sessionId, operationId, expectedRun) {
    const { backgroundAgentRunner, backgroundTasks, cancelSettlement, chatForSession, stageDirector, pluginApi, readChatCard, view } = deps
    const chat = await chatForSession(sessionId)
    if (expectedRun && backgroundAgentRunner.activeRequestContext(expectedRun.childSessionId) !== expectedRun.context) return
    if (!chat) throw new Error('对话不存在')
    const activity = backgroundTasks.activity(chat)
    const coreActive = activity.busy || activity.phase === 'pending'
    if (!operationId || !(coreActive && activity.operationId === operationId || activity.director?.operationId === operationId)) return view(chat, await readChatCard(chat))
    if (!expectedRun) {
      stageDirector?.cancel(chat)
      backgroundAgentRunner.cancel(chat.sessionId, { task: 'stage-director' })
      pluginApi.stopTasks(chat.sessionId)
      backgroundAgentRunner.cancel(chat.sessionId)
    }
    // The settlement job also aborts its model request. Persist the interruption
    // before allowing any late result to be applied to this operation.
    await cancelSettlement(chat.id, { wait: false })
    const stopped = coreActive ? await backgroundTasks.recover(chat, { operationId: activity.operationId }) : { chat }
    return view(stopped.chat, await readChatCard(stopped.chat))
  }

  function stopSettlementAgent(childSessionId) {
    const context = deps.backgroundAgentRunner.activeRequestContext(childSessionId)
    if (context?.task !== 'settlement' || !context.operationId) return
    return stopBackground(context.parentSessionId, context.operationId, { childSessionId, context })
  }

  async function retrySettlement(sessionId, turn, guidance) {
    const { backgroundTasks, chatForSession, mvuSettlementEngine, patchChat, projectOpeningWindow, queueSettlement, readChatCard, readOpeningWindow, readSlice, storyTimeline, view } = deps
    for (let attempt=0;attempt<5;attempt++) {
      const recent = await readOpeningWindow(sessionId)
      const window = recent && recent.chat.timeline?.schemaVersion === 1
        && !Object.values(recent.chat.timeline.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')
        && recent.chat.messages.some(message => message.role === 'assistant' && message.greeting !== true) ? recent : null
      const chat = window ? window.chat : await chatForSession(sessionId)
      if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
      const activity = backgroundTasks.activity(chat)
      if (activity.busy) throw new Error('后台 Agent 正在运行，请稍候')
      if (Object.values(storyTimeline.inspect({ chat }).operations || {}).some(operation => operation.kind === 'body' && operation.status === 'running')) {
        throw new Error('正文正在生成，请等待完成后再重新结算')
      }
      const messages = Array.isArray(chat.messages) ? chat.messages : []
      let target = null
      for (let messageId = messages.length - 1; messageId >= 0; messageId--) {
        const message = messages[messageId]
        if (!message || message.role !== 'assistant' || message.greeting === true) continue
        target = { messageId: messageId + (window?.from || 0), message }
        break
      }
      if (target === null || Math.max(0, Number(target.message.turn) || 0) !== Math.max(0, Number(turn) || 0)) {
        throw new Error('只能重试当前最新正文的后台结算')
      }
      if (window) {
        // The display window omits settlement baselines and participant records.
        // Read only this reply in full, and restart if the window is already stale.
        const selected = await readSlice(chat.id, [target.messageId], ['id', '_storageRevision'])
        if (!selected || selected.chat._storageRevision !== chat._storageRevision) continue
        target.message = selected.chat.messages[0]
        chat.messages[target.messageId - window.from] = target.message
      }
      const mvuRetry = mvuSettlementEngine.prepareRetry({ chat, target, guidance, activity })
      if (mvuRetry === 'redeliver') {
        void queueSettlement(chat.id).catch(error => console.error('dsh-tavern: 重新投递变量结算失败', str(error?.message || error)))
        return window ? await projectOpeningWindow(window) : await view(chat, await readChatCard(chat))
      }
      if (mvuRetry === 'none' && (activity.phase !== 'failed' || activity.role !== 'settlement')) {
        throw new Error('当前最新正文没有失败的后台结算')
      }
      chat.settleStatus = 'pending'
      chat.settleError = null
      chat.updatedAt = Date.now()
      // Historical display backfill must not turn a retry into a full-history
      // merge. CAS the requested fields; on conflict re-read and revalidate the
      // latest body, activity and MVU baseline before trying again.
      const saved = await patchChat(chat.id, chat._storageRevision, [
        ...(mvuRetry === 'reset' ? [{op:'set',path:['messages',target.messageId,'mvu'],value:target.message.mvu}, ...(target.message.stageItems ? [{op:'set',path:['messages',target.messageId,'stageItems'],value:target.message.stageItems}] : [])] : []),
        {op:'set',path:['settleStatus'],value:'pending'}, {op:'set',path:['settleError'],value:null}
      ], { source: 'settlement.retry' })
      if (!saved) continue
      chat._storageRevision = saved._storageRevision
      chat.updatedAt = saved.updatedAt
      if (window) window.revision = saved._storageRevision
      void queueSettlement(chat.id).catch(function (error) {
        console.error('dsh-tavern: 重试后台结算失败', str(error && error.message || error))
      })
      return window ? await projectOpeningWindow(window) : await view(chat, await readChatCard(chat))
    }
    throw new Error('对话正在被其他操作更新，请稍后重新结算')
  }
  async function pullBackgroundCycle(sessionId) {
    const { backgroundTasks, chatForSession, queueSettlement, writeChat } = deps
    let chat = await chatForSession(sessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定人物卡')
    let shouldRun = false
    if (isOpeningAwaitingSettlement(chat)) {
      chat.settleStatus = 'running'
      chat.settleError = null
      await writeChat(chat, { source: 'settlement.opening-prepare' })
      shouldRun = true
    }
    const activity = backgroundTasks.activity(chat)
    if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) shouldRun = true
    if (!shouldRun) return true
    void queueSettlement(chat.id)
    return false
  }

  return Object.freeze({ stopBackground, stopSettlementAgent, retrySettlement, pullBackgroundCycle })
}
