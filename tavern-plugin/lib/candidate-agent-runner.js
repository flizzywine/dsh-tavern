import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function messageText(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : []
  return blocks.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('')
}

function candidatePrompt(messages, turnContext) {
  const sections = []
  const authoritative = str(turnContext).trim()
  if (authoritative !== '') {
    sections.push('【本轮权威状态】\n以下内容是当前最新状态；若与候选会话中的旧游标、姿势或指导冲突，以本节为准。\n' + authoritative)
  }
  const recent = (messages || []).map(function (message) {
    const role = message && message.role === 'assistant' ? '正文' : '用户'
    return '[' + role + ']\n' + messageText(message)
  }).filter(function (text) { return text.trim() !== '' }).join('\n\n')
  sections.push('【最近剧情与本次任务】\n' + recent)
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

function traceError(error, traceSessionId) {
  const wrapped = new Error(str(error && error.message || error) || '候选 Agent 运行失败', { cause: error })
  wrapped.traceSessionId = traceSessionId
  return wrapped
}

export function createCandidateAgentRunner(options) {
  if (options === null || typeof options !== 'object' || options.agents === undefined) throw new Error('缺少 DSH Agent 运行环境')
  const agents = options.agents
  const makeId = typeof options.id === 'function' ? options.id : function () { return 'candidate-' + crypto.randomUUID() }
  const activeSessions = new Set()
  const persistentSessions = new Map()
  const queues = new Map()

  function descriptorFor(input, persistent) {
    if (!persistent) return snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'dsh-tavern-candidate', label: '候选研究' })
    return snapshotSubagentDescriptor({
      mode: 'continuable',
      provider: 'dsh-tavern-candidate',
      label: '剧情候选 Agent',
      agentProvider: input.selection.provider,
      agentModel: input.selection.model,
      persona: str(input.system)
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
        text: str(input.system) + '\n\n你是与正文隔离的剧情候选 Agent。每次收到新正文与本轮权威状态后，研究并输出这一轮的最终候选；不要假装尚未出现在最新正文中的事件已经发生。'
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
    if (parent === undefined || parent.session === undefined) throw new Error('无法为候选项创建独立 Agent：正文会话不可用')
    const persistent = input.persistent === true
    const remembered = persistentSessions.get(input.sessionId)
    const requestedSessionId = str(input.persistentSessionId) || str(remembered)
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
        if (typeof agents.resume !== 'function') throw new Error('当前 DSH 不支持恢复持久候选 Agent')
        handle = await agents.resume({
          resumeSessionId: traceSessionId,
          agentOptions,
          setup: setupFor(input, descriptor, false)
        })
      } else {
        const meta = {
          parentSession: parent.id,
          origin: 'subagent',
          delegationDepth: Number.isSafeInteger(parentDepth) && parentDepth >= 0 ? parentDepth + 1 : 1
        }
        const cwd = str(parent.session.header && parent.session.header.cwd)
        if (cwd !== '') meta.cwd = cwd
        handle = await agents.create({
          sessionId: traceSessionId,
          meta,
          agentOptions,
          setup: setupFor(input, descriptor, true)
        })
      }
    } catch (error) {
      throw traceError(error, traceSessionId)
    }
    activeSessions.add(traceSessionId)
    if (persistent) persistentSessions.set(input.sessionId, traceSessionId)

    try {
      const eventStart = Array.isArray(handle.agent.session.events) ? handle.agent.session.events.length : 0
      handle.agent.followup({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: candidatePrompt(input.messages, input.turnContext) }],
        source: { kind: 'plugin', plugin: 'dsh-tavern' }
      })
      await handle.agent.whenIdle()
      const text = finalText(handle.agent.session.events, eventStart)
      if (text === '') throw new Error('候选 Agent 没有返回最终文本')
      return { text, traceSessionId, persistent }
    } catch (error) {
      throw traceError(error, traceSessionId)
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
