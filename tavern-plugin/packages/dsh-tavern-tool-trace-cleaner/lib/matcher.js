export const READ_VARIABLES_TOOLS = Object.freeze(new Set([
  'tavern_read_variables'
]))

export const SKILL_TOOLS = Object.freeze(new Set([
  'skill',
  'tavern_read_skill_reference'
]))

export const WORLDBOOK_TOOLS = Object.freeze(new Set([
  'query_lorebook',
  'read_lorebook',
  'list_lorebook',
  'grep_lorebook',
  'worldbook_list',
  'worldbook_grep'
]))

export const RECALL_HISTORY_TOOLS = Object.freeze(new Set([
  'tavern_recall_history'
]))

const SYNTHETIC_HISTORY_PREFIXES = Object.freeze(['tvh_', 'tvc_'])
const VALID_TOOL_NAME = /^[A-Za-z0-9_.:-]{1,120}$/

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  cleanReadVariables: true,
  cleanWorldbook: true,
  cleanRecallHistory: true,
  skillPolicy: 'keep-latest',
  cleanBodyText: true,
  stripMetaPrefix: false,
  extraTools: '',
  debugLog: false
})

export function normalizeSettings(input = {}) {
  const skillPolicy = ['keep-latest', 'all', 'off'].includes(input.skillPolicy)
    ? input.skillPolicy
    : DEFAULT_SETTINGS.skillPolicy
  return {
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : DEFAULT_SETTINGS.enabled,
    cleanReadVariables: input.cleanReadVariables !== undefined ? Boolean(input.cleanReadVariables) : DEFAULT_SETTINGS.cleanReadVariables,
    cleanWorldbook: input.cleanWorldbook !== undefined ? Boolean(input.cleanWorldbook) : DEFAULT_SETTINGS.cleanWorldbook,
    cleanRecallHistory: input.cleanRecallHistory !== undefined ? Boolean(input.cleanRecallHistory) : DEFAULT_SETTINGS.cleanRecallHistory,
    skillPolicy,
    cleanBodyText: input.cleanBodyText !== undefined ? Boolean(input.cleanBodyText) : DEFAULT_SETTINGS.cleanBodyText,
    stripMetaPrefix: input.stripMetaPrefix !== undefined ? Boolean(input.stripMetaPrefix) : DEFAULT_SETTINGS.stripMetaPrefix,
    extraTools: typeof input.extraTools === 'string' ? input.extraTools : DEFAULT_SETTINGS.extraTools,
    debugLog: input.debugLog !== undefined ? Boolean(input.debugLog) : DEFAULT_SETTINGS.debugLog
  }
}

export function parseExtraTools(raw) {
  const names = new Set()
  if (typeof raw !== 'string' || !raw.trim()) return names
  for (const part of raw.split(/[\s,，;；]+/)) {
    const trimmed = part.trim()
    if (trimmed && VALID_TOOL_NAME.test(trimmed)) names.add(trimmed)
  }
  return names
}

export function isSyntheticHistoryCallId(callId) {
  if (typeof callId !== 'string' || !callId) return false
  return SYNTHETIC_HISTORY_PREFIXES.some(prefix => callId.startsWith(prefix))
}

export function classifyToolName(name, extraSet) {
  if (typeof name !== 'string' || !name) return null
  if (READ_VARIABLES_TOOLS.has(name)) return 'readVariables'
  if (SKILL_TOOLS.has(name)) return 'skill'
  if (WORLDBOOK_TOOLS.has(name)) return 'worldbook'
  if (RECALL_HISTORY_TOOLS.has(name)) return 'recallHistory'
  if (extraSet && extraSet.has(name)) return 'extra'
  return null
}

export function shouldCleanNonSkillCategory(category, settings) {
  if (category === 'readVariables') return settings.cleanReadVariables
  if (category === 'worldbook') return settings.cleanWorldbook
  if (category === 'recallHistory') return settings.cleanRecallHistory
  if (category === 'extra') return true
  return false
}

export function extractSkillNameFromCall(block) {
  if (!block || typeof block !== 'object') return ''
  let args = block.arguments
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch { return '' }
  }
  if (!args || typeof args !== 'object') return ''
  const candidate = args.name ?? args.skill ?? args.skillName ?? ''
  return typeof candidate === 'string' ? candidate.trim() : ''
}

const SKILL_CONTENT_NAME_RE = /<skill_content\b[^>]*\bname=(?:\\?"([^"\\]+)\\?"|'([^']+)')/gi

export function extractSkillNamesFromText(text) {
  if (typeof text !== 'string' || !text.includes('skill_content')) return []
  const found = []
  SKILL_CONTENT_NAME_RE.lastIndex = 0
  let match
  while ((match = SKILL_CONTENT_NAME_RE.exec(text)) !== null) {
    const name = (match[1] || match[2] || '').trim()
    if (name) found.push(name)
  }
  return found
}

export function extractTextFromMessage(message) {
  if (!message || typeof message !== 'object') return ''
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('\n')
}

export function isSkillInjectionMessage(message) {
  if (!message || typeof message !== 'object') return false
  if (message.source?.kind === 'skill-invocation') return true
  if (message.role === 'user') {
    const text = extractTextFromMessage(message)
    if (/<skill_content\b/i.test(text)) return true
  }
  return false
}

export function extractSkillNameFromMessage(message) {
  if (typeof message?.source?.name === 'string' && message.source.name.trim()) {
    return message.source.name.trim()
  }
  const names = extractSkillNamesFromText(extractTextFromMessage(message))
  return names[0] || ''
}

// L2: 正文文本残片清理规则（保守匹配，不触碰正常对话中的普通词汇）
const XML_TRACE_PATTERNS = Object.freeze([
  /<skill_content\b[^>]*>[\s\S]*?<\/skill_content>/gi,
  /<skill_resources\b[^>]*>[\s\S]*?<\/skill_resources>/gi,
  /<skill_instructions\b[^>]*>[\s\S]*?<\/skill_instructions>/gi,
  /<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi,
  /<tool_result\b[^>]*>[\s\S]*?<\/tool_result>/gi,
  /<function_calls\b[^>]*>[\s\S]*?<\/function_calls>/gi,
  /<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi
])

const FENCED_TOOL_JSON_RE = /```(?:json|tool_call|tool)?\s*\n\s*\{[\s\S]*?"(?:name|tool)"\s*:\s*"(?:tavern_read_variables|query_lorebook|read_lorebook|list_lorebook|grep_lorebook|worldbook_list|worldbook_grep|tavern_recall_history|tavern_read_skill_reference|skill)"[\s\S]*?\}\s*\n```/gi

const META_PREFIX_LINE_RE = /^(?:(?:好的|明白|收到|嗯)[，,。！!]?\s*)?(?:我先|先|正在|已|已经)(?:为你|为您|帮你|帮您)?(?:调用|使用|查询|查阅|读取|检索|加载|召回)(?:了)?(?:当前|一下)?(?:变量|状态变量|世界书|设定集|历史|历史记录|剧情历史|技能|\s*skill\b)[^\n]{0,80}[：:。!！]?\s*\n+/i

export const STREAM_TAG_OPEN_RE = /<(?:skill_content|skill_resources|skill_instructions|tool_call|tool_result|function_calls|invoke)\b/i

export function stripBodyTextTraces(text, options = {}) {
  if (typeof text !== 'string' || !text) return text
  const settings = normalizeSettings(options)
  if (!settings.enabled || !settings.cleanBodyText) return text

  let next = text
  for (const pattern of XML_TRACE_PATTERNS) {
    pattern.lastIndex = 0
    next = next.replace(pattern, '')
  }
  FENCED_TOOL_JSON_RE.lastIndex = 0
  next = next.replace(FENCED_TOOL_JSON_RE, '')

  if (settings.stripMetaPrefix) {
    // 仅清理正文开头连续出现的工具调用元叙述过渡行，不碰引号内对话
    let prev
    do {
      prev = next
      const trimmedStart = next.trimStart()
      if (trimmedStart.startsWith('“') || trimmedStart.startsWith('"') || trimmedStart.startsWith('「')) break
      next = next.replace(META_PREFIX_LINE_RE, '')
    } while (next !== prev)
  }

  if (next === text) return text
  next = next.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '')
  return next
}
