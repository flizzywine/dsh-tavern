import { sessionEvents } from './domain/session-events.js'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { randomUUID } from 'node:crypto'
import { maximumBackgroundTokens, traceError } from './background-agent-task.js'
import { createBackgroundRunLedger } from './background-run-ledger.js'

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
      if (sessionEvents(parent.session).some(event => event.type === 'subagent/catalog' && event.data?.childId === id)) return
      parent.session.append('subagent/catalog', { version: 0, childId: id, childCreatedAt: Math.max(0, Math.floor(Number(child.header.createdAt) || now())), mode: descriptor.mode, label: descriptor.label })
      options.onCreated?.(id, str(parent.id))
    } catch (error) {
      catalogued.delete(id)
      console.warn('dsh-tavern: 后台 Agent 未能登记到会话的子智能体列表', error?.message || error)
    }
  }
  const residentSessionByParent = new Map()
  const runs = createBackgroundRunLedger({ now: options.now })
  const queues = new Map()
  const conversations = new Map()

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

  function queueKey(input) {
    return input.task === 'polish' ? JSON.stringify([str(input.sessionId), 'polish']) : str(input.sessionId)
  }

  function residentKey(input) {
    return JSON.stringify([str(input.sessionId), input.task === 'polish' ? 'polish' : 'background'])
  }

  async function releaseSuperseded(key) {
    for (const [id, resident] of residentHandles) {
      if (resident.key !== key || residentSessionByParent.get(key) === id || activeSessions.has(id)) continue
      if ((resident.retryAt || 0) <= now()) await releaseResident(id, resident)
    }
  }

  function descriptorFor(input, persistent) {
    if (input.task === 'polish') return snapshotSubagentDescriptor({ mode: 'continuable', provider: 'dsh-tavern-polish', label: '正文精修', agentProvider: input.selection.provider, agentModel: input.selection.model, persona: '只审读正文，通过精修工具逐处提交修改。' })
    if (input.task === 'stage-director') return snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'dsh-tavern-stage', label: '舞台导演' })
    if (input.task === 'phone') return snapshotSubagentDescriptor({
      mode: 'one-shot', provider: 'dsh-tavern-phone', label: '手机私聊',
      persona: '只扮演指定联系人回复一条手机私聊，不推进正文或修改游戏状态。'
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
    if (options.resolveModelSelection && input.task !== 'phone') {
      input = { ...input, selection: await options.resolveModelSelection(input) }
    }
    input.runRecord?.start(input.selection)
    const parent = agents.get(input.sessionId)
    if (parent === undefined || parent.session === undefined) throw new Error('无法创建后台 Agent：前台会话不可用')
    const runtimeInput = Object.assign({}, input)
    runtimeInput.worldbookSkillsEnabled = !['phone', 'stage-director', 'polish'].includes(input.task) && Boolean(await options.resolveWorldbookSkills?.(input))
    // The game's web search setting, unless the task rules it out (style reference, worldbook
    // filter: paid, slow, and what they look for is not on the open web).
    if (options.resolveWebSearch && !['phone', 'polish'].includes(input.task) && input.webSearchEnabled !== false) {
      runtimeInput.webSearchEnabled = await options.resolveWebSearch(input)
    }
    const persistent = input.persistent === true
    const startOver = input.newSession === true || input.startOverAfterRewindFailure === true
    const requestedSessionId = startOver ? '' : str(persistent && typeof input.resolvePersistentSessionId === 'function'
      ? await input.resolvePersistentSessionId() : input.persistentSessionId)
    const key = residentKey(input)
    const needsSession = persistent && input.task !== 'polish' && typeof options.needsNewBackgroundSession === 'function'
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
      state = { input: runtimeInput, ctx: null }
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
            const savedDescriptor = sessionEvents(session).find(event => event.type === 'subagent/descriptor')?.data
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
          state = { input: runtimeInput, ctx: null }
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
          handle.agent.session.append('subagent/descriptor', descriptor)
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
    state.input = runtimeInput
    if (state.modelSelection) state.modelSelection.current = { ...input.selection }
    state.refreshConfiguredTools?.()
    activeSessions.add(traceSessionId)
    requestSessions.set(traceSessionId, handle.agent.session)
    requestContexts.set(traceSessionId, {
      scope: 'background',
      webSearchEnabled: !['phone', 'stage-director', 'polish'].includes(input.task) && runtimeInput.webSearchEnabled === true,
      parentSessionId: str(input.sessionId),
      selection: { ...input.selection },
      maxTokens,
      task: str(input.task) || 'background',
      turn: Math.max(0, Number(input.turn) || 0)
    })
    try {
      return await task.execute({ agent: handle.agent, state, traceSessionId, persistent }, input)
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
    if (input.task === 'worldbook-filter') return Promise.reject(new Error('独立世界书召回任务已停用，请在当前任务中按需搜索和读取'))
    if (stopped) return Promise.reject(new Error('后台 Agent 管理器已关闭'))
    const record = runs.begin(input)
    input = { ...input, runRecord: record }
    const work = input.persistent !== true ? execute(input) : enqueue(queueKey(input), () => {
      if (stopped) throw new Error('后台 Agent 管理器已关闭')
      return execute(input)
    })
    return work.then(result => { record.finish(); return result }, error => {
      record.fail(error, input.signal?.aborted === true || error?.name === 'AbortError')
      throw error
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
    clearTimeout(reapTimer)
    if (reaping) await reaping
    await Promise.allSettled([...releasing.values()])
    const residents = Array.from(residentHandles.values()).concat([...conversations.values()].filter(entry => entry.handle))
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

  function cancel(parentSessionId) {
    let count = 0
    for (const sessionId of activeSessions) {
      const context = requestContexts.get(sessionId)
      if (context?.parentSessionId !== parentSessionId || context.task === 'phone') continue
      const agent = residentHandles.get(sessionId)?.handle?.agent || agents.get(sessionId)
      const progress=residentHandles.get(sessionId)?.state.progress
      if (progress) { progress.cancel(); count++ }
      else if (typeof agent?.cancel === 'function') { agent.cancel({ kind: 'user' }); count++ }
    }
    return count
  }

  function progress(parentSessionId) {
    for(const id of activeSessions) if(requestContexts.get(id)?.parentSessionId===parentSessionId && requestContexts.get(id)?.task!=='phone') {
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
  return Object.freeze({ progress, runs: gameId => runs.list(gameId), run, conversation, owns, requestContext, activeRequestContext: id => activeSessions.has(str(id)) ? requestContext(id) : null, requestSession, compact, cancel, reapIdle, dispose, releaseFor })
}
