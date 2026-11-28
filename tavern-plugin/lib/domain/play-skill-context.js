import { USE_SKILL_TOOL } from './foreground-tools.js'
import { hasProviderContent } from './provider-message-content.js'
import { canonicalTavernSkillName } from './tavern-skills.js'
import reminders from './system-reminders.cjs'

const catalogBlock = /<available_skills>\s*([\s\S]*?)\s*<\/available_skills>/i
const skillRow = /^- `([a-z0-9]+(?:-[a-z0-9]+)*)`:/gm
const skillTools = new Set(['skill', USE_SKILL_TOOL, 'tavern_read_skill_reference'])
const escapeText = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function textOf(message) {
  return (message.content || []).filter(block => block?.type === 'text').map(block => block.text).join('\n')
}

function skillMessageKind(message) {
  if (message?.role !== 'user' || !reminders.tavernIsSkillReminder(message.source)) return ''
  const kind = message.source.kind
  if (kind === 'skill-catalog' || kind === 'skill-invocation') return kind
  return catalogBlock.test(textOf(message)) ? 'skill-catalog' : 'skill-invocation'
}

export function hasPlaySkillContext(messages) {
  return Array.isArray(messages) && messages.some(message => skillMessageKind(message) || message?.role === 'assistant' &&
    message.content?.some(block => block?.type === 'tool-call' && skillTools.has(block.name)))
}

function catalogFor(message, skills) {
  const raw = catalogBlock.exec(textOf(message))?.[1] || ''
  const listed = Array.isArray(message.source.entries) ? message.source.entries.map(entry => entry?.name)
    : [...raw.matchAll(skillRow)].map(match => match[1])
  const entries = [...new Set(listed)].flatMap(name => {
    const skill = skills.get(name)
    if (!skill?.modelInvocable) return []
    const description = String(skill.description || '').replace(/\s+/g, ' ').trim()
    return [{ name, description: description.length <= 500 ? description : description.slice(0, 497) + '...' }]
  })
  if (!entries.length) return null
  const text = ['<system-reminder>', 'Available writing Skills for this game:', '<available_skills>',
    ...entries.map(entry => '- `' + entry.name + '`: ' + escapeText(entry.description)), '</available_skills>',
    'For model-initiated loads, use only names in this catalog. Call the `' + USE_SKILL_TOOL + '` tool with the exact name and action `load`.',
    'Follow the Skill instructions already supplied when the player explicitly invokes an approved Skill.',
    '</system-reminder>'].join('\n')
  return { ...message, content: [{ type: 'text', text }], source: { ...message.source, entries } }
}

function calledSkill(block) {
  let args = block.arguments
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch { return '' }
  }
  return typeof args?.name === 'string' ? canonicalTavernSkillName(args.name) : ''
}

// Apply the current allowlist to resumed native catalogs, /skill instructions,
// and paired tool calls. Historical session events stay intact.
export function projectPlaySkillMessages(messages, allowed, toolEnabled) {
  const skills = new Map(allowed.map(skill => [skill.name, skill]))
  const blocked = new Set()
  for (const message of messages) {
    if (message?.role !== 'assistant') continue
    for (const block of message.content || []) {
      if (block?.type === 'tool-call' && skillTools.has(block.name) && !skills.get(calledSkill(block))?.modelInvocable) blocked.add(block.id)
    }
  }
  const projected = messages.map(message => {
    const kind = skillMessageKind(message)
    if (kind === 'skill-catalog') return toolEnabled ? catalogFor(message, skills) : null
    if (kind === 'skill-invocation') {
      const name = message.source.name ?? /<skill_content name="([^"]+)"/.exec(textOf(message))?.[1]
      return typeof name === 'string' && skills.get(canonicalTavernSkillName(name))?.userInvocable ? message : null
    }
    if (!blocked.size || !message) return message
    if (message.role === 'tool' && blocked.has(message.toolCallId)) return null
    const content = message.content?.filter(block => !(block?.type === 'tool-call' && blocked.has(block.id)) &&
      !(block?.type === 'tool-result' && blocked.has(block.toolCallId)))
    if (!content || content.length === message.content.length) return message
    const { replayState, ...source } = message.source || {}
    const result = { ...message, content, ...(message.source ? { source } : {}) }
    return content.length && hasProviderContent(result) ? result : null
  })
  return projected.every((message, index) => message === messages[index]) ? messages : projected.filter(Boolean)
}
