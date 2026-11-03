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
  async function callModel(opts) {
    opts.signal?.throwIfAborted()
    const sel = opts.selection || (opts.background === true ? backgroundModelSelection(await backgroundConfigForSession(opts.sessionId)) : modelSelection(opts.sessionId))
    if (sel === null) throw new Error('没有可用的模型配置，请先在当前会话的模型选择器中选择模型')
    const cfg = { provider: sel.provider, model: sel.model }
    if (sel.reasoningEffort !== undefined) cfg.reasoningEffort = sel.reasoningEffort
    // Codex Responses API 不接受 temperature；其他模型仍保留候选温度阶梯。
    if (typeof opts.temperature === 'number' && sel.provider !== 'openai-codex') cfg.temperature = opts.temperature
    if (typeof opts.maxTokens === 'number') cfg.maxTokens = opts.maxTokens
    const prepared = await llm.prepareCall(cfg, opts.signal)
    opts.signal?.throwIfAborted()
    const options = Object.assign({}, prepared.config, { messages: identifyHelperModelMessages(opts.messages), system: opts.system }, opts.signal ? { signal: opts.signal } : {})
    let text = ''
    let finish = null, usage = null
    try {
      for await (const chunk of prepared.stream(options)) {
        opts.signal?.throwIfAborted()
        opts.onChunk?.(chunk)
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
    const out = text.trim()
    if (out === '') throw new Error('模型返回为空')
    return opts.returnUsage ? {output:out,...(usage?{usage}:{})} : out
  }

  return { modelSelection, backgroundModelSelection, tavernModelCatalog, callModel }
}
