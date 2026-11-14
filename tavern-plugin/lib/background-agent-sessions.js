import { appendSessionEvent, matchesEventType, sessionEvents } from './domain/session-events.js'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { randomUUID } from 'node:crypto'
import { maximumBackgroundTokens, traceError } from './background-agent-task.js'
import { createBackgroundRunLedger } from './background-run-ledger.js'
import { memberOf, pluginMember } from './domain/background-members.js'
import { applyAgentModelSelection } from './domain/session-model-selection.js'

const LEGACY_BACKGROUND_PROVIDER = 'dsh-tavern-background'
const BACKGROUND_PROVIDER = 'dsh-tavern-background-tools-v4'
const STALE_BACKGROUND_PROVIDERS = new Set([
  LEGACY_BACKGROUND_PROVIDER,
  'dsh-tavern-background-tools-v1',
  'dsh-tavern-background-tools-v2',
  'dsh-tavern-background-tools-v3'
])

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function missingSession(error) {
  let current = error
  for (let depth = 0; current && depth < 5; depth++) {
    const code = str(current.code).trim().toUpperCase()
    if (code === 'ENOENT' || code === 'SESSION_NOT_FOUND') return true
    const message = str(current.message || current)
    if (/session\s+["'][^"']+["']\s+not found/i.test(message) || /会话[^\n]*不存在/.test(message)) return true
    current = current.cause
  }
  return false
}

export async function executeBackgroundCompaction(agent, signal) {
  const agentCtx = agent && agent.ctx
  const commands = agentCtx !== undefined && typeof agentCtx.get === 'function' ? agentCtx.get('commands') : undefined
  if (commands === undefined || typeof commands.execute !== 'function') {
    throw new Error('dsh-tavern: 当前 DSH 没有提供命令服务')
  }
  const execution = await commands.execute(agent, '/compact', [], signal)
  if (execution === undefined || execution.result === undefined) {
    throw new Error('dsh-tavern: 后台 Agent 没有提供 /compact 命令')
  }
  const result = execution.result
  if (result.kind !== 'success') {
    // The command result is intentionally generic; recover only this command's
    // persisted failure, never an earlier compaction attempt's diagnostic.
    const failure = execution.commandId && sessionEvents(agent.session).findLast(event =>
      event.type === 'compaction/end' && event.data?.sourceCommandId === execution.commandId && event.data?.error)
    throw new Error(str(result.text) || '后台压缩失败', failure ? { cause: new Error(str(failure.data.error)) } : undefined)
  }
  return { message: str(result.text) || '后台压缩完成' }
}

export function createBackgroundAgentSessions(options, task) {
  if (options === null || typeof options !== 'object' || options.agents === undefined) throw new Error('缺少 DSH Agent 运行环境')
  const agents = options.agents
  const compactAgent = typeof options.compactAgent === 'function' ? options.compactAgent : null
  const setupAgent = typeof options.setupAgent === 'function' ? options.setupAgent : null
  const agentPreset = str(options.agentPreset)
  const makeId = typeof options.id === 'function' ? options.id : function () { return 'background-' + randomUUID() }
  const abandonedSessions = new Set()
  const activeSessions = new Set()
  const requestContexts = new Map()
  const requestSessions = new Map()
  const residentHandles = new Map()
  // Children already listed in their parent's subagent catalog, checked once per process.
  const catalogued = new Set()
  /**
   * List the worker in its game's subagent catalog, as DSH's own subagent runtime does when it
   * creates a child: the session header counts and lists children from these parent events.
   */
  function catalogChild(parent, child, descriptor) {
    const id = str(child?.header?.id)
    if (!id || catalogued.has(id) || typeof parent?.session?.append !== 'function') return
    catalogued.add(id)
    try {
      if (sessionEvents(parent.session).some(event => matchesEventType(event, 'subagent/catalog') && event.data?.childId === id)) return
      appendSessionEvent(parent.session, 'subagent/catalog', { version: 0, childId: id, childCreatedAt: Math.max(0, Math.floor(Number(child.header.createdAt) || now())), mode: descriptor.mode, label: descriptor.label })
      options.onCreated?.(id, str(parent.id))
    } catch (error) {
      catalogued.delete(id)
      console.warn('dsh-tavern: 后台 Agent 未能登记到会话的子智能体列表', error?.message || error)
    }
  }
  const residentSessionByParent = new Map()
  // One-shot tasks that continue one conversation over several runs (the streaming director's
  // windows of one round). The caller closes it; nothing is resumed after a restart.
  const conversations = new Map()
  const runs = createBackgroundRunLedger({ now: options.now })
  const queues = new Map()
  const preparing = new Map()
  // Tasks that run beside the game's background work (the stage director): a game-wide cancel and the
  // game's progress leave them alone; only a cancel naming the task stops them.
  const parallelTasks = new Set(options.parallelTasks || [])

  const now = typeof options.now === 'function' ? options.now : Date.now
  const idleMs = Number.isSafeInteger(options.residentIdleMs) && options.residentIdleMs > 0 ? options.residentIdleMs : 5 * 60 * 1000
  const maxResidents = Number.isSafeInteger(options.maxResidentSessions) && options.maxResidentSessions > 0 ? options.maxResidentSessions : 8
  const releasing = new Map()
  let reapTimer, reaping, stopped = false

  function scheduleReap() {
    clearTimeout(reapTimer)
    if (stopped || reaping) return
    const time = now()
    const delays = [...residentHandles.entries()].filter(([id, item]) => !activeSessions.has(id) && !queues.has(item.queueKey) && !releasing.has(id))
      .map(([, item]) => Math.max(0, (item.retryAt || 0) - time, residentHandles.size > maxResidents ? 0 : item.lastUsedAt + idleMs - time))
    if (!delays.length) return
    reapTimer = setTimeout(() => { void reapIdle().catch(error => console.warn('dsh-tavern: 空闲后台回收失败', error)) }, Math.min(...delays))
    reapTimer.unref?.()
  }

  async function releaseResident(id, resident) {
    if (releasing.has(id)) return releasing.get(id)
    const pending = Promise.resolve().then(async () => {
      try {
        resident.state.sharedRequest = null
        resident.state.sharedAnchor = null
        if (resident.state.sharedWork) {
          resident.state.progress?.cancel()
          await resident.state.sharedWork.catch(() => {})
        }
        if (typeof options.flushSession === 'function') await options.flushSession(resident.handle.agent.session)
        await resident.handle.dispose()
        if (residentHandles.get(id) === resident) {
          residentHandles.delete(id)
          requestSessions.delete(id)
          requestContexts.delete(id)
        }
      } catch (error) {
        // Keep ownership on failed durability/teardown and retry later, not in a hot loop.
        resident.retryAt = now() + 60000
        console.warn('dsh-tavern: 释放空闲后台 Agent 失败', id, error)
      }
    })
    releasing.set(id, pending)
    try { await pending } finally { if (releasing.get(id) === pending) releasing.delete(id) }
  }

  function reapIdle() {
    if (reaping) return reaping
    clearTimeout(reapTimer)
    reaping = (async () => {
      const candidates = [...residentHandles.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
      for (const [id, resident] of candidates) {
        if (stopped || queues.has(resident.queueKey) || activeSessions.has(id)) continue
        await enqueue(resident.queueKey, async () => {
          if (stopped || residentHandles.get(id) !== resident || activeSessions.has(id) || (resident.retryAt || 0) > now()) return
          const superseded = residentSessionByParent.get(resident.key) !== id
          if (superseded || residentHandles.size > maxResidents || now() - resident.lastUsedAt >= idleMs) await releaseResident(id, resident)
        })
      }
    })().finally(() => { reaping = null; scheduleReap() })
    return reaping
  }

  // The resident member a persistent task runs on (background-members.js): the plugin member it
  // names, else its built-in one, else 书记.
  function memberFor(input) {
    return (pluginMember(input.member) && input.member) || memberOf(input.task) || 'background'
  }

  // One queue per member: its tasks share one Session, so they run one at a time.
  function queueKey(input) {
    const member = memberFor(input)
    return member === 'background' ? str(input.sessionId) : JSON.stringify([str(input.sessionId), member])
  }

  function residentKey(input) {
    return JSON.stringify([str(input.sessionId), memberFor(input)])
  }

  async function releaseSuperseded(key) {
    for (const [id, resident] of residentHandles) {
      if (resident.key !== key || residentSessionByParent.get(key) === id || activeSessions.has(id)) continue
      if ((resident.retryAt || 0) <= now()) await releaseResident(id, resident)
    }
  }

  function descriptorFor(input, persistent) {
    const member = persistent ? pluginMember(input.member) : null
    if (member) return snapshotSubagentDescriptor({ mode: 'continuable', provider: 'dsh-tavern-plugin-member-v1', label: '插件成员：' + member.name })
    if (input.task === 'polish') return snapshotSubagentDescriptor({ mode: 'continuable', provider: 'dsh-tavern-polish', label: '正文精修', agentProvider: input.selection.provider, agentModel: input.selection.model, persona: '只审读正文，通过精修工具逐处提交修改。' })
    if (input.task === 'stage-director') return snapshotSubagentDescriptor({
      mode: 'one-shot', provider: 'dsh-tavern-stage-director', label: '舞台导演',
      persona: '独立处理已完成正文的增量演出，与变量和姿势任务并行；不改写剧情或变量。'
    })
    if (input.task === 'plugin') return snapshotSubagentDescriptor({ mode: 'one-shot', provider: LEGACY_BACKGROUND_PROVIDER, label: '插件任务' + (input.pluginName ? '：' + String(input.pluginName).slice(0, 60) : '') })
    if (!persistent) return snapshotSubagentDescriptor({ mode: 'one-shot', provider: LEGACY_BACKGROUND_PROVIDER, label: '候选研究' })
    return snapshotSubagentDescriptor({
      mode: 'continuable',
      provider: BACKGROUND_PROVIDER,
      label: '酒馆后台 Agent',
      agentProvider: input.selection.provider,
      agentModel: input.selection.model,
      persona: '共享剧情背景，承担世界书召回、状态结算与候选生成，并在当前任务需要时加载人物设计 Skill。'
    })
  }

  async function execute(input) {
    // Resolve after the queue admits this task, then keep that selection fixed
    // through every step of the task, even if the game setting changes meanwhile.
    if (options.resolveModelSelection) {
      input = { ...input, selection: await options.resolveModelSelection(input) }
    }
    input.runRecord?.start(input.selection)
    const parent = agents.get(input.sessionId)
    if (parent === undefined || parent.session === undefined) throw new Error('无法创建后台 Agent：前台会话不可用')
    if (typeof options.prepareSharedContext === 'function') {
      const controller = new AbortController()
      const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal
      preparing.set(controller, input)
      try {
        await options.prepareSharedContext({ ...input, signal })
        signal.throwIfAborted()
      } catch (error) {
        signal.throwIfAborted()
        console.warn('dsh-tavern: 共享后台准备失败', error?.message || error)
      } finally { preparing.delete(controller) }
    }
    const runtimeInput = Object.assign({}, input)
    // Read capabilities are an optional part of the task contract: a task without them runs as before.
    const readCapability = await task.resolveReadCapability?.(input) ?? null
    runtimeInput.worldbookSkillsEnabled = !['stage-director', 'polish'].includes(input.task) && input.ownPrefix !== true && Boolean(await options.resolveWorldbookSkills?.(input))
    // The game's web search setting, unless the task rules it out (style reference, worldbook
    // filter: paid, slow, and what they look for is not on the open web).
    if (options.resolveWebSearch && input.task !== 'polish' && input.ownPrefix !== true && input.webSearchEnabled !== false) {
      runtimeInput.webSearchEnabled = await options.resolveWebSearch(input)
    }
    const persistent = input.persistent === true
    const startOver = input.newSession === true || input.startOverAfterRewindFailure === true
    const requestedSessionId = startOver ? '' : str(persistent && typeof input.resolvePersistentSessionId === 'function'
      ? await input.resolvePersistentSessionId() : input.persistentSessionId)
    const key = residentKey(input)
    // Only 书记's Session is bound in the save and may need a fresh one after a rewind.
    const needsSession = persistent && memberFor(input) === 'background' && typeof options.needsNewBackgroundSession === 'function'
      && await options.needsNewBackgroundSession(input.sessionId)
    const residentSessionId = startOver || needsSession && requestedSessionId === '' ? '' : str(residentSessionByParent.get(key))
    let traceSessionId = requestedSessionId || (persistent ? residentSessionId : '') || makeId()
    const abandoned = abandonedSessions.has(traceSessionId) || Boolean(await options.retirement?.isRetired(traceSessionId))
    if (abandoned) traceSessionId = makeId()
    const descriptor = descriptorFor(input, persistent)
    const parentDepth = Number(parent.session.header && parent.session.header.delegationDepth)
    const requestedMaxTokens = Number(input.maxTokens)
    const maxTokens = Number.isSafeInteger(requestedMaxTokens) && requestedMaxTokens > 0
      ? requestedMaxTokens
      : maximumBackgroundTokens(input.selection)
    const agentOptions = {
      provider: input.selection.provider,
      model: input.selection.model,
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(input.selection.reasoningEffort === undefined ? {} : { reasoningEffort: input.selection.reasoningEffort })
    }
    const conversation = !persistent ? conversations.get(input.conversation) : undefined
    if (input.conversation !== undefined && !persistent && conversation === undefined) throw new Error('后台对话已结束')
    if (conversation?.handle) traceSessionId = conversation.traceSessionId
    let resident = persistent ? residentHandles.get(traceSessionId) : conversation?.handle ? conversation : undefined
    if (resident !== undefined && persistent && resident.key !== key) {
      throw new Error('同一个常驻后台 Agent 不能绑定到不同前台会话或任务类型')
    }
    let handle = resident && resident.handle
    let state = resident && resident.state
    if (handle === undefined) {
      state = { input: runtimeInput, ctx: null, readCapability }
      try {
        if (!abandoned && (requestedSessionId !== '' || (persistent && residentSessionId !== ''))) {
          if (typeof agents.resume !== 'function') throw new Error('当前 DSH 不支持恢复持久后台 Agent')
          try {
            handle = await agents.resume({
              resumeSessionId: traceSessionId,
              agentOptions,
              setup: task.setup(state, descriptor, false)
            })
          } catch (error) {
            if (!missingSession(error)) throw error
            handle = undefined
            traceSessionId = makeId()
          }
          if (handle !== undefined) {
            const session = handle.agent.session
            const savedDescriptor = sessionEvents(session).find(event => matchesEventType(event, 'subagent/descriptor'))?.data
            const savedParent = session.header?.parentSession
            if (savedParent && savedParent !== parent.id || savedDescriptor &&
              (savedDescriptor.provider === 'dsh-tavern-image' || (savedDescriptor.provider === 'dsh-tavern-polish') !== (input.task === 'polish'))) {
              await handle.dispose()
              throw new Error('持久后台 Agent 的父会话或任务类型不匹配，未创建替代会话')
            }
            if (savedDescriptor && STALE_BACKGROUND_PROVIDERS.has(savedDescriptor.provider)) {
              await handle.dispose()
              handle = undefined
              traceSessionId = makeId()
            }
          }
        }
        if (handle === undefined) {
          // A resumed handle may already have run setup before being discarded.
          // Tool registrations and their cache belong to that handle's context.
          state = { input: runtimeInput, ctx: null, readCapability }
          const meta = {
            parentSession: parent.id,
            origin: 'subagent',
            delegationDepth: Number.isSafeInteger(parentDepth) && parentDepth >= 0 ? parentDepth + 1 : 1,
            ...(agentPreset === '' ? {} : { agentPreset })
          }
          const cwd = str(parent.session.header && parent.session.header.cwd)
          if (cwd !== '') meta.cwd = cwd
          handle = await agents.create({
            sessionId: traceSessionId,
            meta,
            agentOptions,
            setup: task.setup(state, descriptor, false)
          })
          // Publish identity before the first model turn, including failed starts.
          appendSessionEvent(handle.agent.session, 'subagent/descriptor', descriptor)
        }
      } catch (error) {
        const wrapped = traceError(error, traceSessionId, input.task)
        if (handle === undefined) {
          wrapped.attemptedTraceSessionId = traceSessionId
          wrapped.traceSessionId = ''
        }
        throw wrapped
      }
      catalogChild(parent, handle.agent.session, descriptor)
      if (conversation) Object.assign(conversation, { handle, state, traceSessionId })
      if (persistent) {
        resident = { handle, state, parentSessionId: str(input.sessionId), key, queueKey: queueKey(input), lastUsedAt: now() }
        residentHandles.set(traceSessionId, resident)
        residentSessionByParent.set(key, traceSessionId)
      }
    }
    if ((state.readCapability?.key ?? null) !== (readCapability?.key ?? null)) {
      state.sharedRequest = null
      state.sharedAnchor = null
      for (const dispose of (state.stableToolDisposers || []).slice().reverse()) await dispose()
      state.stableToolDisposers = null
      state.readCapability = readCapability
    }
    state.input = runtimeInput
    if (state.modelSelection) state.modelSelection.current = { ...input.selection }
    // 0.2.2 installModelSelection no longer reads the caller's mutable selection:
    // it only adds the switch notice. A reused resident Agent keeps its old
    // model/selection event otherwise, so record the new one before its next step.
    applyAgentModelSelection(handle?.agent, input.selection)
    state.refreshConfiguredTools?.()
    activeSessions.add(traceSessionId)
    requestSessions.set(traceSessionId, handle.agent.session)
    requestContexts.set(traceSessionId, {
      scope: 'background',
      webSearchEnabled: !['stage-director', 'polish'].includes(input.task) && input.ownPrefix !== true && runtimeInput.webSearchEnabled === true,
      parentSessionId: str(input.sessionId),
      selection: { ...input.selection },
      maxTokens,
      operationId: str(input.operationId),
      ...(input.contextPolicy ? { contextPolicy: input.contextPolicy } : {}),
      ...(input.frozenBackground ? { frozenBackground: { policy: input.frozenBackground.policy, historical: input.frozenBackground.historical, binding: input.frozenBackground.binding } } : {}),
      task: str(input.task) || 'background',
      // Dev diagnostics: the streaming director window this request stages (request log).
      ...(input.window ? { window: { first: input.window.first, through: input.window.through } } : {}),
      turn: Math.max(0, Number(input.turn) || 0)
    })
    input.runRecord?.bind(traceSessionId)
    try {
      const result = await task.execute({ agent: handle.agent, state, traceSessionId, persistent }, {
        ...input,
        async onSharedContextUnavailable() {
          // Anchor resolution can revoke an optional binding after setup froze its tools.
          state.sharedRequest = null
          state.sharedAnchor = null
          if (!state.readCapability) return
          for (const dispose of (state.stableToolDisposers || []).slice().reverse()) await dispose()
          state.stableToolDisposers = null
          state.readCapability = null
          state.refreshConfiguredTools?.()
        }
      })
      if (state.sharedRequest && !state.abandoned && !input.signal?.aborted) {
        try {
          await task.checkReadCapability?.(state)
          input.capture.anchor = structuredClone(state.sharedRequest.anchor)
        } catch { /* Revocation suppresses readiness, not the completed normal task. */ }
      }
      return result
    } catch (error) {
      // Discarding all task history equals starting a new session. Some hosts
      // (an unpatched DSH) cannot replace surface messages; never strand every
      // later task on that. The old session is retired, not reused.
      if (error?.code !== 'BACKGROUND_REWIND_FAILED' || input.rewindTo !== -1 || !persistent || startOver) throw error
      console.warn('dsh-tavern: 后台历史无法回退，改用新的后台会话', traceSessionId, error.cause || error)
      state.abandoned = true
    } finally {
      activeSessions.delete(traceSessionId)
      if (state.abandoned) {
        // Never reuse a provider consumer that may ignore cancellation.
        abandonedSessions.add(traceSessionId)
        try { if (persistent) await options.retirement?.retire(traceSessionId, str(input.sessionId)) }
        catch (error) { console.warn('dsh-tavern: 后台会话退休状态保存失败', traceSessionId, error) }
        residentHandles.delete(traceSessionId)
        if (residentSessionByParent.get(key)===traceSessionId) residentSessionByParent.delete(key)
        requestContexts.delete(traceSessionId); requestSessions.delete(traceSessionId)
        if (conversation?.handle === handle) Object.assign(conversation, { handle: undefined, state: undefined })
        void Promise.resolve().then(async () => {
          try { await options.flushSession?.(handle.agent.session) }
          finally { await handle.dispose() }
          // Released: listings now leave it out, so the page may reload its session list.
          if (persistent) options.onRetired?.(traceSessionId, str(input.sessionId))
        }).catch(error => console.warn('dsh-tavern: 退休后台会话释放失败', traceSessionId, error))
      } else if (conversation && !conversation.closed) {
        // The next run of this conversation continues the same native session.
      } else if (!persistent) {
        requestContexts.delete(traceSessionId)
        requestSessions.delete(traceSessionId)
        await handle.dispose()
      } else { resident.lastUsedAt = now(); await releaseSuperseded(key) }
    }
    return execute({ ...input, persistentSessionId: '', resolvePersistentSessionId: undefined, startOverAfterRewindFailure: true })
  }

  function enqueue(key, work) {
    const previous = queues.get(key) || Promise.resolve()
    const current = previous.catch(function () {}).then(work)
    queues.set(key, current)
    return current.finally(function () {
      if (queues.get(key) === current) queues.delete(key)
      scheduleReap()
    })
  }

  function run(input) {
    if (stopped) return Promise.reject(new Error('后台 Agent 管理器已关闭'))
    const record = runs.begin({ ...input, member: input.persistent === true ? memberFor(input) : '' })
    input = { ...input, runRecord: record, capture: {} }
    const work = input.persistent !== true ? execute(input) : enqueue(queueKey(input), () => {
      if (stopped) throw new Error('后台 Agent 管理器已关闭')
      return execute(input)
    })
    // Every run's end is announced (任务完成), so other work can follow it.
    const finished = status => options.onRunFinished?.({ sessionId: str(input.sessionId), task: str(input.task), plugin: str(input.pluginName),
      member: input.persistent === true ? memberFor(input) : '', turn: Math.max(0, Number(input.turn) || 0), status,
      ...(status === 'completed' && input.capture.anchor ? { data: { sharedContext: { anchor: input.capture.anchor } } } : {}) })
    return work.then(result => { record.finish(); finished('completed'); return result }, error => {
      const cancelled = input.signal?.aborted === true || error?.name === 'AbortError'
      record.fail(error, cancelled)
      finished(cancelled ? 'cancelled' : 'failed')
      throw error
    })
  }

  // The resident background session's queue drained, and the anchor of its last captured shared request (or null).
  const idle = sessionId => (queues.get(str(sessionId)) || Promise.resolve()).catch(() => {})
  function sharedAnchor(sessionId) {
    const id = residentSessionByParent.get(JSON.stringify([str(sessionId), 'background']))
    const anchor = !releasing.has(id) && residentHandles.get(id)?.state?.sharedRequest?.anchor
    return anchor ? structuredClone(anchor) : null
  }
  async function runSharedTask({ sessionId, anchor, instruction, signal }) {
    if (typeof instruction !== 'string' || !instruction.trim()) throw new TypeError('instruction 必须是非空字符串')
    return enqueue(str(sessionId), async () => {
      signal?.throwIfAborted()
      if (stopped) throw new Error('后台 Agent 管理器已关闭')
      if (options.allowRun && !await options.allowRun({ sessionId, anchor })) {
        throw Object.assign(new Error('本局插件已关闭后台智能体'), { code: 'TAVERN_BACKGROUND_DISABLED' })
      }
      const id = residentSessionByParent.get(JSON.stringify([str(sessionId), 'background']))
      const resident = residentHandles.get(id)
      const state = resident?.state
      if (state) await task.checkReadCapability?.(state)
      const saved = !releasing.has(id) && state?.sharedRequest?.anchor
      if (!saved || !anchor || saved.branchId !== anchor.branchId || saved.turn !== anchor.turn || saved.textVersion !== anchor.textVersion) {
        throw Object.assign(new Error('没有与正文锚点匹配的共享后台请求快照'), { code: 'TAVERN_SHARED_SNAPSHOT_UNAVAILABLE' })
      }
      activeSessions.add(id)
      try {
        state.sharedWork = task.runSharedTask(state, { instruction, signal })
        return await state.sharedWork
      } finally {
        state.sharedWork = null
        activeSessions.delete(id)
        resident.lastUsedAt = now()
      }
    })
  }

  // An opaque token for run({conversation}); close() releases the native session once idle.
  function conversation() {
    const token = Object.freeze({ close: () => closeConversation(token) })
    conversations.set(token, { closed: false })
    return token
  }

  async function closeConversation(token) {
    const entry = conversations.get(token)
    if (!entry) return
    conversations.delete(token)
    entry.closed = true
    if (!entry.handle || activeSessions.has(entry.traceSessionId)) return
    requestContexts.delete(entry.traceSessionId)
    requestSessions.delete(entry.traceSessionId)
    await entry.handle.dispose()
  }

  function owns(sessionId) {
    const id = str(sessionId)
    return activeSessions.has(id) || residentHandles.has(id)
  }

  function requestContext(sessionId) {
    return requestContexts.get(str(sessionId)) || null
  }

  function requestSession(sessionId) {
    return requestSessions.get(str(sessionId)) || null
  }

  async function compact(input = {}) {
    const sessionId = str(input.sessionId)
    if (stopped) throw new Error('后台 Agent 管理器已关闭')
    if (releasing.has(sessionId)) await releasing.get(sessionId)
    if (sessionId === '') throw new Error('缺少后台 Session ID')
    if (compactAgent === null) throw new Error('当前 DSH 没有提供后台压缩能力')
    if (activeSessions.has(sessionId)) throw new Error('后台 Agent 正在执行任务，请等待完成后再压缩')
    const resident = residentHandles.get(sessionId)
    let handle = null
    let agent = resident && resident.handle && resident.handle.agent
    if (agent === undefined) agent = agents.get(sessionId)
    if (agent === undefined) {
      if (typeof agents.resume !== 'function') throw new Error('当前 DSH 不支持恢复后台 Agent 进行压缩')
      handle = await agents.resume({
        resumeSessionId: sessionId,
        ...(setupAgent === null ? {} : { setup: setupAgent })
      })
      agent = handle.agent
    }
    const signal = input.signal || new AbortController().signal
    activeSessions.add(sessionId)
    try {
      if (typeof agent.whenIdle === 'function') await agent.whenIdle()
      return await compactAgent(agent, signal)
    } finally {
      try {
        if (handle !== null) await handle.dispose()
      } finally {
        activeSessions.delete(sessionId)
        if (resident) { resident.lastUsedAt = now(); await releaseSuperseded(resident.key) }
        scheduleReap()
      }
    }
  }

  async function dispose() {
    stopped = true
    for (const controller of preparing.keys()) controller.abort()
    clearTimeout(reapTimer)
    if (reaping) await reaping
    await Promise.allSettled([...releasing.values()])
    const residents = Array.from(residentHandles.values()).concat([...conversations.values()].filter(entry => entry.handle))
    for (const resident of residents) {
      resident.state.sharedRequest = null
      resident.state.sharedAnchor = null
      if (resident.state.sharedWork) resident.state.progress?.cancel()
    }
    await Promise.allSettled(residents.map(resident => resident.state.sharedWork))
    conversations.clear()
    residentHandles.clear()
    residentSessionByParent.clear()
    activeSessions.clear()
    requestContexts.clear()
    requestSessions.clear()
    const settled = await Promise.allSettled(residents.map(function (resident) { return resident.handle.dispose() }))
    const failures = settled.filter(function (result) { return result.status === 'rejected' }).map(function (result) { return result.reason })
    if (failures.length > 0) throw new AggregateError(failures, '常驻后台 Agent 释放失败')
  }

  // `task`: only that task's runs (停止选项 stops the choices, an interrupted turn its director);
  // without it every run of the game but the parallel tasks'.
  function cancel(parentSessionId, input = {}) {
    let count = 0
    for (const [controller, pending] of preparing) {
      if (pending.sessionId !== parentSessionId || (input.task ? pending.task !== input.task : parallelTasks.has(pending.task))) continue
      controller.abort(); count++
    }
    for (const [id, resident] of residentHandles) {
      const context = requestContexts.get(id)
      if (context?.parentSessionId !== parentSessionId || (input.task ? context.task !== input.task : parallelTasks.has(context.task))) continue
      resident.state.sharedRequest = null
      resident.state.sharedAnchor = null
    }
    for (const sessionId of activeSessions) {
      const context = requestContexts.get(sessionId)
      if (context?.parentSessionId !== parentSessionId || (input.task ? context.task !== input.task : parallelTasks.has(context.task))) continue
      const agent = residentHandles.get(sessionId)?.handle?.agent || agents.get(sessionId)
      const progress=residentHandles.get(sessionId)?.state.progress
      if (progress) { progress.cancel(); count++ }
      else if (typeof agent?.cancel === 'function') { agent.cancel({ kind: 'user' }); count++ }
    }
    return count
  }

  function progress(parentSessionId) {
    for(const id of activeSessions) if(requestContexts.get(id)?.parentSessionId===parentSessionId && !parallelTasks.has(requestContexts.get(id)?.task)) {
      const snapshot=residentHandles.get(id)?.state.progress?.snapshot()
      if(snapshot) return {...snapshot,task:requestContexts.get(id).task}
    }
    return null
  }

  // A deleted game must not keep resident agents that would write its sessions back to disk.
  async function releaseFor(parentSessionId) {
    const parent = str(parentSessionId)
    runs.forget(parent)
    for (const [id, resident] of Array.from(residentHandles)) {
      if (requestContexts.get(id)?.parentSessionId === parent || JSON.parse(resident.key)[0] === parent) await releaseResident(id, resident)
    }
  }
  return Object.freeze({ progress, runs: gameId => runs.list(gameId), discardRun: target => runs.discard(target), noteLock: event => runs.lock(event), locks: gameId => runs.locks(gameId), run, runSharedTask, idle, sharedAnchor, conversation, owns, requestContext, activeRequestContext: id => activeSessions.has(str(id)) ? requestContext(id) : null, requestSession, compact, cancel, reapIdle, dispose, releaseFor })
}
