import { taskStateFields } from './task-state-reader.js'
import { createScopedMessages } from './scoped-messages.js'
import { diffMvuChanges } from './mvu-settlement-effect.js'
import { diffJson } from './json-mutation.js'
import { participantOf, slotOf } from './background-members.js'
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
// Header-only writes retry a concurrent write with a fresh header read (cheap); a new turn
// writes often, and the whole-Chat fallback costs the whole history.
const HEADER_RETRIES = 10
// A queued task re-checks its member's slot at least this often: a slot also frees through
// timeline writes that never pass a commit here (a rollback cancels its task).
const QUEUE_POLL_MS = 1000
const QUEUE_MAX_MS = 15 * 60 * 1000

/**
 * Begins a queued task (`begin(onQueued)`): resolves `{ taskRun }` once begun, or
 * `{ queued: true, begun }` as soon as it waits for its member's slot, so a click returns at once.
 */
export function beginOrQueue(begin) {
  let markQueued
  const waiting = new Promise(resolve => { markQueued = resolve })
  const begun = begin(() => markQueued())
  return Promise.race([begun.then(taskRun => ({ taskRun })), waiting.then(() => ({ queued: true, begun }))])
}

export function createBackgroundTaskCoordinator(options = {}) {
  const store = options.store
  const timeline = options.timeline
  const blocked = typeof options.blocked === 'function' ? options.blocked : function () { return false }
  // Optional work (the worldbook prefilter) yields to any other task instead of blocking it.
  // Runs outside the per-chat lock: the yielding task commits through that lock.
  const mutationTails = new Map()
  if (!store || typeof store.readChat !== 'function' || typeof store.writeChat !== 'function' || typeof store.updateChat !== 'function' || !timeline) {
    throw new Error('Background Task Coordinator 缺少存储或时间线 adapter')
  }

  // Queued begins waiting on a chat's slots; a commit wakes them to look again.
  const slotWaiters = new Map()
  function slotReleased(chatId) {
    const waiters = slotWaiters.get(chatId)
    slotWaiters.delete(chatId)
    for (const wake of waiters || []) wake()
  }
  function nextRelease(chatId, signal) {
    return new Promise(resolve => {
      const waiters = slotWaiters.get(chatId) || new Set()
      slotWaiters.set(chatId, waiters)
      const wake = () => { clearTimeout(timer); waiters.delete(wake); signal?.removeEventListener('abort', wake); resolve() }
      const timer = setTimeout(wake, QUEUE_POLL_MS)
      waiters.add(wake)
      signal?.addEventListener('abort', wake, { once: true })
    })
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

  // `slot` (background-members.js): only that member's tasks; without it, the whole game.
  function activity(chat, slot) {
    const inspected = timeline.inspect({ chat })
    const allOperations = Object.values(inspected.operations || {})
    const operations = allOperations.filter(function (operation) {
      return operation && operation.kind === 'agent' && (slot === undefined || slotOf(operation.role) === slot)
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
    const background = body && body.background && (slot === undefined || slotOf(body.background.role || 'settlement') === slot) ? body.background : undefined
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

  // `queue`: a busy member's slot (书记 has one Session) holds this task back until it frees,
  // instead of refusing it.
  // The wait reads task state only (never the whole history); a rollback or replaced story
  // (a new branch) cancels it. `onQueued` fires once, when the wait starts.
  async function begin(chat, role, input = {}) {
    if (input.queue !== true) return beginNow(chat, role, input)
    const chatId = str(chat && chat.id)
    const queueBranchId = str(chat?.timeline?.branchId)
    const deadline = Date.now() + QUEUE_MAX_MS
    let attempt = { ...input, queueBranchId }
    while (true) {
      try { return await beginNow(chat, role, attempt) }
      catch (error) {
        // Behind another run of the same task is a duplicate, not a wait.
        if (error?.code !== 'BACKGROUND_BUSY' || error.activity?.role === str(role) || Date.now() >= deadline) throw error
        if (!attempt.queued) { attempt = { ...attempt, queued: true, reuseSnapshot: false }; input.onQueued?.(error.activity) }
      }
      while (true) {
        input.signal?.throwIfAborted()
        await nextRelease(chatId, input.signal)
        input.signal?.throwIfAborted()
        const state = await (store.readRecoveryState || store.readState)?.(chatId)
        if (!state) break
        assertQueueBranch(state, attempt)
        const current = activity(state, slotOf(str(role)))
        if (!(current.busy || current.phase === 'pending' && current.role !== str(role)) || Date.now() >= deadline) break
      }
    }
  }
  function assertQueueBranch(source, input) {
    if (!input.queueBranchId || str(source?.timeline?.branchId) === input.queueBranchId) return
    const error = new Error('剧情已回退或改写，排队中的后台任务已取消')
    error.code = 'BACKGROUND_QUEUE_CANCELLED'
    throw error
  }

  async function beginNow(chat, role, input = {}) {
    const chatId = str(chat && chat.id)
    const requestId = str(input.requestId).trim().slice(0, 160)
    const begun = await serialize(chatId, async function () {
      if (role === 'candidate' && store.readRecoveryState) {
        // Header fields only: its empty message slice must not replace the story the
        // candidate falls back on when the background session lost it (#394).
        const state = await store.readRecoveryState(chatId)
        if (state) { const { messages: _messages, ...header } = state; chat = {...chat,...header} }
      }
      let fast = (input.reuseSnapshot === true && requestId === '' || role === 'candidate' && store.readRecoveryState) && store.patchChat && Number.isSafeInteger(chat?._storageRevision)
        && chat.timeline?.schemaVersion === 1 && !Object.values(chat.timeline.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')
      let source = fast ? chat : (await store.readChat(chatId) ?? chat)
      let refreshes = 0
      while (true) {
        const requestedRole = str(role)
        if (blocked(source)) {
          const error = new Error('Tavern 正在压缩前台与后台上下文，请等待完成')
          error.code = 'COMPACTION_RUNNING'
          throw error
        }
        assertQueueBranch(source, input)
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
        // Preparation may await resource/context reads. Validate against the same
        // snapshot before creating an operation, including after a failed patch CAS.
        if (input.expectedTimeline && (str(source.timeline?.branchId) !== input.expectedTimeline.branchId
          || (Number(source.timeline?.revision) || 0) !== input.expectedTimeline.revision)) {
          throw new Error('剧情已变化，请重新生成候选项')
        }
        // Only a task on the same member's slot holds this one back.
        const currentActivity = activity(source, slotOf(requestedRole))
        const expectedPending = currentActivity.phase === 'pending' && currentActivity.role === requestedRole
        const conflictingPending = currentActivity.phase === 'pending' && currentActivity.role !== requestedRole
        if ((currentActivity.busy || conflictingPending) && !expectedPending) {
          options.lockEvent?.({ kind: 'refused', sessionId: str(chat?.sessionId || source?.sessionId), slot: slotOf(requestedRole), role: requestedRole, holder: str(currentActivity.role) })
          const error = new Error('后台 Agent 正在执行 ' + currentActivity.role + '，请等待完成')
          error.code = 'BACKGROUND_BUSY'
          error.activity = currentActivity
          throw error
        }
        // agent.begin only changes timeline metadata. Omit historic checkpoints
        // from cloning/diffing; retain them in the returned full snapshot.
        const projected = fast ? { ...(input.prepareCommit ? {taskMailbox:source.taskMailbox} : {}), timeline: { ...source.timeline, checkpoints: [] }, ...(Object.hasOwn(source, 'candidateAgent') ? { candidateAgent: source.candidateAgent } : {}) } : source
        const next = timeline.apply({ chat: projected, intent: { kind: 'agent.begin', role, requestId } })
        if (input.bindExistingSession && next.value.participant?.sessionId) {
          next.chat = timeline.apply({chat:next.chat,intent:{kind:'agent.bind',operationId:next.value.operationId,sessionId:next.value.participant.sessionId}}).chat
        }
        if (input.prepareCommit) next.value.startCommitted = input.prepareCommit(next.chat,next.value) === true
        if (fast) {
          const changes = diffJson(projected, next.chat)
          const safe = changes.every(change => change.path[0] === 'candidateAgent' || input.prepareCommit && change.path[0] === 'taskMailbox' ||
            change.path[0] === 'timeline' && change.path.length > 1 && change.path[1] !== 'checkpoints')
          const saved = safe && await store.patchChat(chatId, source._storageRevision, changes,
            { source: 'background.' + requestedRole + '.begin', operationId: next.value.operationId, requestId, returnProjection: taskStateFields })
          if (saved) return { ...next, chat: { ...source, ...saved,
            timeline: { ...next.chat.timeline, checkpoints: source.timeline.checkpoints }, messages: source.messages } }
          // A concurrent writer invalidated our snapshot. agent.begin only reads and writes
          // task state: re-read those header fields and revalidate every guard against them.
          // The compatibility path (whole Chat) remains for legacy stories and lasting races.
          const state = ++refreshes <= HEADER_RETRIES && store.readRecoveryState ? await store.readRecoveryState(chatId) : undefined
          if (state?.timeline?.schemaVersion === 1 && Number.isSafeInteger(state._storageRevision)
            && !Object.values(state.timeline.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')) {
            source = { ...source, ...state, timeline: { ...state.timeline, checkpoints: source.timeline.checkpoints } }
            continue
          }
          fast = false
          source = await store.readChat(chatId) ?? chat
          continue
        }
        await store.writeChat(next.chat, { source: 'background.' + requestedRole + '.begin', operationId: next.value.operationId, requestId })
        return next
      }
    })
    // One agent operation at a time holds a game's background slot, from here to its commit.
    const gameId = str(chat?.sessionId || begun.chat?.sessionId)
    if (begun.value.created !== false) options.lockEvent?.({ kind: 'held', sessionId: gameId, slot: slotOf(role), role: str(role), operationId: begun.value.operationId })
    const task = {
      chat: begun.chat,
      operationId: begun.value.operationId,
      basedOn: begun.value.basedOn,
      created: begun.value.created !== false,
      startCommitted: begun.value.startCommitted === true,
      participantRequest: begun.value.participant || {},
      participant(trace) {
        const sessionId = str(trace && (trace.traceSessionId || trace.sessionId))
        if (sessionId === '') return null
        const boundary = Number(trace && (trace.traceBoundary ?? trace.boundary))
        return {
          sessionId,
          lifetime: 'chat',
          formatVersion: 4,
          boundary: Number.isSafeInteger(boundary) ? boundary : null
        }
      },
      async bindSession(sessionId, { stateOnly = false } = {}) {
        return serialize(chatId, async () => {
          const intent = { kind: 'agent.bind', operationId: begun.value.operationId, sessionId }
          const metadata = { source: 'background.' + str(role) + '.bind', operationId: begun.value.operationId }
          // A concurrent write between reading and patching retries with fresh task state.
          for (let attempt = 0; store.readState && store.patchChat && attempt < HEADER_RETRIES; attempt++) {
            const state = await (store.readRecoveryState || store.readState)(chatId)
            const legacy = Object.values(state?.timeline?.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')
            if (state?.timeline?.schemaVersion === 1 && !legacy) {
              // Binding changes metadata only. Recovery projections deliberately
              // omit rollback snapshots; never replace the entire timeline.
              const before={timeline:{...state.timeline,checkpoints:[]},...(Object.hasOwn(state,'candidateAgent')?{candidateAgent:state.candidateAgent}:{})}
              const next = timeline.apply({ chat: before, intent }).chat
              // Begin may already have bound a durable reused session. Still
              // validate the operation above; a late callback must not bypass it.
              if (state.timeline.operations[begun.value.operationId]?.startedSessionId === sessionId &&
                state.timeline.participants?.[participantOf(role)]?.sessionId === sessionId) {
                return stateOnly ? state : store.readChat(chatId)
              }
              const saved = await store.patchChat(chatId, state._storageRevision,
                diffJson(before,next), {...metadata,returnProjection:taskStateFields})
              // Callers that bind state-only ignore the result: the task-state receipt suffices.
              if (saved) return stateOnly ? saved : store.readChat(chatId)
            } else break
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
        const outcome = await serialize(begun.chat.id, async function () {
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
          // A task whose callback writes header fields only names them: the commit reads
          // and patches the header, never the history (candidates: scriptState).
          const headerFields = role === 'candidate' && input.headerOnly === true ? ['scriptState']
            : Array.isArray(input.headerFields) ? input.headerFields.map(str).filter(field => field && field !== 'messages') : null
          if (headerFields && store.readSlice && store.patchChat) {
            const fields = [...taskStateFields, ...headerFields]
            const writable = new Set(['timeline', 'candidateAgent', 'candidates', ...headerFields])
            for (let attempt = 0; attempt < HEADER_RETRIES; attempt++) {
              const before = (await store.readSlice(begun.chat.id, [], fields))?.chat
              if (before?.timeline?.schemaVersion !== 1 || Object.values(before.timeline.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')) break
              before.timeline={...before.timeline,checkpoints:[]}
              const completed = timeline.complete({chat:before,operationId:begun.value.operationId,basedOn:begun.value.basedOn,
                outcome:{status:input.status||'success',stateChanged:input.stateChanged===true,participant:input.participant||null},apply:input.apply})
              const changes = diffJson(before, completed.chat)
              if (changes.some(change => !writable.has(change.path[0]))) break
              const saved = await store.patchChat(begun.chat.id,before._storageRevision,changes,{...metadata,returnProjection:fields})
              if (saved) return {chat:saved,status:completed.value.status}
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
            if (status === 'committed' && input.beforePersist) return Promise.resolve(input.beforePersist(completed.chat)).then(() => completed.chat)
            return completed.chat
          }, metadata)
          return saved === undefined ? { chat: null, status: 'missing' } : { chat: saved, status }
        })
        options.lockEvent?.({ kind: 'released', sessionId: gameId, slot: slotOf(role), role: str(role), operationId: begun.value.operationId, status: str(outcome.status) })
        slotReleased(chatId)
        // The story moved on while the agent ran: its result was dropped, not saved.
        if (outcome.status === 'stale') options.discarded?.({ sessionId: gameId, role: str(role), agentSessionId: str(input.participant?.sessionId) })
        return outcome
      },
      async fail(trace) {
        // Failing marks the operation only: commit it through the header. A role whose
        // failure writes more (settlement status) falls back to the whole-Chat update.
        return task.commit({ status: 'failed', stateChanged: false, participant: task.participant(trace), headerFields: [] })
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
      if ((store.readRecoveryState || store.readState) && !options.operationId) {
        const state = await (store.readRecoveryState || store.readState)(chatId)
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
      const expected = options.expectedState
      if (expected && (source.timeline?.branchId !== expected.branchId
        || source.timeline?.revision !== expected.revision
        || Number(source.tavernHelperLifecycleRevision || 0) !== expected.lifecycleRevision
        || activity(source).phase !== expected.phase)) {
        return { chat: source, status: 'stale', activity: activity(source) }
      }
      if (options.operationId && activity(source).operationId !== options.operationId) {
        return { chat: source, status: 'stale', activity: activity(source) }
      }
      const next = timeline.apply({ chat: source, intent: { kind: 'background.recover', cancelDelivery: Boolean(options.operationId) } })
      if (next.value.status !== 'unchanged') { await store.writeChat(next.chat, { source: 'background.recover' }); slotReleased(chatId) }
      return { chat: next.chat, status: next.value.status, activity: activity(next.chat) }
    })
  }

  return Object.freeze({ activity, operation, begin, recover, exclusive: serialize })
}
