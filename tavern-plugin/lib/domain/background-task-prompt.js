// Common background request assembly. Keep this production seam independent of DSH.
import { prependSystemInstruction } from './system-append.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// A stage director shares the background context only when it asks for it; otherwise it brings
// its own complete system prompt, messages and submission tool.
export function usesSharedBackgroundContext(input = {}) {
  return input.task !== 'stage-director' || input.contextPolicy === 'shared-background'
}

function messageText(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : []
  return blocks.filter(function (block) { return block && block.type === 'text' }).map(function (block) { return str(block.text) }).join('')
}

export function backgroundPrompt(messages, turnContext, task, taskProtocol, input = {}) {
  const sections = []
  const sharedDirector = task === 'stage-director' && input.contextPolicy === 'shared-background'
  if (sharedDirector && str(input.systemPromptText).trim()) {
    sections.push('【人物卡系统提示】\n' + str(input.systemPromptText).trim())
  }
  const authoritative = str(turnContext).trim()
  if (authoritative !== '') {
    sections.push('【本轮权威状态】\n' + (task === 'stage-director' ? '这是最新状态；与后台会话中较早的游标、姿势或指引冲突时，以本节为准。\n' : '') + authoritative)
  }
  const recent = (messages || []).map(function (message) {
    const role = message && message.role === 'assistant' ? '正文' : '用户'
    return '[' + role + ']\n' + messageText(message)
  }).filter(function (text) { return text.trim() !== '' }).join('\n\n')
  const taskName = task === 'stage-director' ? '舞台导演' : task === 'settlement' ? '状态结算' : task === 'character-design' ? '人物设计' : task === 'ledger' ? '台账整理' : task === 'plugin' ? '插件任务' : '候选生成'
  sections.push('【最近剧情与本次任务】\n任务类型：' + taskName + '\n' + recent)
  const protocol = str(taskProtocol).trim()
  if (protocol !== '') sections.push('【任务要求】\n' + (task === 'stage-director' ? 'DSH 后台任务协议（最终指令）：\n' : '') + protocol)
  if ((task === 'candidate' || sharedDirector) && str(input.postHistoryText).trim()) {
    sections.push('【人物卡历史后指令】\n' + str(input.postHistoryText).trim())
  }
  return sections.join('\n\n')
}

export function backgroundSystemPrompt({ input, sections, persona, systemAppend }) {
  if (!usesSharedBackgroundContext(input)) return str(input.system)
  const assembly = { sections: [...sections, { name: 'deployment:persona', text: persona }] }
  return prependSystemInstruction(assembly, systemAppend).sections.map(section => section.text).join('\n\n')
}

export function backgroundTaskPrompt({ input, messages = input.messages, turnContext = input.turnContext, foregroundReads, worldbook, systemUpdate, pluginText }) {
  return [foregroundReads, worldbook?.rendered, systemUpdate?.rendered,
    backgroundPrompt(messages, turnContext, input.task, input.system, input), pluginText].filter(Boolean).join('\n\n')
}

// Directors may opt into the existing shared read adapters, never settlement writes.
const DIRECTOR_READ_TOOLS = new Set(['worldbook_search', 'tavern_recall_history'])
const DIRECTOR_WRITE_TOOLS = new Set(['submit_direction', 'stage_update'])

export function directorTaskTools(input, sharedTools = []) {
  const supplied = Array.isArray(input.tools) ? input.tools : []
  if (!usesSharedBackgroundContext(input)) {
    if (supplied.length !== 1 || !DIRECTOR_WRITE_TOOLS.has(supplied[0]?.name)) throw new Error('Stage director requires exactly one presentation submission tool')
    return supplied
  }
  const shared = new Map(sharedTools.map(item => [item.tool?.name, item.tool]))
  const names = new Set()
  const tools = supplied.map(tool => {
    const name = tool?.name
    if (typeof name !== 'string' || names.has(name)) throw new Error('Stage director tool names must be unique')
    names.add(name)
    if (DIRECTOR_WRITE_TOOLS.has(name)) return tool
    if (DIRECTOR_READ_TOOLS.has(name) && shared.has(name)) return shared.get(name)
    throw new Error('Stage director cannot expose tool: ' + str(name))
  })
  if (!tools.some(tool => DIRECTOR_WRITE_TOOLS.has(tool.name))) throw new Error('Stage director requires a presentation submission tool')
  return tools
}

export function assertDirectorToolSurface(input, actualTools, expectedTools) {
  if (usesSharedBackgroundContext(input) && (!Array.isArray(expectedTools) || expectedTools.length === 0)) throw new Error('Stage director tool surface was not initialized')
  const actual = (actualTools || []).map(tool => tool?.name).sort()
  const expected = usesSharedBackgroundContext(input)
    ? (expectedTools || []).map(tool => tool.name).sort() : directorTaskTools(input).map(tool => tool.name)
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new Error('Stage director request must expose only ' + expected.join(', '))
  }
}
