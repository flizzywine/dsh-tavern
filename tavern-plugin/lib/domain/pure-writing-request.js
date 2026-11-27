import { isCompactionCheckpointMessage } from './compaction-checkpoint.js'
import { inputKind } from './session-turn-input.js'
import { promptSection } from './prompt-section.js'
import { withCurrentWorldbook } from './session-stable-prefix.js'
import { runtimePresetPhaseMessages } from './runtime-preset-lifecycle.js'
import { STORY_SUBMIT_TOOL_NAME } from './story-tool-submission.js'
import { stripWritingSystemReminders, writingRequestMessages } from './writing-system-reminders.js'
import receipts from './writing-material-receipts.cjs'

export const PURE_WRITING_REQUEST = 'pure-writing'
export const WRITING_PREPARATION_REQUEST = 'writing-preparation'

const KEEP_FIXED_SECTIONS = new Set(['tavern:user-preference', 'tavern:character-card', 'tavern:constant-worldbook'])
const STORY_SECTIONS = new Set(['base', 'card', 'card-instruction', 'script', 'guide'])
const { tavernIsWritingInjection, tavernWithoutPrivateWritingReceipts, tavernWritingReceiptSections } = receipts

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
      const visible = tavernWithoutPrivateWritingReceipts(message)
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

const PURE_WRITING_SECTION_NAMES = Object.freeze({
  base: 'tavern:story-base',
  card: 'tavern:character-card',
  'card-instruction': 'tavern:card-post-history',
  script: 'tavern:script-reference',
  guide: 'tavern:user-guide'
})

export function pureWritingSystemSections(fixedSections, frame, back = []) {
  const sections = fixedSections
    .filter(section => section && typeof section.text === 'string' && section.text !== '')
    .map(section => ({ name: section.name || '', text: section.text }))
  const variableConstants = new Set(frame.source?.worldBook?.variableConstantRefs ?? frame.source?.worldBook?.messageVariableConstantRefs ?? [])
  const worldbook = (frame.source?.regenerationMaterials?.worldbookEntries || [])
    .filter(entry => variableConstants.has(entry.ref)).map(entry => entry.text).join('\n\n')
  if (worldbook) sections.push({ name: 'tavern:constant-worldbook', text: promptSection('lorebook_constant', worldbook), writingPreparationTail: true })
  const cardSystem = frame.source?.card?.systemPromptText
  if (cardSystem) sections.push({ name: 'tavern:card-system-prompt', text: promptSection('card_system', cardSystem) })
  for (const item of frame.contributions) {
    const source = item.source
    if (source.stage === 'runtime-preset') {
      if (item.text) sections.push({ name: 'tavern:runtime-preset-middle', text: item.text })
    } else if (source.stage === 'context-plan' && STORY_SECTIONS.has(source.sectionKind)) {
      if (item.text) sections.push({ name: PURE_WRITING_SECTION_NAMES[source.sectionKind] || 'tavern:dsh-system', text: item.text })
    }
  }
  for (const entry of back) {
    if (entry?.content) sections.push({ name: 'tavern:runtime-preset-back', text: entry.content })
  }
  return sections.filter(section => Boolean(section.text))
}

export function pureWritingSystem(fixedSections, frame, back = []) {
  return pureWritingSystemSections(fixedSections, frame, back).map(section => section.text).filter(Boolean).join('\n\n')
}

export function pureWritingContext(system, messages, sections) {
  const conversation = writingConversation(writingRequestMessages(messages || []))
  const inputAt = conversation.findLastIndex(message => message.role === 'user' && inputKind(message))
  if (inputAt < 0) throw new Error('纯净写作找不到本轮玩家输入')
  const context = { system: stripWritingSystemReminders(system), messages: structuredClone(conversation.slice(0, inputAt + 1)) }
  if (sections) {
    const join = entries => stripWritingSystemReminders(entries.map(section => section.text).filter(Boolean).join('\n\n'))
    context.preparation = {
      system: join(sections.filter(section => !section.writingPreparationTail)),
      snapshot: join(sections.filter(section => section.writingPreparationTail))
    }
    const middle = sections.filter(section => section.name === 'tavern:runtime-preset-middle')
    const back = sections.filter(section => section.name === 'tavern:runtime-preset-back')
    if (middle.length || back.length) {
      const presetPhase = entries => ({ entries: entries.map(({ text }) => ({ role: 'user', content: stripWritingSystemReminders(text) })) })
      context.foregroundPreset = {
        middle: presetPhase(middle),
        back: presetPhase(back),
        system: join(sections.filter(section => section.name !== 'tavern:runtime-preset-middle' && section.name !== 'tavern:runtime-preset-back'))
      }
    }
  }
  return context
}

function writingPreparationHistory(messages) {
  return messages.map(message => {
    if (!tavernIsWritingInjection(message)) return message
    const content = message.content.map(block => {
      if (block?.type !== 'text' || typeof block.text !== 'string') return block
      const references = []
      const kept = []
      for (const { kind, text } of tavernWritingReceiptSections(block.text)) {
        if (kind === '世界书' || kind === '剧情记忆') references.push(text.split(/\r?\n/, 1)[0])
        else kept.push(text)
      }
      if (!references.length) return block
      return { ...block, text: ['【已交接资料索引】\n需要原文时，按条目标题或剧情轮次查询。\n' + references.join('\n'), ...kept].join('\n\n') }
    })
    return { ...message, content }
  })
}

export function projectWritingPreparationRequest(request, context) {
  // Native history keeps every task for the trace. The foreground conversation
  // already carries previous receipts, so replay only this task's native calls.
  const start = request.messages.findLastIndex(message => message.source?.kind === 'plugin:dsh-tavern'
    && message.source.form === 'writing-preparation-task')
  const task = writingRequestMessages(request.messages.slice(Math.max(0, start)).filter(message => message.role !== 'system'))
  const preparation = start >= 0 && task[0]?.role === 'user' && Array.isArray(task[0].content) && context.preparation
  const messages = structuredClone(preparation ? writingPreparationHistory(context.messages) : context.messages)
  if (preparation?.snapshot) {
    const snapshot = promptSection('writing_current_worldbook', preparation.snapshot)
    task[0] = { ...task[0], content: [...task[0].content, { type: 'text', text: snapshot }] }
  }
  if (context.automaticWorldbook) messages.push(context.automaticWorldbook)
  if (context.worldbookTitleHints) messages.push(context.worldbookTitleHints)
  return { ...request, system: preparation ? preparation.system : context.system, messages: [...messages, ...task] }
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
  const preset = context.foregroundPreset
  if (preset) messages.push(...runtimePresetPhaseMessages(preset, 'middle'))
  if (injection) messages.push(injection)
  if (preset) messages.push(...runtimePresetPhaseMessages(preset, 'back'))
  // Existing host protocol choices refer to the tool list that was replaced.
  const { toolChoice, ...base } = request
  return { ...base, system: preset?.system ?? context.system, messages, tools: pureWritingTools(request.tools) }
}
