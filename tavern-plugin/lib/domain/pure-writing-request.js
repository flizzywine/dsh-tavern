import { isCompactionCheckpointMessage } from './compaction-checkpoint.js'
import { inputKind } from './session-turn-input.js'
import { promptSection } from './prompt-section.js'
import { withCurrentWorldbook } from './session-stable-prefix.js'
import { STORY_SUBMIT_TOOL_NAME } from './story-tool-submission.js'
import { stripWritingSystemReminders, writingRequestMessages } from './writing-system-reminders.js'
import receipts from './writing-material-receipts.cjs'

export const PURE_WRITING_REQUEST = 'pure-writing'
export const WRITING_PREPARATION_REQUEST = 'writing-preparation'

const KEEP_FIXED_SECTIONS = new Set(['tavern:user-preference', 'tavern:character-card', 'tavern:constant-worldbook'])
const STORY_SECTIONS = new Set(['base', 'card', 'card-instruction', 'script', 'guide'])
const { tavernIsWritingInjection, tavernWithoutInjectedSkills } = receipts

export function pureWritingTools(tools) {
  return (tools || []).filter(tool => tool?.name === STORY_SUBMIT_TOOL_NAME)
}

export function pureWritingFixedSections(sections, frame) {
  const fixed = sections.filter(section => KEEP_FIXED_SECTIONS.has(section.name))
  const prefix = frame?.source?.regenerationMaterials?.worldbookPrefix
  // A prepared empty prefix also supersedes the opening snapshot.
  return typeof prefix === 'string' ? withCurrentWorldbook(fixed, prefix) : fixed
}

/** Keep the native story history, including prose carried over by compaction. */
function writingConversation(messages) {
  return (messages || []).flatMap(message => {
    if (message?.role === 'user') {
      if (!inputKind(message) && !isCompactionCheckpointMessage(message) && !tavernIsWritingInjection(message)) return []
      const visible = tavernWithoutInjectedSkills(message)
      return visible?.content?.length ? [visible] : []
    }
    if (message?.role !== 'assistant' || !(message.source?.kind === 'model' || !message.source)) return []
    const content = (message.content || []).filter(block => block.type === 'text')
    if (!content.some(block => block.text?.trim())) return []
    const { id, role } = message
    const source = message.source && { kind: 'model', provider: message.source.provider, model: message.source.model }
    return [{ id, role, ...(source ? { source } : {}), content }]
  })
}

export function pureWritingSystem(fixedSections, frame, back = []) {
  const sections = fixedSections.map(section => section.text)
  const cardSystem = frame.source?.card?.systemPromptText
  if (cardSystem) sections.push(promptSection('card_system', cardSystem))
  for (const item of frame.contributions) {
    const source = item.source
    if ((source.stage === 'context-plan' && STORY_SECTIONS.has(source.sectionKind)) || source.stage === 'runtime-preset') sections.push(item.text)
  }
  return [...sections, ...back.map(entry => entry.content)].filter(Boolean).join('\n\n')
}

export function pureWritingContext(system, messages) {
  const conversation = writingConversation(writingRequestMessages(messages || []))
  const inputAt = conversation.findLastIndex(message => message.role === 'user' && inputKind(message))
  if (inputAt < 0) throw new Error('纯净写作找不到本轮玩家输入')
  return { system: stripWritingSystemReminders(system), messages: structuredClone(conversation.slice(0, inputAt + 1)) }
}

export function projectWritingPreparationRequest(request, context) {
  // Native history keeps every task for the trace. The foreground conversation
  // already carries previous receipts, so replay only this task's native calls.
  const start = request.messages.findLastIndex(message => message.source?.kind === 'plugin:dsh-tavern'
    && message.source.form === 'writing-preparation-task')
  const task = request.messages.slice(Math.max(0, start)).filter(message => message.role !== 'system')
  const messages = structuredClone(context.messages)
  if (context.worldbookTitleHints) messages.push(context.worldbookTitleHints)
  return { ...request, system: context.system,
    messages: [...messages, ...writingRequestMessages(task)] }
}

export function pureWritingInjection(frame, material) {
  const text = stripWritingSystemReminders(material || '')
  if (!text.trim()) return undefined
  return {
    id: frame.frameId + ':inject',
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin:dsh-tavern-pure-writer', form: 'inject', trace: { turn: frame.turn } }
  }
}

export function projectPureWritingRequest(request, { context, injection }) {
  const messages = structuredClone(context.messages)
  if (injection) messages.push(injection)
  // Existing host protocol choices refer to the tool list that was replaced.
  const { toolChoice, ...base } = request
  return { ...base, system: context.system, messages, tools: pureWritingTools(request.tools) }
}
