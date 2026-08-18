import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function messageText(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : []
  return blocks.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('')
}

function candidatePrompt(messages) {
  return '【最近剧情与本次任务】\n' + (messages || []).map(function (message) {
    const role = message && message.role === 'assistant' ? '正文' : '用户'
    return '[' + role + ']\n' + messageText(message)
  }).filter(function (text) { return text.trim() !== '' }).join('\n\n')
}

function finalText(events) {
  for (let index = (events || []).length - 1; index >= 0; index--) {
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

  async function run(input) {
    const parent = agents.get(input.sessionId)
    if (parent === undefined || parent.session === undefined) throw new Error('无法为候选项创建独立 Agent：正文会话不可用')
    const traceSessionId = makeId()
    const tools = Array.isArray(input.tools) ? input.tools : []
    const maxToolCalls = Number.isInteger(input.maxToolCalls) && input.maxToolCalls > 0 ? input.maxToolCalls : 8
    const descriptor = snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'dsh-tavern-candidate', label: '候选研究' })
    let toolCallCount = 0
    let descriptorAppended = false
    const parentDepth = Number(parent.session.header && parent.session.header.delegationDepth)
    const meta = {
      parentSession: parent.id,
      origin: 'subagent',
      delegationDepth: Number.isSafeInteger(parentDepth) && parentDepth >= 0 ? parentDepth + 1 : 1
    }
    const cwd = str(parent.session.header && parent.session.header.cwd)
    if (cwd !== '') meta.cwd = cwd

    const handle = await agents.create({
      sessionId: traceSessionId,
      meta,
      agentOptions: {
        provider: input.selection.provider,
        model: input.selection.model,
        maxTokens: Number(input.maxTokens) || 4000,
        ...(input.selection.reasoningEffort === undefined ? {} : { reasoningEffort: input.selection.reasoningEffort })
      },
      setup: function (childCtx) {
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
          text: str(input.system) + '\n\n你是独立运行的候选项 Agent。按上述规则研究并生成候选；你的上下文和工具轨迹只保存在当前候选会话，不得假装已经发生尚未出现在最近剧情中的事件。'
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
            async execute(args, exec) {
              toolCallCount++
              if (toolCallCount > maxToolCalls) {
                exec.concludeTurn()
                return JSON.stringify({ error: '候选项研究工具调用次数已达上限，本次运行结束。' })
              }
              return str(await input.onToolCall({ name: tool.name, arguments: args }))
            }
          })
        }
      }
    })
    activeSessions.add(traceSessionId)

    try {
      handle.agent.followup({
        id: crypto.randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: candidatePrompt(input.messages) }],
        source: { kind: 'plugin', plugin: 'dsh-tavern' }
      })
      await handle.agent.whenIdle()
      const text = finalText(handle.agent.session.events)
      if (text === '') throw new Error('候选 Agent 没有返回最终文本')
      return { text, traceSessionId }
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

  function owns(sessionId) {
    return activeSessions.has(str(sessionId))
  }

  return Object.freeze({ run, owns })
}
