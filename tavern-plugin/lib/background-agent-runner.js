import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function messageText(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : []
  return blocks.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('')
}

function backgroundPrompt(messages, turnContext, task) {
  const sections = []
  const authoritative = str(turnContext).trim()
  if (authoritative !== '') {
    sections.push('【本轮权威状态】\n以下内容是当前最新状态；若与后台会话中的旧游标、姿势或指导冲突，以本节为准。\n' + authoritative)
  }
  const recent = (messages || []).map(function (message) {
    const role = message && message.role === 'assistant' ? '正文' : '用户'
    return '[' + role + ']\n' + messageText(message)
  }).filter(function (text) { return text.trim() !== '' }).join('\n\n')
  sections.push('【最近剧情与本次任务】\n任务类型：' + (task === 'settlement' ? '状态结算' : '候选生成') + '\n' + recent)
  return sections.join('\n\n')
}

function finalText(events, startAt) {
  for (let index = (events || []).length - 1; index >= Math.max(0, Number(startAt) || 0); index--) {
    const event = events[index]
    if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
    const content = event.data && event.data.message && Array.isArray(event.data.message.content) ? event.data.message.content : []
    const text = content.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('').trim()
    if (text !== '') return text
  }
  return ''
}

function traceError(error, traceSessionId, task) {
  const wrapped = new Error(str(error && error.message || error) || (task === 'settlement' ? '后台状态结算失败' : '后台候选生成失败'), { cause: error })
  wrapped.traceSessionId = traceSessionId
  return wrapped
}

export function createBackgroundAgentRunner(options) {
  if (options === null || typeof options !== 'object' || options.agents === undefined) throw new Error('缺少 DSH Agent 运行环境')
  const agents = options.agents
  const makeId = typeof options.id === 'function' ? options.id : function () { return 'background-' + crypto.randomUUID() }
  const activeSessions = new Set()
  const queues = new Map()

  function completedBoundary(events) {
    for (let index = (events || []).length - 1; index >= 0; index--) {
      const event = events[index]
      if (event && event.type === 'turn/end' && Number.isSafeInteger(event.seq)) return event.seq
    }
    return null
  }

  async function forkSeed(input, agentOptions) {
    const source = input.forkFrom
    if (source === null || typeof source !== 'object' || str(source.sessionId) === '' || !Number.isSafeInteger(source.boundary)) return null
    if (typeof agents.resume !== 'function') throw new Error('当前 DSH 不支持从剧情 checkpoint 派生后台 Agent')
    let handle
    try {
      handle = await agents.resume({ resumeSessionId: str(source.sessionId), agentOptions })
      const events = Array.isArray(handle.agent.session.events) ? handle.agent.session.events : []
      const seed = events.filter(function (event) { return Number(event && event.seq) <= source.boundary })
      if (seed.length === 0 || completedBoundary(seed) !== source.boundary) throw new Error('后台 Agent checkpoint 不是完整回合边界')
      return JSON.parse(JSON.stringify(seed))
    } finally {
      if (handle !== undefined) await handle.dispose()
    }
  }

  function descriptorFor(input, persistent) {
    if (!persistent) return snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'dsh-tavern-background', label: '候选研究' })
    return snapshotSubagentDescriptor({
      mode: 'continuable',
      provider: 'dsh-tavern-background',
      label: '酒馆后台 Agent',
      agentProvider: input.selection.provider,
      agentModel: input.selection.model,
      persona: '共享剧情背景，承担状态结算与候选生成任务。'
    })
  }

  function setupFor(input, descriptor, appendDescriptor) {
    const tools = Array.isArray(input.tools) ? input.tools : []
    const maxToolCalls = Number.isInteger(input.maxToolCalls) && input.maxToolCalls > 0 ? input.maxToolCalls : 8
    let toolCallCount = 0
    let descriptorAppended = !appendDescriptor
    return function (childCtx) {
      childCtx.on('agent/pre-step', async function ({ agent }, next) {
        const decision = await next()
        if (!descriptorAppended && decision.kind === 'enter') {
          descriptorAppended = true
          agent.session.append('subagent/descriptor', descriptor)
        }
        return decision
      })
      childCtx.systemPrompt.section({
        name: 'deployment:persona',
        order: 0,
        complete: true,
        text: '你是与前台正文生成隔离的酒馆后台 Agent。你会在同一个剧情分支中依次承担状态结算与候选生成；严格按本轮任务输出，不得把某类任务的输出格式混入另一类任务。最新权威状态优先于 Session 中的旧动态状态。\n\n【本轮任务规则】\n' + str(input.system)
      })
      childCtx.systemPrompt.suppressRuntimeContext()
      childCtx.tools.restrict({ allow: [] })
      if (typeof input.temperature === 'number' && input.selection.provider !== 'openai-codex') {
        childCtx.on('agent/request', async function (_payload, next) {
          return Object.assign({}, await next(), { temperature: input.temperature })
        })
      }
      for (const tool of tools) {
        childCtx.tools.register({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          output: {
            schema: { type: 'string' },
            render: function (_args, value) { return [{ type: 'text', text: value }] }
          },
          async execute(args) {
            toolCallCount++
            if (toolCallCount > maxToolCalls) {
              return JSON.stringify({ message: '已达到剧本查询上限，请停止查询，基于已有材料开始推理并输出最终候选。' })
            }
            return str(await input.onToolCall({ name: tool.name, arguments: args }))
          }
        })
      }
    }
  }

  async function execute(input) {
    const parent = agents.get(input.sessionId)
    if (parent === undefined || parent.session === undefined) throw new Error('无法创建后台 Agent：前台会话不可用')
    const persistent = input.persistent === true
    const requestedSessionId = str(input.persistentSessionId)
    const traceSessionId = requestedSessionId || makeId()
    const descriptor = descriptorFor(input, persistent)
    const parentDepth = Number(parent.session.header && parent.session.header.delegationDepth)
    const agentOptions = {
      provider: input.selection.provider,
      model: input.selection.model,
      maxTokens: Number(input.maxTokens) || 4000,
      ...(input.selection.reasoningEffort === undefined ? {} : { reasoningEffort: input.selection.reasoningEffort })
    }
    let handle
    try {
      if (requestedSessionId !== '') {
        if (typeof agents.resume !== 'function') throw new Error('当前 DSH 不支持恢复持久后台 Agent')
        handle = await agents.resume({
          resumeSessionId: traceSessionId,
          agentOptions,
          setup: setupFor(input, descriptor, false)
        })
      } else {
        const seed = await forkSeed(input, agentOptions)
        const meta = {
          parentSession: parent.id,
          origin: 'subagent',
          delegationDepth: Number.isSafeInteger(parentDepth) && parentDepth >= 0 ? parentDepth + 1 : 1,
          ...(seed === null ? {} : { seedLength: seed.length })
        }
        const cwd = str(parent.session.header && parent.session.header.cwd)
        if (cwd !== '') meta.cwd = cwd
        handle = await agents.create({
          sessionId: traceSessionId,
          meta,
          ...(seed === null ? {} : { seed }),
          agentOptions,
          setup: setupFor(input, descriptor, seed === null)
        })
      }
    } catch (error) {
      throw traceError(error, traceSessionId, input.task)
    }
    activeSessions.add(traceSessionId)

    try {
      const eventStart = Array.isArray(handle.agent.session.events) ? handle.agent.session.events.length : 0
      handle.agent.followup({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: backgroundPrompt(input.messages, input.turnContext, input.task) }],
        source: { kind: 'plugin', plugin: 'dsh-tavern' }
      })
      await handle.agent.whenIdle()
      const text = finalText(handle.agent.session.events, eventStart)
      if (text === '') throw new Error(input.task === 'settlement' ? '后台 Agent 没有返回结算文本' : '后台 Agent 没有返回候选文本')
      return { text, traceSessionId, persistent, traceBoundary: completedBoundary(handle.agent.session.events) }
    } catch (error) {
      throw traceError(error, traceSessionId, input.task)
    } finally {
      try {
        await handle.dispose()
      } finally {
        activeSessions.delete(traceSessionId)
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
    return activeSessions.has(str(sessionId))
  }

  return Object.freeze({ run, owns })
}
