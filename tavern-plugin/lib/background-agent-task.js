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
  const taskName = task === 'image' ? '场景生图' : task === 'settlement' ? '状态结算' : '候选生成'
  sections.push('【最近剧情与本次任务】\n任务类型：' + taskName + '\n' + recent)
  const protocol = str(taskProtocol).trim()
  if (protocol !== '') sections.push('【DSH 后台任务协议（最终指令）】\n按系统提示中的本轮任务规则执行。')
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

export function traceError(error, traceSessionId, task) {
  const fallback = task === 'settlement' ? '后台状态结算失败' : '后台候选生成失败'
  const wrapped = new Error(str(error && error.message || error) || fallback, { cause: error })
  wrapped.traceSessionId = traceSessionId
  return wrapped
}

// A task operates on a leased DSH Agent; it does not create or retain sessions.
export function createBackgroundAgentTask(options) {
  const setupAgent = typeof options.setupAgent === 'function' ? options.setupAgent : null
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
        text: state.input.task === 'image' ? '你是独立的场景生图 Agent，不续写故事、不修改变量。你会持续处理同一游戏的绘图任务；旧任务只供参考，当前目标材料与已保存方案是本次依据。不要沿用已废弃分支、旧站位或之前仅限单图的调整。\n\n{{tavern_background_task}}' : backgroundPersona
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
    let removed = false
    async function removeTools() {
      if (removed) return
      removed = true
      for (let index = disposers.length - 1; index >= 0; index--) await disposers[index]()
    }
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
                return JSON.stringify({ message: input.toolLimitMessage || '已达到剧本查询上限，请停止查询，基于已有材料开始推理并输出最终候选。' })
              }
            }
            const result = str(await input.onToolCall({ name: tool.name, arguments: args }))
            if (typeof input.stopToolsWhen === 'function' && (input.stopToolsWhen() || toolCallCount >= maxToolCalls)) await removeTools()
            return result
          }
        })
    }).filter(function (dispose) { return typeof dispose === 'function' })
    return removeTools
  }

  async function execute({ agent, state, traceSessionId, persistent }, input) {
    const runtimeInput = state.input
    rewindSurface(agent.session, input.rewindTo)
    const removeTaskTools = installTaskTools(state, runtimeInput)
    const cancel = function () { agent.cancel?.({ kind: 'user' }) }
    input.signal?.addEventListener('abort', cancel, { once: true })

    try {
      input.signal?.throwIfAborted()
      if (persistent && typeof input.onPersistentSessionReady === 'function') {
        // Persist the native session before publishing its identity, even if the first task fails.
        if (typeof options.flushSession === 'function') await options.flushSession(agent.session)
        await input.onPersistentSessionReady(traceSessionId)
      }
      if (!readSessionStablePrefix(agent.session)) {
        const background = typeof options.resolveStablePrefix === 'function'
          ? await options.resolveStablePrefix(input) : input.backgroundContext
        const prefix = await ensureSessionStablePrefix(agent.session, background, options.stablePrefixStorage)
        if (prefix && typeof options.flushSession === 'function') await options.flushSession(agent.session)
      }
      const eventStart = Array.isArray(agent.session.events) ? agent.session.events.length : 0
      agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: backgroundPrompt(input.messages, input.turnContext, input.task, input.system, input) }],
        source: { kind: 'plugin', plugin: 'dsh-tavern' }
      })
      await agent.whenIdle()
      input.signal?.throwIfAborted()
      const rawResult = finalMessage(agent.session.events, eventStart)
      if (rawResult === null) {
        const underlying = terminalError(agent.session.events, eventStart)
        if (underlying !== null) throw underlying
        throw new Error(input.task === 'settlement' ? '后台 Agent 没有返回结算文本' : '后台 Agent 没有返回候选文本')
      }
      const text = rawResult.text.trim()
      if (persistent && input.task === 'image' && typeof options.flushSession === 'function') {
        await options.flushSession(agent.session)
      }
      return { text, traceSessionId, persistent, traceBoundary: completedBoundary(agent.session.events) }
    } catch (error) {
      throw traceError(error, traceSessionId, input.task)
    } finally {
      input.signal?.removeEventListener('abort', cancel)
      await removeTaskTools()
    }
  }

  return Object.freeze({ setup: setupFor, execute })
}
