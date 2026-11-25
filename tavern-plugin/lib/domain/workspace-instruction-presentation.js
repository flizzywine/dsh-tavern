import { markRequestHandled, requestHandledBy } from './request-lineage.js'
import { isPluginSource, sourceProducerName, isSystemPromptSource } from './message-source.js'
import reminders from './system-reminders.cjs'

const { tavernIsSkillReminder, tavernIsRuntimeReminder, tavernStripSystemReminders } = reminders

// Request-only filtering: preserve files and durable Session reconciliation state.
const blockedSections = new Set([
  'approval:policy',
  'deployment:persona-prefix',
  'sandbox:policy',
  'working-directory:current',
  'plan:policy',
  'subagent:delegation',
  'harness:source',
  'app:web-surface',
  'team:identity',
  'team:policy',
  'tool:jobs',
  'cordis-dynamic',
])
const isBlockedSection = name => blockedSections.has(name) || /^tool:[^:]+:depth$/.test(name || '')

const blockedUserKinds = new Set([
  'agent-instructions',
  'user-approval',
  'model-selection',
  'time-context',
  'working-directory',
  'plan-mode',
  'repeat-tool-reminder',
  'tmux-context',
  'cordis-host-runner',
  'tool-jobs',
  'action-cards',
  'subagent-settled',
])
const blockedUserPlugins = new Set([...blockedUserKinds].flatMap(name => [name, '@deepseek-ai/dsh-' + name]))

const blockedDeveloperKinds = new Set(['tool-registry'])
const blockedDeveloperPlugins = new Set(['tool-registry', '@deepseek-ai/dsh-tool-registry'])

const officeSkillName = /^office(?:-docx|-pptx|-xlsx)?$/
const officeCatalogLine = /^- `office(?:-docx|-pptx|-xlsx)?`: [^\n]*\n/gm

// The Tavern profile disables the provider. Old sessions can still replay its catalog.
function presentSkillCatalog(message) {
  const { source } = message
  let changed = false
  const content = message.content.map(block => {
    if (block?.type !== 'text' || typeof block.text !== 'string') return block
    const text = block.text.replace(officeCatalogLine, '')
    if (text === block.text) return block
    changed = true
    return { ...block, text }
  })
  if (!changed) return message
  if (!source.update && !source.incomplete && content.length === 1 &&
    /<available_skills>\s*<\/available_skills>/.test(content[0].text)) return null
  const entries = Array.isArray(source.entries) ? source.entries.filter(entry => !officeSkillName.test(entry?.name)) : undefined
  return { ...message, content, source: entries ? { ...source, entries } : source }
}

function isBlockedHostMessage(message) {
  const source = message?.source
  if (!source || typeof source !== 'object') return false
  if (message.role === 'user') {
    return blockedUserKinds.has(source.kind) ||
      (isPluginSource(source) && blockedUserPlugins.has(sourceProducerName(source)))
  }
  if (message.role === 'developer') {
    return blockedDeveloperKinds.has(source.kind) ||
      (isPluginSource(source) && blockedDeveloperPlugins.has(sourceProducerName(source)))
  }
  return false
}

export function presentWorkspaceInstructions(request) {
  if (!Array.isArray(request?.messages)) return request
  let changed = false
  const messages = request.messages.flatMap(message => {
    const source = message?.source
    if (message?.role === 'user' && source?.kind === 'skill-catalog' && Array.isArray(message.content)) {
      const catalog = presentSkillCatalog(message)
      changed ||= catalog !== message
      return catalog ? [catalog] : []
    }
    if (isBlockedHostMessage(message) || (message?.role === 'user' && tavernIsRuntimeReminder(source))) {
      changed = true
      return []
    }
    if (message?.role === 'system' && isSystemPromptSource(source) && Array.isArray(source.sections)) {
      const sections = source.sections.filter(section => !isBlockedSection(section?.name))
      if (sections.length !== source.sections.length) {
        changed = true
        const body = tavernStripSystemReminders(sections.map(section => section.text).filter(Boolean).join('\n\n'))
        return body.trim() ? [{ ...message, source: { ...source, sections }, content: [{ type: 'text', text: body }] }] : []
      }
    }
    const synthetic = ['system', 'developer'].includes(message?.role) || (message?.role === 'user' && source && source.kind !== 'user')
    if (synthetic &&
      !tavernIsSkillReminder(source) && Array.isArray(message.content)) {
      let stripped = false
      const content = message.content.flatMap(block => {
        if (block?.type !== 'text' || typeof block.text !== 'string') return [block]
        const text = tavernStripSystemReminders(block.text)
        if (text === block.text) return [block]
        stripped = true
        return text.trim() ? [{ ...block, text }] : []
      })
      if (stripped) {
        changed = true
        return content.length ? [{ ...message, content }] : []
      }
    }
    return [message]
  })
  const system = typeof request.system === 'string' ? tavernStripSystemReminders(request.system) : request.system
  if (system !== request.system) return { ...request, system, messages }
  return changed ? { ...request, messages } : request
}

const PRESENTED = 'workspace-instructions'

export function installWorkspaceInstructionPresentation(ctx, ownsSession) {
  ctx.on('llm/stream', (request, next) => (async function * () {
    if (request?.sessionId && !requestHandledBy(request, PRESENTED) && await ownsSession(request.sessionId)) {
      const presented = presentWorkspaceInstructions(request)
      if (presented !== request) {
        yield * ctx.llm.stream(markRequestHandled(presented, PRESENTED))
        return
      }
    }
    yield * next()
  })())
}
