import { createScopedMessages } from './scoped-messages.js'
import { projectTavernHelperMessage } from './tavern-helper-context.js'

// The base is a private, detached read. Never hand its shared rows to a writer.
export function createMvuWorkingCopy(base, eventId) {
  const chat = { ...base, messages: createScopedMessages((base.messages || []).length, [], id => base.messages[id]) }
  for (const key of ['variables', 'mvu', 'tavernScriptPrompts', 'tavernHelperScriptVariables', 'macroState']) {
    if (base[key] !== undefined) chat[key] = structuredClone(base[key])
  }
  const dirty = new Set()
  return { chat, eventId, sequence: 0, dirty,
    touch(value) {
      const raw = value === undefined || value === null || value === 'latest' ? -1 : Number(value)
      const index = raw < 0 ? chat.messages.length + raw : raw
      if (!Number.isInteger(index) || !chat.messages[index]) throw new Error('消息楼层不存在: ' + value)
      if (!dirty.has(index)) { chat.messages[index] = structuredClone(chat.messages[index]); dirty.add(index) }
      return chat.messages[index]
    }
  }
}

export function projectMvuReceipt(work, targets) {
  const chat = work.chat
  const indices = [...new Set(targets.filter(t => Number.isInteger(t.messageId)).map(t => t.messageId))]
  return { version: 2, kind: 'transaction', chatId: chat.id,
    lifecycleRevision: chat.tavernHelperLifecycleRevision || 0, stateRevision: chat._storageRevision || 0,
    eventId: work.eventId, baseSequence: work.sequence, sequence: ++work.sequence,
    messages: indices.map(index => projectTavernHelperMessage(chat.messages[index], index)),
    ...(targets.some(t => t.type === 'chat') ? { chatVariables: structuredClone(chat.variables || {}) } : {}),
    ...(targets.some(t => t.type === 'script') ? { scriptVariables: structuredClone(chat.tavernHelperScriptVariables || {}) } : {}),
    ...(targets.some(t => t.type === 'prompts') ? { scriptPrompts: structuredClone(chat.tavernScriptPrompts || []) } : {}) }
}
