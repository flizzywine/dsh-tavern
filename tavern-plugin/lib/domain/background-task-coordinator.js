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
    const allOperations = Object.values(inspected.operations || {})
    const operations = allOperations.filter(function (operation) {
      return operation && operation.kind === 'agent'
    }).sort(function (left, right) {
      return (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0)
    })
    const running = operations.find(function (operation) { return operation.status === 'running' })
    const body = allOperations.filter(function (operation) {
      return operation && operation.kind === 'body' && operation.status === 'completed' && operation.background &&
        str(operation.committedBranchId || operation.basedOn && operation.basedOn.branchId) === inspected.branchId
    }).sort(function (left, right) {
      return (Number(right.completedAt) || 0) - (Number(left.completedAt) || 0)
    })[0]
    const background = body && body.background
    if (running === undefined && background && (background.phase === 'pending' || background.phase === 'running')) {
      return {
        phase: background.phase,
        busy: true,
        role: str(background.role),
        operationId: str(body.id),
        basedOn: { branchId: inspected.branchId, revision: Number(body.committedRevision) || inspected.revision },
        updatedAt: Number(background.updatedAt) || Number(body.completedAt) || 0
      }
    }
    const current = running || operations[0]
    if (current === undefined) {
      if (background && background.phase === 'failed') {
        return { phase: 'failed', busy: false, role: str(background.role), operationId: str(body.id), basedOn: null, updatedAt: Number(background.updatedAt) || 0 }
      }
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

  function operation(chat, operationId) {
    const inspected = timeline.inspect({ chat })
    const current = (inspected.operations || {})[str(operationId)]
    if (!current || current.kind !== 'agent') return null
    const status = str(current.status)
    return {
      operationId: str(current.id),
      role: str(current.role),
      status,
      busy: status === 'running',
      terminal: status !== 'running',
      successful: status === 'completed',
      basedOn: current.basedOn || null,
      updatedAt: Number(current.completedAt) || Number(current.createdAt) || Number(inspected.updatedAt) || 0
    }
  }

  async function begin(chat, role, input = {}) {
    const chatId = str(chat && chat.id)
    const requestId = str(input.requestId).trim().slice(0, 160)
    const begun = await serialize(chatId, async function () {
      const latest = await store.readChat(chatId)
      const source = latest === undefined ? chat : latest
      const requestedRole = str(role)
      if (requestId !== '') {
        const operations = Object.values(timeline.inspect({ chat: source }).operations || {})
        const existing = operations.find(function (operation) {
          return operation && operation.kind === 'agent' && str(operation.requestId) === requestId
        })
        if (existing !== undefined) {
          if (str(existing.role) !== requestedRole) {
            const error = new Error('同一后台请求标识对应了不同 Agent role')
            error.code = 'IDEMPOTENCY_CONFLICT'
            throw error
          }
          return {
            chat: source,
            value: { operationId: existing.id, basedOn: existing.basedOn, participant: null, created: false }
          }
        }
      }
      const currentActivity = activity(source)
      const expectedPending = currentActivity.phase === 'pending' && currentActivity.role === requestedRole
      if (currentActivity.busy && !expectedPending) {
        const error = new Error('后台 Agent 正在执行 ' + currentActivity.role + '，请等待完成')
        error.code = 'BACKGROUND_BUSY'
        error.activity = currentActivity
        throw error
      }
      const next = timeline.apply({ chat: source, intent: { kind: 'agent.begin', role, requestId } })
      await store.writeChat(next.chat)
      return next
    })
    const task = {
      chat: begun.chat,
      operationId: begun.value.operationId,
      basedOn: begun.value.basedOn,
      created: begun.value.created !== false,
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

  async function skip(chat, role) {
    const chatId = str(chat && chat.id)
    return await serialize(chatId, async function () {
      const latest = await store.readChat(chatId)
      const source = latest === undefined ? chat : latest
      const next = timeline.apply({ chat: source, intent: { kind: 'agent.skip', role } })
      await store.writeChat(next.chat)
      return { chat: next.chat, status: next.value.status, activity: activity(next.chat) }
    })
  }

  async function recover(chat) {
    const chatId = str(chat && chat.id)
    return await serialize(chatId, async function () {
      const latest = await store.readChat(chatId)
      const source = latest === undefined ? chat : latest
      const next = timeline.apply({ chat: source, intent: { kind: 'background.recover' } })
      if (next.value.status !== 'unchanged') await store.writeChat(next.chat)
      return { chat: next.chat, status: next.value.status, activity: activity(next.chat) }
    })
  }

  return Object.freeze({ activity, operation, begin, skip, recover })
}
