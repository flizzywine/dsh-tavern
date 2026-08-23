function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function messages(chat) {
  return Array.isArray(chat && chat.messages) ? chat.messages : []
}

export function isOpeningAwaitingSettlement(chat) {
  if ((chat && chat.settleStatus || 'idle') !== 'idle') return false
  const source = messages(chat)
  return source.some(function (message) {
    return message && message.role === 'assistant' && message.greeting === true
  }) && !source.some(function (message) {
    return message && message.greeting !== true
  })
}

export function shouldStartSettlementAfterTurnEnd(chat, reason) {
  if (reason !== 'completed' && reason !== 'max-tokens') return false
  const mode = chat && chat.mode || 'story'
  if (mode !== 'story' && mode !== 'script') return false
  return (chat && chat.settleStatus || 'idle') === 'running'
}

/** Coordinate one timeline-bound task without owning task-specific model work. */
export function createBackgroundTaskCoordinator(options = {}) {
  const store = options.store
  const timeline = options.timeline
  if (!store || typeof store.readChat !== 'function' || typeof store.writeChat !== 'function' || !timeline) {
    throw new Error('Background Task Coordinator 缺少存储或时间线 adapter')
  }

  async function begin(chat, role) {
    const begun = timeline.apply({ chat, intent: { kind: 'agent.begin', role } })
    await store.writeChat(begun.chat)
    const task = {
      chat: begun.chat,
      operationId: begun.value.operationId,
      basedOn: begun.value.basedOn,
      participantRequest: begun.value.participant || {},
      participant(trace) {
        const sessionId = str(trace && (trace.traceSessionId || trace.sessionId))
        if (sessionId === '') return null
        const boundary = Number(trace && (trace.traceBoundary ?? trace.boundary))
        return {
          sessionId,
          lifetime: 'chat',
          boundary: Number.isSafeInteger(boundary) ? boundary : null
        }
      },
      async commit(input = {}) {
        const latest = await store.readChat(begun.chat.id)
        if (latest === undefined) return { chat: null, status: 'missing' }
        const completed = timeline.complete({
          chat: latest,
          operationId: begun.value.operationId,
          basedOn: begun.value.basedOn,
          outcome: {
            status: input.status || 'success',
            stateChanged: input.stateChanged === true,
            participant: input.participant || null
          },
          apply: input.apply
        })
        await store.writeChat(completed.chat)
        return { chat: completed.chat, status: completed.value.status }
      },
      async fail(trace) {
        return task.commit({ status: 'failed', stateChanged: false, participant: task.participant(trace) })
      }
    }
    return Object.freeze(task)
  }

  return Object.freeze({ begin })
}

export function createSettlementAfterTurnEndScheduler(options = {}) {
  const readChatForSession = options.readChatForSession
  const queueSettlement = options.queueSettlement
  const defer = typeof options.defer === 'function' ? options.defer : setImmediate
  const logger = options.logger || console
  if (typeof readChatForSession !== 'function' || typeof queueSettlement !== 'function') {
    throw new Error('缺少回合结束后的结算调度依赖')
  }
  return function schedule(input = {}) {
    const reason = input.reason || ''
    if (reason !== 'completed' && reason !== 'max-tokens') return false
    defer(function () {
      Promise.resolve().then(async function () {
        const chat = await readChatForSession(input.sessionId)
        if (!shouldStartSettlementAfterTurnEnd(chat, reason)) return
        await queueSettlement(chat.id)
      }).catch(function (error) {
        logger.error('dsh-tavern: 回合结束后启动后台结算失败', error && error.message || error)
      })
    })
    return true
  }
}
