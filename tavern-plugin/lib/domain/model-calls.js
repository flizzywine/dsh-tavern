import { resolveChatBackgroundModel } from './background-model-selection.js'
import { identifyHelperModelMessages } from './helper-generation.js'

// Which model a request uses, and one plain text call to it. The session's own choice wins
// over the default; background work uses the game's background model when it set one.
export function createModelCalls({ llm, agentDefaultModel, agents: getAgents, sessionProjections: getSessionProjections, backgroundConfigForSession }) {
  function modelSelection(sessionId) {
    // 会话级选择优先：与官方 api-proxy 相同的读取路径
    if (typeof sessionId === 'string' && sessionId !== '') {
      try {
        const agents = getAgents()
        const agent = agents !== undefined ? agents.get(sessionId) : undefined
        if (agent !== undefined && agent.session !== undefined && typeof agent.session.requestHeader === 'function') {
          const pending = getSessionProjections()?.stateOf(agent.session, 'modelSelection')?.pending
          const cfg = pending || agent.session.requestHeader()?.config
          if (cfg !== undefined && typeof cfg.provider === 'string' && typeof cfg.model === 'string') {
            return { provider: cfg.provider, model: cfg.model, ...(cfg.reasoningEffort === undefined ? {} : { reasoningEffort: cfg.reasoningEffort }) }
          }
        }
      } catch (err) {
        console.error('dsh-tavern: 读取会话模型失败', err)
      }
    }
    if (agentDefaultModel !== undefined) {
      try {
        const sel = agentDefaultModel.currentSelection()
        if (sel !== null && typeof sel === 'object' && typeof sel.provider === 'string' && typeof sel.model === 'string') {
          return { provider: sel.provider, model: sel.model, ...(sel.reasoningEffort === undefined ? {} : { reasoningEffort: sel.reasoningEffort }) }
        }
      } catch (err) {
        console.error('dsh-tavern: 读取默认模型失败', err)
      }
    }
    return null
  }
  function backgroundModelSelection(chat) {
    return resolveChatBackgroundModel(chat, modelSelection(chat && chat.sessionId))
  }
  async function tavernModelCatalog() {
    const providers = llm.listProviders()
    const groups = await Promise.all(providers.map(async function (provider) {
      try {
        const models = await llm.listModels(provider.id)
        return {
          provider: provider.id,
          providerName: provider.name || provider.id,
          models: models.filter(function (model) {
            return !Array.isArray(model.inputModalities) || model.inputModalities.includes('text')
          }).map(function (model) { return { id: model.id, name: model.name || model.id } })
        }
      } catch (error) {
        console.warn('dsh-tavern: 读取后台模型目录失败:', provider.id, error)
        return { provider: provider.id, providerName: provider.name || provider.id, models: [] }
      }
    }))
    return groups.filter(function (group) { return group.models.length > 0 })
  }
  // Optional tools use SDK ToolDefinition / ToolCallBlock shapes. onToolCall(call, {signal})
  // returns {content: ContentBlock[], isError?}; thrown errors become repairable tool results.
  // maxToolCalls (default 8) counts attempted calls across rounds; overflow rejects the batch.
  async function callModel(opts) {
    opts.signal?.throwIfAborted()
    const sel = opts.selection || (opts.background === true ? backgroundModelSelection(await backgroundConfigForSession(opts.sessionId)) : modelSelection(opts.sessionId))
    if (sel === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
    const cfg = { provider: sel.provider, model: sel.model }
    if (sel.reasoningEffort !== undefined) cfg.reasoningEffort = sel.reasoningEffort
    // Codex Responses API 不接受 temperature；其他模型仍保留候选温度阶梯。
    if (typeof opts.temperature === 'number' && sel.provider !== 'openai-codex') cfg.temperature = opts.temperature
    if (typeof opts.maxTokens === 'number') cfg.maxTokens = opts.maxTokens
    const withTools = Array.isArray(opts.tools) && opts.tools.length > 0
    if (withTools && typeof opts.onToolCall !== 'function') throw new Error('工具调用需要 onToolCall')
    const maxToolCalls = opts.maxToolCalls ?? 8
    if (withTools && (!Number.isSafeInteger(maxToolCalls) || maxToolCalls < 0)) throw new Error('maxToolCalls 必须是非负整数')
    const sdk = withTools ? await import('@deepseek-ai/dsh-llm') : null
    let prepared = await llm.prepareCall(cfg, opts.signal)
    opts.signal?.throwIfAborted()
    const options = Object.assign({}, prepared.config, { messages: identifyHelperModelMessages(opts.messages), system: opts.system }, opts.signal ? { signal: opts.signal } : {})
    if (withTools) options.tools = opts.tools
    // Each prepared call is single-use; retain the first resolved controls, not its stream.
    const roundConfig = { ...prepared.config }
    let toolCalls = 0
    let totalUsage = null
    for (;;) {
      const assembled = withTools ? new sdk.BlockAssembler() : null
      let text = ''
      let finish = null, usage = null
      try {
        for await (const chunk of prepared.stream(options)) {
          opts.signal?.throwIfAborted()
          opts.onChunk?.(chunk)
          assembled?.push(chunk)
          if (chunk.type === 'text-delta') { text += chunk.text; opts.onText?.(chunk.text) }
          else if (chunk.type === 'finish') finish = chunk.reason
          else if (chunk.type === 'usage') usage = chunk.usage
        }
      } catch (err) {
        opts.signal?.throwIfAborted()
        throw new Error('模型流失败: ' + (err && (err.message || err.code) || err))
      }
      opts.signal?.throwIfAborted()
      if (finish !== null && finish !== undefined && (finish.kind === 'error' || finish.kind === 'aborted')) {
        const f = finish.failure
        throw new Error('模型调用失败: ' + (f !== undefined && f !== null ? (f.message || f.code) : finish.kind))
      }
      if (finish !== null && finish !== undefined && finish.kind === 'max-tokens') {
        throw new Error('模型输出达到 token 上限')
      }
      if (withTools) {
        if (usage) {
          totalUsage ??= {}
          for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
            if (usage[key] !== undefined) totalUsage[key] = (totalUsage[key] || 0) + usage[key]
          }
        }
        const message = assembled.message({ provider: roundConfig.provider, model: roundConfig.model,
          ...(assembled.replayState === undefined ? {} : { replayState: assembled.replayState }) })
        const calls = message.content.filter(block => block.type === 'tool-call')
        if (calls.length) {
          if (toolCalls + calls.length > maxToolCalls) throw new Error('工具调用已达上限')
          options.messages.push(message)
          for (const call of calls) {
            opts.signal?.throwIfAborted()
            toolCalls++
            let result
            try {
              if (!options.tools.some(tool => tool.name === call.name)) throw new Error('未声明的工具：' + call.name)
              JSON.parse(call.arguments)
              result = await opts.onToolCall(call, { signal: opts.signal })
            } catch (error) {
              opts.signal?.throwIfAborted()
              result = { content: [{ type: 'text', text: String(error?.message || error) }], isError: true }
            }
            opts.signal?.throwIfAborted()
            options.messages.push(sdk.createToolResultMessage({ ...result, callId: call.id }))
          }
          opts.signal?.throwIfAborted()
          prepared = await llm.prepareCall(roundConfig, opts.signal)
          opts.signal?.throwIfAborted()
          Object.assign(options, prepared.config)
          continue
        }
        usage = totalUsage
      }
      const out = text.trim()
      if (out === '') throw new Error('模型返回为空')
      return opts.returnUsage ? {output:out,...(usage?{usage}:{})} : out
    }
  }

  return { modelSelection, backgroundModelSelection, tavernModelCatalog, callModel }
}
