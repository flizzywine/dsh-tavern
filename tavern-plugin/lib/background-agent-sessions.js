import { sessionEvents } from './domain/session-events.js'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { randomUUID } from 'node:crypto'
import { maximumBackgroundTokens, traceError } from './background-agent-task.js'

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
  if (result.kind !== 'success') throw new Error(str(result.text) || '后台压缩失败')
  return { message: str(result.text) || '后台压缩完成' }
}

export function createBackgroundAgentSessions(options, task) {
  if (options === null || typeof options !== 'object' || options.agents === undefined) throw new Error('缺少 DSH Agent 运行环境')
  const agents = options.agents
  const compactAgent = typeof options.compactAgent === 'function' ? options.compactAgent : null
  const setupAgent = typeof options.setupAgent === 'function' ? options.setupAgent : null
  const agentPreset = str(options.agentPreset)
  const makeId = typeof options.id === 'function' ? options.id : function () { return 'background-' + randomUUID() }
  const activeSessions = new Set()
  const requestContexts = new Map()
  const requestSessions = new Map()
  const residentHandles = new Map()
  const residentSessionByParent = new Map()
  const queues = new Map()

  function residentKey(input) {
    return JSON.stringify([str(input.sessionId), input.task === 'image' ? 'image' : 'background'])
  }

  function descriptorFor(input, persistent) {
    if (input.task === 'image') return snapshotSubagentDescriptor({
      mode: persistent ? 'continuable' : 'one-shot', provider: 'dsh-tavern-image', label: '场景生图',
      ...(persistent ? { agentProvider: input.selection.provider, agentModel: input.selection.model,
        persona: '维护本游戏的场景绘图方案，不续写故事、不修改变量。当前目标材料与保存的方案优先于旧任务。' } : {})
    })
    if (input.task === 'phone') return snapshotSubagentDescriptor({
      mode: 'one-shot', provider: 'dsh-tavern-phone', label: '手机私聊',
      persona: '只扮演指定联系人回复一条手机私聊，不推进正文或修改游戏状态。'
    })
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
    const parent = agents.get(input.sessionId)
    if (parent === undefined || parent.session === undefined) throw new Error('无法创建后台 Agent：前台会话不可用')
    const runtimeInput = Object.assign({}, input)
    const persistent = input.persistent === true
    const requestedSessionId = str(persistent && typeof input.resolvePersistentSessionId === 'function'
      ? await input.resolvePersistentSessionId() : input.persistentSessionId)
    const key = residentKey(input)
    const residentSessionId = str(residentSessionByParent.get(key))
    let traceSessionId = requestedSessionId || (persistent ? residentSessionId : '') || makeId()
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
    let resident = persistent ? residentHandles.get(traceSessionId) : undefined
    if (resident !== undefined && resident.key !== key) {
      throw new Error('同一个常驻后台 Agent 不能绑定到不同前台会话或任务类型')
    }
    let handle = resident && resident.handle
    let state = resident && resident.state
    if (handle === undefined) {
      state = { input: runtimeInput, ctx: null }
      try {
        if (requestedSessionId !== '') {
          if (typeof agents.resume !== 'function') throw new Error('当前 DSH 不支持恢复持久后台 Agent')
          try {
            handle = await agents.resume({
              resumeSessionId: traceSessionId,
              agentOptions,
              setup: task.setup(state, descriptor, false)
            })
          } catch (error) {
            if (input.task === 'image' || !missingSession(error)) throw error
            handle = undefined
            traceSessionId = makeId()
          }
          if (handle !== undefined) {
            const session = handle.agent.session
            const savedDescriptor = sessionEvents(session).find(event => event.type === 'subagent/descriptor')?.data
            const savedParent = session.header?.parentSession
            if (savedParent && savedParent !== parent.id || savedDescriptor &&
              (savedDescriptor.provider === 'dsh-tavern-image') !== (input.task === 'image')) {
              await handle.dispose()
              throw new Error('持久后台 Agent 的父会话或任务类型不匹配，未创建替代会话')
            }
            if (input.task !== 'image' && savedDescriptor && STALE_BACKGROUND_PROVIDERS.has(savedDescriptor.provider)) {
              await handle.dispose()
              handle = undefined
              traceSessionId = makeId()
            }
          }
        }
        if (handle === undefined) {
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
            setup: task.setup(state, descriptor, !(persistent && input.task === 'image'))
          })
          if (persistent && input.task === 'image') handle.agent.session.append('subagent/descriptor', descriptor)
        }
      } catch (error) {
        const wrapped = traceError(error, traceSessionId, input.task)
        if (handle === undefined) {
          wrapped.attemptedTraceSessionId = traceSessionId
          wrapped.traceSessionId = ''
        }
        throw wrapped
      }
      if (persistent) {
        resident = { handle, state, parentSessionId: str(input.sessionId), key }
        residentHandles.set(traceSessionId, resident)
        residentSessionByParent.set(key, traceSessionId)
      }
    }
    state.input = runtimeInput
    activeSessions.add(traceSessionId)
    requestSessions.set(traceSessionId, handle.agent.session)
    requestContexts.set(traceSessionId, {
      scope: 'background',
      parentSessionId: str(input.sessionId),
      task: str(input.task) || 'background',
      turn: Math.max(0, Number(input.turn) || 0)
    })
    try {
      return await task.execute({ agent: handle.agent, state, traceSessionId, persistent }, input)
    } finally {
      activeSessions.delete(traceSessionId)
      if (!persistent) {
        requestContexts.delete(traceSessionId)
        requestSessions.delete(traceSessionId)
        await handle.dispose()
      }
    }
  }

  function run(input) {
    if (input.persistent !== true) return execute(input)
    const key = str(input.sessionId)
    const previous = queues.get(key) || Promise.resolve()
    const current = previous.catch(function () {}).then(function () { return execute(input) })
    queues.set(key, current)
    return current.finally(function () {
      if (queues.get(key) === current) queues.delete(key)
    })
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
      }
    }
  }

  async function dispose() {
    const residents = Array.from(residentHandles.values())
    residentHandles.clear()
    residentSessionByParent.clear()
    activeSessions.clear()
    requestContexts.clear()
    requestSessions.clear()
    const settled = await Promise.allSettled(residents.map(function (resident) { return resident.handle.dispose() }))
    const failures = settled.filter(function (result) { return result.status === 'rejected' }).map(function (result) { return result.reason })
    if (failures.length > 0) throw new AggregateError(failures, '常驻后台 Agent 释放失败')
  }

  return Object.freeze({ run, owns, requestContext, requestSession, compact, dispose })
}
