import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'
import { randomUUID } from 'node:crypto'
import { runtimePresetPhaseMessages } from './domain/runtime-preset-lifecycle.js'
import { ensureSessionStablePrefix, readSessionStablePrefix } from './domain/session-stable-prefix.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function messageText(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : []
  return blocks.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('')
}

function backgroundPrompt(messages, turnContext, task, taskProtocol, input = {}) {
  const sections = []
  if (task === 'candidate' && str(input.systemPromptText).trim()) {
    sections.push('【人物卡系统提示】\n' + str(input.systemPromptText).trim())
  }
  const authoritative = str(turnContext).trim()
  if (authoritative !== '') {
    sections.push('【本轮权威状态】\n以下内容是当前最新状态；若与后台会话中的旧游标、姿势或指导冲突，以本节为准。\n' + authoritative)
  }
  const recent = (messages || []).map(function (message) {
    const role = message && message.role === 'assistant' ? '正文' : '用户'
    return '[' + role + ']\n' + messageText(message)
  }).filter(function (text) { return text.trim() !== '' }).join('\n\n')
  const taskName = task === 'settlement' ? '状态结算' : '候选生成'
  sections.push('【最近剧情与本次任务】\n任务类型：' + taskName + '\n' + recent)
  const protocol = str(taskProtocol).trim()
  if (protocol !== '') sections.push('【DSH 后台任务协议（最终指令）】\n' + protocol)
  if (task === 'candidate' && str(input.postHistoryText).trim()) {
    sections.push('【人物卡历史后指令】\n' + str(input.postHistoryText).trim())
  }
  return sections.join('\n\n')
}

function finalMessage(events, startAt) {
  for (let index = (events || []).length - 1; index >= Math.max(0, Number(startAt) || 0); index--) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
    const content = event.data && event.data.message && Array.isArray(event.data.message.content) ? event.data.message.content : []
    const text = content.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('').trim()
    if (text !== '') return { text, event, index: Number.isSafeInteger(event.seq) ? event.seq : index }
  }
  return null
}


function terminalError(events, startAt) {
  for (let index = (events || []).length - 1; index >= Math.max(0, Number(startAt) || 0); index--) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'turn/end') continue
    const reason = event.data && event.data.reason
    if (reason !== null && typeof reason === 'object' && reason.kind === 'max-tokens') {
      return new Error('后台 Agent 输出达到模型 token 上限，正式结果尚未生成')
    }
    if (reason === null || typeof reason !== 'object' || reason.kind !== 'error') continue
    const detail = reason.error
    const message = str(detail && detail.message || detail).trim()
    if (message !== '') return new Error(message)
  }
  return null
}

export function maximumBackgroundTokens(selection) {
  const provider = str(selection && selection.provider).trim().toLowerCase()
  const model = str(selection && selection.model).trim().toLowerCase()
  if (provider === 'deepseek-official' && (model === 'deepseek-v4-flash' || model === 'deepseek-v4-pro')) return 384000
  return undefined
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

function traceError(error, traceSessionId, task) {
  const fallback = task === 'settlement' ? '后台状态结算失败' : '后台候选生成失败'
  const wrapped = new Error(str(error && error.message || error) || fallback, { cause: error })
  wrapped.traceSessionId = traceSessionId
  return wrapped
}

export function createBackgroundAgentRunner(options) {
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

  function completedBoundary(events) {
    for (let index = (events || []).length - 1; index >= 0; index--) {
      const event = events[index]
      if (event && event.type === 'turn/end' && Number.isSafeInteger(event.seq)) return event.seq
    }
    return null
  }

  function rewindSurface(session, boundary) {
    if (!Number.isSafeInteger(boundary)) return 0
    const events = Array.isArray(session && session.events) ? session.events : []
    const nodes = session && session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
    const shadowed = nodes.filter(function (seq) { return Number.isSafeInteger(seq) && seq > boundary })
    if (shadowed.length === 0) return 0
    let source = null
    let turn = 0
    let step = 1
    for (let index = nodes.length - 1; index >= 0; index--) {
      const event = events[nodes[index]]
      const candidate = event && event.data && event.data.message && event.data.message.source
      if (event && event.type === 'assistant/message' && candidate && candidate.kind === 'model') {
        source = candidate
        turn = Math.max(0, Number(event.data.turn) || 0)
        step = Math.max(1, Number(event.data.step) || 1)
        break
      }
    }
    if (source === null) throw new Error('后台 Agent checkpoint 之后存在消息，但找不到可用的模型来源')
    session.append('assistant/message', {
      turn,
      step,
      message: { id: randomUUID(), role: 'assistant', content: [], source }
    }, {
      surfaceOp: { op: 'replace', start: shadowed[0], end: shadowed[shadowed.length - 1] },
      sourceEventSeqs: shadowed
    })
    return shadowed.length
  }

  function descriptorFor(input, persistent) {
    if (!persistent) return snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'dsh-tavern-background', label: '候选研究' })
    return snapshotSubagentDescriptor({
      mode: 'continuable',
      provider: 'dsh-tavern-background',
      label: '酒馆后台 Agent',
      agentProvider: input.selection.provider,
      agentModel: input.selection.model,
      persona: '共享剧情背景，承担世界书召回、状态结算与候选生成任务。'
    })
  }

  function setupFor(state, descriptor, appendDescriptor) {
    const backgroundPersona = '你是与前台正文生成隔离的酒馆后台 Agent。你会在同一个剧情分支中依次承担状态结算与候选生成；严格按本轮任务输出，不得把某类任务的输出格式混入另一类任务。最新权威状态优先于 Session 中的旧动态状态。\n\n【本轮任务规则】\n{{tavern_background_task}}'
    let descriptorAppended = !appendDescriptor
    return async function (childCtx) {
      if (setupAgent !== null) await setupAgent(childCtx)
      state.ctx = childCtx
      childCtx.on('agent/pre-step', async function ({ agent, turn, step }, next) {
        const decision = await next()
        if (!descriptorAppended && decision.kind === 'enter') {
          descriptorAppended = true
          agent.session.append('subagent/descriptor', descriptor)
        }
        if (decision.kind !== 'enter') return decision
        const input = state.input || {}
        const snapshot = typeof options.resolveRuntimePresetSnapshot === 'function'
          ? await options.resolveRuntimePresetSnapshot({ sessionId: input.sessionId, operation: input.task || 'background' })
          : null
        const messageOptions = { scope: 'background', turn, step }
        if (typeof options.stageRuntimePresetSnapshot === 'function') {
          options.stageRuntimePresetSnapshot({ sessionId: agent.session.id, turn, step, snapshot, scope: 'background' })
        }
        const middleMessages = Number(step) === 1 ? runtimePresetPhaseMessages(snapshot, 'middle', messageOptions) : []
        return middleMessages.length === 0 ? decision : Object.assign({}, decision, {
          messages: middleMessages.concat(decision.messages)
        })
      })
      childCtx.systemPrompt.variable('tavern_background_task', function () { return str(state.input && state.input.system) })
      childCtx.systemPrompt.section({
        name: 'deployment:persona',
        order: 0,
        complete: true,
        text: backgroundPersona
      })
      childCtx.systemPrompt.suppressRuntimeContext()
      childCtx.tools.restrict({ allow: [] })
      childCtx.on('agent/request', async function (_payload, next) {
        const input = state.input || {}
        const request = await next()
        if (typeof input.temperature !== 'number' || input.selection && input.selection.provider === 'openai-codex') return request
        return Object.assign({}, request, { temperature: input.temperature })
      })
    }
  }

  function installTaskTools(state, input) {
    const tools = Array.isArray(input.tools) ? input.tools : []
    const maxToolCalls = Number.isInteger(input.maxToolCalls) && input.maxToolCalls > 0 ? input.maxToolCalls : 8
    let toolCallCount = 0
    const disposers = tools.map(function (tool) {
      return state.ctx.tools.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          output: {
            schema: { type: 'string' },
            render: function (_args, value) { return [{ type: 'text', text: value }] }
          },
          async execute(args) {
            if (tool.countsTowardLimit !== false) {
              toolCallCount++
              if (toolCallCount > maxToolCalls) {
                return JSON.stringify({ message: '已达到剧本查询上限，请停止查询，基于已有材料开始推理并输出最终候选。' })
              }
            }
            return str(await input.onToolCall({ name: tool.name, arguments: args }))
          }
        })
    }).filter(function (dispose) { return typeof dispose === 'function' })
    return async function () {
      for (let index = disposers.length - 1; index >= 0; index--) await disposers[index]()
    }
  }

  async function execute(input) {
    const parent = agents.get(input.sessionId)
    if (parent === undefined || parent.session === undefined) throw new Error('无法创建后台 Agent：前台会话不可用')
    const runtimeInput = Object.assign({}, input)
    const persistent = input.persistent === true
    const requestedSessionId = str(input.persistentSessionId)
    const residentSessionId = str(residentSessionByParent.get(str(input.sessionId)))
    const traceSessionId = requestedSessionId || (persistent ? residentSessionId : '') || makeId()
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
    if (resident !== undefined && resident.parentSessionId !== str(input.sessionId)) {
      throw new Error('同一个常驻后台 Agent 不能绑定到不同前台会话')
    }
    let handle = resident && resident.handle
    let state = resident && resident.state
    if (handle === undefined) {
      state = { input: runtimeInput, ctx: null }
      try {
        if (requestedSessionId !== '') {
          if (typeof agents.resume !== 'function') throw new Error('当前 DSH 不支持恢复持久后台 Agent')
          handle = await agents.resume({
            resumeSessionId: traceSessionId,
            agentOptions,
            setup: setupFor(state, descriptor, false)
          })
        } else {
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
            setup: setupFor(state, descriptor, true)
          })
        }
      } catch (error) {
        throw traceError(error, traceSessionId, input.task)
      }
      if (persistent) {
        resident = { handle, state, parentSessionId: str(input.sessionId) }
        residentHandles.set(traceSessionId, resident)
        residentSessionByParent.set(str(input.sessionId), traceSessionId)
      }
    }
    state.input = runtimeInput
    rewindSurface(handle.agent.session, input.rewindTo)
    activeSessions.add(traceSessionId)
    requestSessions.set(traceSessionId, handle.agent.session)
    requestContexts.set(traceSessionId, {
      scope: 'background',
      parentSessionId: str(input.sessionId),
      task: str(input.task) || 'background',
      turn: Math.max(0, Number(input.turn) || 0)
    })
    const removeTaskTools = installTaskTools(state, runtimeInput)

    try {
      if (!readSessionStablePrefix(handle.agent.session)) {
        const background = typeof options.resolveStablePrefix === 'function'
          ? await options.resolveStablePrefix(input) : input.backgroundContext
        const prefix = ensureSessionStablePrefix(handle.agent.session, background)
        if (prefix && typeof options.flushSession === 'function') await options.flushSession(handle.agent.session)
      }
      const eventStart = Array.isArray(handle.agent.session.events) ? handle.agent.session.events.length : 0
      handle.agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: backgroundPrompt(input.messages, input.turnContext, input.task, input.system, input) }],
        source: { kind: 'plugin', plugin: 'dsh-tavern' }
      })
      await handle.agent.whenIdle()
      const rawResult = finalMessage(handle.agent.session.events, eventStart)
      if (rawResult === null) {
        const underlying = terminalError(handle.agent.session.events, eventStart)
        if (underlying !== null) throw underlying
        throw new Error(input.task === 'settlement' ? '后台 Agent 没有返回结算文本' : '后台 Agent 没有返回候选文本')
      }
      const text = rawResult.text.trim()
      return { text, traceSessionId, persistent, traceBoundary: completedBoundary(handle.agent.session.events) }
    } catch (error) {
      throw traceError(error, traceSessionId, input.task)
    } finally {
      await removeTaskTools()
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
