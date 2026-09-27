import { createScopedMessages } from './scoped-messages.js'
import { diffMvuChanges } from './mvu-settlement-effect.js'
import { diffJson } from './json-mutation.js'
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
  const blocked = typeof options.blocked === 'function' ? options.blocked : function () { return false }
  const mutationTails = new Map()
  if (!store || typeof store.readChat !== 'function' || typeof store.writeChat !== 'function' || typeof store.updateChat !== 'function' || !timeline) {
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
      return operation && operation.kind === 'body' && (operation.status === 'foreground-completed' || operation.status === 'completed') && operation.background &&
        str(operation.committedBranchId || operation.basedOn && operation.basedOn.branchId) === inspected.branchId
    }).sort(function (left, right) {
      return (Number(right.completedAt) || 0) - (Number(left.completedAt) || 0)
    })[0]
    const background = body && body.background
    if (running === undefined && background && background.phase === 'failed') {
      return { phase: 'failed', busy: false, role: str(background.role), operationId: str(body.id), basedOn: null,
        updatedAt: Number(background.updatedAt) || 0,
        ...(background.reason ? { reason: str(background.reason) } : {}) }
    }
    if (running === undefined && background && (background.phase === 'pending' || background.phase === 'running')) {
      return {
        phase: background.phase,
        busy: background.phase === 'running',
        role: str(background.role),
        operationId: str(body.id),
        basedOn: { branchId: inspected.branchId, revision: Number(body.committedRevision) || inspected.revision },
        updatedAt: Number(background.updatedAt) || Number(body.completedAt) || 0
      }
    }
    const current = running || operations[0]
    if (current === undefined) {
      return { phase: 'idle', busy: false, role: '', operationId: '', basedOn: null, updatedAt: Number(inspected.updatedAt) || 0 }
    }
    return {
      phase: running !== undefined ? 'running' : (current.status === 'failed' || (current.status === 'interrupted' && current.role === 'settlement') ? 'failed' : 'idle'),
      busy: running !== undefined,
      role: str(current.role),
      operationId: str(current.id),
      basedOn: current.basedOn || null,
      updatedAt: Number(current.completedAt) || Number(current.createdAt) || Number(inspected.updatedAt) || 0,
      ...(current.status === 'interrupted' && current.role === 'settlement' ? { reason: 'interrupted' } : {})
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
      requestId: str(current.requestId),
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
      if (blocked(source)) {
        const error = new Error('Tavern 正在压缩前台与后台上下文，请等待完成')
        error.code = 'COMPACTION_RUNNING'
        throw error
      }
      if (requestId !== '') {
        const operations = Object.values(timeline.inspect({ chat: source }).operations || {})
        const existing = operations.find(function (operation) {
          return operation && operation.kind === 'agent' && str(operation.requestId) === requestId
        })
        // 与 timeline.beginAgent 同规则：仅运行中的操作可复用；终态操作复用会把
        // 过期 basedOn 带进新任务，所有校验必炸（死循环根源）。
        if (existing !== undefined && str(existing.status) === 'running') {
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
      const conflictingPending = currentActivity.phase === 'pending' && currentActivity.role !== requestedRole
      if ((currentActivity.busy || conflictingPending) && !expectedPending) {
        const error = new Error('后台 Agent 正在执行 ' + currentActivity.role + '，请等待完成')
        error.code = 'BACKGROUND_BUSY'
        error.activity = currentActivity
        throw error
      }
      const next = timeline.apply({ chat: source, intent: { kind: 'agent.begin', role, requestId } })
      await store.writeChat(next.chat, { source: 'background.' + requestedRole + '.begin', operationId: next.value.operationId, requestId })
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
      async bindSession(sessionId) {
        return serialize(chatId, async () => {
          const intent = { kind: 'agent.bind', operationId: begun.value.operationId, sessionId }
          const metadata = { source: 'background.' + str(role) + '.bind', operationId: begun.value.operationId }
          if (store.readState && store.patchChat) {
            const state = await store.readState(chatId)
            const legacy = Object.values(state?.timeline?.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')
            if (state?.timeline?.schemaVersion === 1 && !legacy) {
              const next = timeline.apply({ chat: state, intent }).chat
              const saved = await store.patchChat(chatId, state._storageRevision,
                [{ op: 'set', path: ['timeline'], value: next.timeline }], metadata)
              if (saved) return store.readChat(chatId)
            }
          }
          return store.updateChat(chatId, source => timeline.apply({ chat: source, intent }).chat, metadata)
        })
      },
      async checkpoint(apply) {
        const saved = await serialize(chatId, () => store.updateChat(chatId, latest => {
          const state = timeline.inspect({ chat: latest })
          const operation = state.operations[begun.value.operationId]
          if (operation?.status !== 'running' || state.branchId !== begun.value.basedOn.branchId
            || state.revision !== begun.value.basedOn.revision) throw new Error('后台任务保存点已过期')
          apply(latest)
          return latest
        }, { source: 'background.' + str(role) + '.checkpoint', operationId: begun.value.operationId }))
        if (!saved) throw new Error('后台任务对话已不存在，保存点未写入')
        return saved
      },
      async checkpointMessage(messageId, apply) {
        return serialize(chatId, async () => {
          const mutate = (chat, index) => {
            const state = timeline.inspect({ chat })
            const operation = state.operations[begun.value.operationId]
            if (operation?.status !== 'running' || state.branchId !== begun.value.basedOn.branchId
              || state.revision !== begun.value.basedOn.revision) throw new Error('后台任务保存点已过期')
            apply(chat, chat.messages[index])
            return chat
          }
          const metadata = { source: 'background.' + str(role) + '.checkpoint', operationId: begun.value.operationId }
          if (store.readSlice && store.patchChat) {
            const selected = await store.readSettlementCheckpoint?.(chatId, messageId, begun.value.operationId)
              || await store.readSlice(chatId, [messageId])
            const legacy = Object.values(selected?.chat.timeline?.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')
            if (selected?.chat.timeline?.schemaVersion === 1 && !legacy) {
              const before = selected.chat, after = structuredClone(before)
              mutate(after, 0)
              const changes = diffJson(before, after)
              if (changes.every(c => c.path[0] === 'messages' && c.path[1] === 0 && c.path.length > 2)) {
                const saved = await store.patchChat(chatId, before._storageRevision,
                  changes.map(c => ({ ...c, path: ['messages', messageId, ...c.path.slice(2)] })), metadata)
                if (saved) return
              }
            }
          }
          const saved = await store.updateChat(chatId, chat => mutate(chat, messageId), metadata)
          if (!saved) throw new Error('后台任务对话已不存在，保存点未写入')
        })
      },
      async commit(input = {}) {
        return await serialize(begun.chat.id, async function () {
          const metadata = { source: 'background.' + str(role) + '.commit', operationId: begun.value.operationId }
          // This opt-in seam declares every floor the settlement callback can read/write.
          // Keep variable effects, delivery cleanup, receipt and timeline in one CAS frame.
          if (role === 'settlement' && Array.isArray(input.messageIndices) && store.readSlice && store.patchChat) {
            const indices = [...new Set(input.messageIndices)]
            for (let attempt = 0; attempt < 2; attempt++) {
              const selected = await store.readSlice(begun.chat.id, indices, 'settlement')
              const legacy = Object.values(selected?.chat.timeline?.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')
              if (!selected?.denseMessages || selected.chat.timeline?.schemaVersion !== 1 || legacy) break
              const messages = createScopedMessages(selected.messageCount, indices.map((id,i) => [id, selected.chat.messages[i]]))
              const before = { ...selected.chat, messages }
              const completed = timeline.complete({chat:before,messageIndices:indices,operationId:begun.value.operationId,basedOn:begun.value.basedOn,
                outcome:{status:input.status||'success',stateChanged:input.stateChanged===true,participant:input.participant||null},apply:input.apply ? chat => input.apply(chat, {messageIndices:indices}) : undefined})
              if (completed.chat.messages.length !== messages.length
                || Object.keys(completed.chat.messages).some(key => !indices.includes(Number(key)))) break
              const changes = diffMvuChanges(before,completed.chat,indices)
              if (changes.some(c => c.path[0] === 'messages' && (!indices.includes(c.path[1]) || c.path.length < 2))) break
              const saved = await store.patchChat(begun.chat.id,before._storageRevision,changes,{...metadata,returnProjection:'settlement'})
              if (saved) return {chat:{...completed.chat,...saved,messages:completed.chat.messages},status:completed.value.status}
            }
          }
          let status = 'missing'
          const saved = await store.updateChat(begun.chat.id, function (latest) {
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
            status = completed.value.status
            return completed.chat
          }, metadata)
          return saved === undefined ? { chat: null, status: 'missing' } : { chat: saved, status }
        })
      },
      async fail(trace) {
        return task.commit({ status: 'failed', stateChanged: false, participant: task.participant(trace) })
      },
      async defer(input = {}) {
        return task.commit({
          status: 'deferred',
          stateChanged: false,
          participant: input.participant || null,
          apply: input.apply
        })
      }
    }
    return Object.freeze(task)
  }

  async function recover(chat, options = {}) {
    const chatId = str(chat && chat.id)
    return await serialize(chatId, async function () {
      if (store.readState && !options.operationId) {
        const state = await store.readState(chatId)
        if (state?.timeline?.schemaVersion === 1) {
          const operations = Object.values(state.timeline.operations || {})
          const needsRecovery = operations.some(operation =>
            operation.kind === 'agent' && operation.status === 'running' ||
            operation.kind === 'body' && ['pending', 'running'].includes(operation.background?.phase))
          if (!needsRecovery) return { chat: state, status: 'unchanged', activity: activity(state) }
        }
      }
      const latest = await store.readChat(chatId)
      const source = latest === undefined ? chat : latest
      if (options.operationId && activity(source).operationId !== options.operationId) {
        return { chat: source, status: 'stale', activity: activity(source) }
      }
      const next = timeline.apply({ chat: source, intent: { kind: 'background.recover', cancelDelivery: Boolean(options.operationId) } })
      if (next.value.status !== 'unchanged') await store.writeChat(next.chat, { source: 'background.recover' })
      return { chat: next.chat, status: next.value.status, activity: activity(next.chat) }
    })
  }

  return Object.freeze({ activity, operation, begin, recover, exclusive: serialize })
}
