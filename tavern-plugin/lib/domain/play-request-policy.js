import { isCompactionCheckpointMessage } from './compaction-checkpoint.js'
import { normalizeDisabledForegroundTools, QUERY_LOREBOOK_TOOL, USE_SKILL_TOOL } from './foreground-tools.js'
import { isSystemPromptSource, sourceProducerName } from './message-source.js'
import { markRequestHandled, requestHandledBy } from './request-lineage.js'
import { hasPlaySkillContext, projectPlaySkillMessages } from './play-skill-context.js'
import reminders from './system-reminders.cjs'

export const isPlayMode = mode => mode === 'story' || mode === 'script'

export function playToolNames({ mode, webSearchEnabled, modTools, storyTools }) {
  return [...modTools, 'tavern_read_variables', USE_SKILL_TOOL,
    ...(mode === 'script' ? ['tavern_read_script'] : []), 'tavern_recall_history', QUERY_LOREBOOK_TOOL,
    ...(webSearchEnabled === true ? ['web_search', 'web_fetch'] : []), ...storyTools]
}

// Unscoped host tools never acquire play access through the registry or the settings menu.
export function playPluginTools(tools, declared, controlled) {
  return tools.filter(tool => typeof tool?.name === 'string' && declared.has(tool.name) && !controlled.has(tool.name))
}

export async function selectPlayTools({ tools, visible, declared, controlled, disabled, unlock }) {
  const plugins = playPluginTools(tools, declared, controlled)
  const names = plugins.map(tool => tool.name)
  const unlocked = new Set(unlock ? await unlock(names) : names)
  const catalog = plugins.filter(tool => unlocked.has(tool.name))
  const off = new Set(normalizeDisabledForegroundTools(disabled))
  const allowed = new Set(catalog.map(tool => tool.name).filter(name => !off.has(name)))
  return { catalog, tools: tools.filter(tool => visible.has(tool?.name) || allowed.has(tool?.name)) }
}

const tavernProducers = new Set(['dsh-tavern', 'dsh-tavern-regen', 'dsh-tavern-replay', 'dsh-tavern-pure-writer'])
const playSystemSection = section => /^tavern(?:-plugin)?:/.test(section?.name || '')

function labelledSystem(text, systemSections) {
  return (systemSections?.(text) || []).filter(playSystemSection)
    .map(section => ({ name: section.name, text: text.slice(section.start, section.end) }))
    .filter(section => section.text)
}

function playMessage(message, systemSections) {
  const source = message?.source
  if (message?.role === 'system') {
    if (tavernProducers.has(sourceProducerName(source))) return message
    if (!isSystemPromptSource(source)) return null
    const body = (message.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n\n')
    const sections = Array.isArray(source.sections) ? source.sections.filter(playSystemSection) : labelledSystem(body, systemSections)
    if (!sections.length) return null
    const text = sections.map(section => section.text).filter(Boolean).join('\n\n')
    if (!text) return null
    if (text === body && sections.length === source.sections?.length) return message
    return { ...message, source: { ...source, sections }, content: [{ type: 'text', text }] }
  }
  if (message?.role === 'assistant') return !source || source.kind === 'model' || tavernProducers.has(sourceProducerName(source)) ? message : null
  if (message?.role === 'tool') return message
  if (message?.role !== 'user') return null
  if (!source || ['user', 'human'].includes(source.kind) || tavernProducers.has(sourceProducerName(source)) ||
    reminders.tavernIsSkillReminder(source) || isCompactionCheckpointMessage(message)) return message
  return null
}

export function filterPlayMessages(messages, systemSections, { skills, skillToolEnabled = false } = {}) {
  if (!Array.isArray(messages)) return messages
  const projected = skills ? projectPlaySkillMessages(messages, skills, skillToolEnabled) : messages
  const allowed = projected.map(message => playMessage(message, systemSections))
  return allowed.every((message, index) => message === projected[index]) ? projected : allowed.filter(Boolean)
}

const PROJECTED = 'tavern-play-context'

// Also check at the model boundary. DSH can refresh required contexts after assembly,
// and resumed sessions may still carry previously accepted host messages.
export function installPlayContextPolicy(ctx, { stateFor, systemSectionsFor, skillsFor }) {
  ctx.on('llm/stream', (request, next) => (async function * () {
    const state = request?.sessionId && request.purpose === undefined && !requestHandledBy(request, PROJECTED)
      ? await stateFor(request.sessionId) : null
    if (isPlayMode(state?.mode)) {
      const systemSections = text => systemSectionsFor?.(request.sessionId, text)
      const skillToolEnabled = !normalizeDisabledForegroundTools(state.disabledForegroundTools).includes(USE_SKILL_TOOL)
      const skills = hasPlaySkillContext(request.messages) ? (await skillsFor?.(request.sessionId, state)) || [] : undefined
      const messages = filterPlayMessages(request.messages, systemSections, { skills, skillToolEnabled })
      const { toolHistory, system, ...current } = request
      if (typeof system === 'string' && system) {
        // Older hosts render plain `system` text instead of structured system messages.
        const text = labelledSystem(system, systemSections).map(section => section.text).join('\n\n')
        if (text) current.system = text
      }
      yield * ctx.llm.stream(markRequestHandled({ ...current, messages }, PROJECTED))
      return
    }
    yield * next()
  })(), { prepend: true })
}
