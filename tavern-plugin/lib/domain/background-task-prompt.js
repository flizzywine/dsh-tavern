// Common background request assembly. Keep this production seam independent of DSH.
import { promptSection } from './prompt-section.js'
import { prependSystemInstruction } from './system-append.js'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "Card system prompt:\n",
  p002: "This is the latest state. Where it conflicts with older cursors, postures or guidance in the background session, this section wins.\n",
  p003: "",
  p006: "Story",
  p007: "User",
  p010: "state settlement",
  p012: "character design",
  p013: "stage direction",
  p014: "ledger update",
  p015: "plugin task",
  p016: "choice generation",
  p017: "Task type: ",
  p018: "DSH background task protocol (final instructions):\n",
  p019: "",
  p020: "Card instructions:\n"
})

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
    sections.push(promptSection('card_system', PROMPT_PROSE.p001 + str(input.systemPromptText).trim()))
  }
  const authoritative = str(turnContext).trim()
  if (authoritative !== '') {
    sections.push(promptSection('authoritative_state', (task === 'stage-director' ? PROMPT_PROSE.p002 : PROMPT_PROSE.p003) + authoritative))
  }
  const recent = (messages || []).map(function (message) {
    const role = message && message.role === 'assistant' ? PROMPT_PROSE.p006 : PROMPT_PROSE.p007
    return '[' + role + ']\n' + messageText(message)
  }).filter(function (text) { return text.trim() !== '' }).join('\n\n')
  const taskName = task === 'settlement' ? PROMPT_PROSE.p010 : task === 'character-design' ? PROMPT_PROSE.p012 : task === 'stage-director' ? PROMPT_PROSE.p013 : task === 'ledger' ? PROMPT_PROSE.p014 : task === 'plugin' ? PROMPT_PROSE.p015 : PROMPT_PROSE.p016
  sections.push(promptSection('recent_task', PROMPT_PROSE.p017 + taskName + '\n' + recent))
  const protocol = str(taskProtocol).trim()
  if (protocol !== '') sections.push(promptSection('task_requirements', (task === 'stage-director' ? PROMPT_PROSE.p018 : PROMPT_PROSE.p019) + protocol))
  if ((task === 'candidate' || sharedDirector) && str(input.postHistoryText).trim()) {
    sections.push(promptSection('post_history', PROMPT_PROSE.p020 + str(input.postHistoryText).trim()))
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
