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
  const mutationTails = new Map()
  if (!store || typeof store.readChat !== 'function' || typeof store.writeChat !== 'function' || !timeline) {
    throw new Error('Background Task Coordinator 缺少存储或时间线 adapter')
  }

  function serialize(chatId, work) {
    const id = str(chatId)
    const previous = mutationTails.get(id) || Promise.resolve()
    const current = previous.catch(function () {}).then(work)
    mutationTails.set(id, current)
    return current.finally(function () {
      if (mutationTails.get(id) === current) mutationTails.delete(id)
    })
  }

  function activity(chat) {
    const inspected = timeline.inspect({ chat })
    const operations = Object.values(inspected.operations || {}).filter(function (operation) {
      return operation && operation.kind === 'agent'
    }).sort(function (left, right) {
      return (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0)
    })
    const running = operations.find(function (operation) { return operation.status === 'running' })
    const current = running || operations[0]
    if (current === undefined) {
      return { phase: 'idle', busy: false, role: '', operationId: '', basedOn: null, updatedAt: Number(inspected.updatedAt) || 0 }
    }
    return {
      phase: running !== undefined ? 'running' : (current.status === 'failed' ? 'failed' : 'idle'),
      busy: running !== undefined,
      role: str(current.role),
      operationId: str(current.id),
      basedOn: current.basedOn || null,
      updatedAt: Number(current.completedAt) || Number(current.createdAt) || Number(inspected.updatedAt) || 0
    }
  }

  async function begin(chat, role) {
    const chatId = str(chat && chat.id)
    const begun = await serialize(chatId, async function () {
      const latest = await store.readChat(chatId)
      const source = latest === undefined ? chat : latest
      const currentActivity = activity(source)
      if (currentActivity.busy) {
        const error = new Error('后台 Agent 正在执行 ' + currentActivity.role + '，请等待完成')
        error.code = 'BACKGROUND_BUSY'
        error.activity = currentActivity
        throw error
      }
      const next = timeline.apply({ chat: source, intent: { kind: 'agent.begin', role } })
      await store.writeChat(next.chat)
      return next
    })
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
        return await serialize(begun.chat.id, async function () {
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
        })
      },
      async fail(trace) {
        return task.commit({ status: 'failed', stateChanged: false, participant: task.participant(trace) })
      }
    }
    return Object.freeze(task)
  }

  return Object.freeze({ activity, begin })
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
