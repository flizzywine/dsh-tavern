import { isOpeningAwaitingSettlement } from './background-task-coordinator.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// What the player does to a game's background work: stop it, retry the latest reply's
// settlement, and start the settlement an older opening still waits for.
// `deps` is read on each call, so a test may swap a service after creation.
export function createSettlementControls(deps) {
  async function stopBackground(sessionId, operationId) {
    const { backgroundAgentRunner, backgroundTasks, cancelSettlement, chatForSession, pluginApi, readChatCard, view } = deps
    const chat = await chatForSession(sessionId)
    if (!chat) throw new Error('对话不存在')
    const activity = backgroundTasks.activity(chat)
    if (!operationId || activity.operationId !== operationId || (!activity.busy && activity.phase !== 'pending')) return view(chat, await readChatCard(chat))
    // Abort the provider request first; interrupted operations reject late commits.
    pluginApi.stopTasks(chat.sessionId)
    backgroundAgentRunner.cancel(chat.sessionId)
    await cancelSettlement(chat.id, { wait: false })
    const stopped = await backgroundTasks.recover(chat, { operationId })
    return view(stopped.chat, await readChatCard(stopped.chat))
  }

  async function retrySettlement(sessionId, turn, guidance) {
    const { backgroundTasks, chatForSession, mvuSettlementEngine, patchChat, projectOpeningWindow, queueSettlement, readChatCard, readOpeningWindow, storyTimeline, view } = deps
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
        ...(mvuRetry === 'reset' ? [{op:'set',path:['messages',target.messageId,'mvu'],value:target.message.mvu}] : []),
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

  return Object.freeze({ stopBackground, retrySettlement, pullBackgroundCycle })
}
