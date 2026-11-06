import { compileHelperGenerate } from './helper-generation-prompts.js'
import { randomUUID } from 'node:crypto'

/** DSH Message requires identity and attribution even for independent requests. */
export function identifyHelperModelMessages(messages) {
  return messages.map(message => ({ ...message, id: message.id || randomUUID(),
    source: message.source || { kind: 'plugin:dsh-tavern' } }))
}

/** Compile actual DSH card/preset/worldbook context without Session writes. */
export async function generateHelper(config, context) {
  const ordered_prompts = compileHelperGenerate(config, context)
  const document = context.presetSnapshot?.compatibilityPresetDocument || {}
  const sampling = { ...config.custom_api }
  for (const [key, fallback] of [['temperature', document.temperature], ['max_tokens', document.openai_max_tokens ?? document.max_completion_tokens ?? document.max_tokens]]) {
    const value = sampling[key] ?? (key === 'max_tokens' ? sampling.max_completion_tokens : undefined)
    if (value === 'unset') delete sampling[key]
    else if (value === undefined || value === 'same_as_preset') {
      if (fallback === undefined) delete sampling[key]
      else sampling[key] = fallback
    } else sampling[key] = value
  }
  delete sampling.max_completion_tokens
  return generateHelperRaw({ ordered_prompts, custom_api: sampling }, context)
}

/**
 * Tavern Helper's generateRaw treats ordered_prompts as optional: left out, it uses the
 * default prompt order, the same request generate builds. Returns that generate config,
 * or null when the caller gave an explicit order.
 */
export function defaultOrderedRawConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  if (Array.isArray(config.ordered_prompts) && config.ordered_prompts.length) return null
  if (config.ordered_prompts !== undefined && config.ordered_prompts !== null && !Array.isArray(config.ordered_prompts)) return null
  const { ordered_prompts: _ordered, ...rest } = config
  return rest
}

/** Compile the explicitly ordered, text-only generateRaw contract without Session writes. */
export async function generateHelperRaw(config, { callModel, sessionId = '', history = [] }) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('generateRaw 参数必须是对象')
  // 此处一次性返回全文；客户端根据 should_stream 补发兼容流式事件。
  const allowed = new Set(['ordered_prompts', 'user_input', 'max_chat_history', 'should_stream', 'should_silence', 'overrides', 'generation_id', 'custom_api'])
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error('generateRaw 暂不支持参数：' + key)
  if (!Array.isArray(config.ordered_prompts) || !config.ordered_prompts.length) throw new Error('generateRaw 需要显式 ordered_prompts')
  const overrides = config.overrides || {}
  for (const [key, value] of Object.entries(overrides)) {
    // Explicitly ordered raw prompts never inject these sources implicitly.
    // Accept requests to clear them, but do not silently discard real content.
    if (['world_info_before', 'world_info_after', 'persona_description', 'char_description', 'char_personality', 'scenario', 'dialogue_examples'].includes(key) && value === '') continue
    if (key === 'chat_history' && value && typeof value === 'object' && !Array.isArray(value)
      && Object.entries(value).every(([name, entry]) => (name === 'with_depth_entries' && entry === false)
        || (name === 'author_note' && entry === '') || (name === 'prompts' && Array.isArray(entry) && entry.length === 0))) continue
    throw new Error('generateRaw 暂不支持覆盖项：' + key)
  }
  const limit = config.max_chat_history ?? 'all'
  if (limit !== 'all' && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('max_chat_history 必须是非负整数或 all')
  if (config.user_input !== undefined && typeof config.user_input !== 'string') throw new Error('user_input 必须是文本')
  const messages = []
  function append(role, text) {
    if (!['system', 'user', 'assistant'].includes(role) || typeof text !== 'string') throw new Error('generateRaw 仅支持 system/user/assistant 文本消息')
    if (text.trim()) messages.push({ role, content: [{ type: 'text', text }] })
  }
  const explicitUser = config.ordered_prompts.includes('user_input')
  for (const prompt of config.ordered_prompts) {
    if (prompt === 'user_input') append('user', config.user_input || '')
    else if (prompt === 'chat_history') {
      const selected = limit === 'all' ? history : limit === 0 ? [] : history.slice(-limit)
      for (const message of selected) append(message.role, message.text)
      if (!explicitUser) append('user', config.user_input || '')
    } else if (prompt && typeof prompt === 'object' && !Array.isArray(prompt)) {
      if (Object.keys(prompt).some(k => !['role', 'content'].includes(k))) throw new Error('generateRaw 不支持此消息参数')
      append(prompt.role, prompt.content)
    } else throw new Error('generateRaw 暂不支持内置提示词：' + String(prompt))
  }
  if (!explicitUser && !config.ordered_prompts.includes('chat_history')) append('user', config.user_input || '')
  if (!messages.length) throw new Error('generateRaw 提示词不能为空')
  return await callModel({ sessionId, messages, system: '', ...helperSampling(config.custom_api) })
}

// Connection/model fields are intentionally ignored: selection belongs to the host.
function helperSampling(config) {
  const result = {}
  if (!config || typeof config !== 'object') return result
  if (config.temperature !== undefined) {
    if (!Number.isFinite(config.temperature) || config.temperature < 0 || config.temperature > 2) throw new Error('temperature 必须在 0 到 2 之间')
    result.temperature = config.temperature
  }
  const maxTokens = config.max_tokens ?? config.max_completion_tokens
  if (maxTokens !== undefined) {
    if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error('max_tokens 必须是正整数')
    result.maxTokens = maxTokens
  }
  return result
}

export async function generateHelperCompletion(config, { callModel, sessionId = '' }) {
  if (!config || !Array.isArray(config.messages) || !config.messages.length) throw new Error('模型请求需要 messages')
  if (config.tools?.length || config.functions?.length) throw new Error('后台模型兼容接口暂不支持工具调用')
  if (config.n !== undefined && config.n !== 1) throw new Error('后台模型兼容接口只支持单个结果')
  const messages = config.messages.map(message => {
    if (!['system', 'user', 'assistant'].includes(message.role)) throw new Error('不支持的模型消息角色')
    const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content
    if (!Array.isArray(content) || content.some(part => part?.type !== 'text' || typeof part.text !== 'string')) throw new Error('后台模型兼容接口只接受文本消息')
    return { role: message.role, content: content.map(part => ({ type: 'text', text: part.text })) }
  })
  return callModel({ sessionId, messages, system: '', ...helperSampling(config) })
}
