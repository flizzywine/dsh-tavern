import { markRequestHandled, requestHandledBy } from './request-lineage.js'
import { isPluginSource, sourceProducerName, isSystemPromptSource } from './message-source.js'

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

// The native Skill catalogue belongs in the request: it names what the retained
// skill tool can load, including writing Skills scoped to the current game.
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
    if (isBlockedHostMessage(message)) {
      changed = true
      return []
    }
    const isRuntimeContext = message?.role === 'user' &&
      (source?.kind === 'runtime-context' || isSystemPromptSource(source))
    const isSystemPrompt = message?.role === 'system' && isSystemPromptSource(source)
    if (!isRuntimeContext && !isSystemPrompt) return [message]
    if (!Array.isArray(source.sections)) {
      if (isRuntimeContext) {
        changed = true
        return []
      }
      return [message]
    }
    const sections = source.sections.filter(section => !isBlockedSection(section?.name))
    if (sections.length === source.sections.length) return [message]
    changed = true
    const body = sections.map(section => section.text).filter(Boolean).join('\n\n')
    if (!body) return []
    const text = message.role === 'user'
      ? 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\n\n' + body : body
    return [{ ...message, source: { ...source, sections }, content: [{ type: 'text', text }] }]
  })
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
