import reminders from './system-reminders.cjs'

const { tavernIsSkillReminder, tavernIsRuntimeReminder } = reminders
export const stripWritingSystemReminders = reminders.tavernStripSystemReminders

export function isWritingHostReminder(message) {
  return message?.role === 'user' && (tavernIsRuntimeReminder(message.source) || tavernIsSkillReminder(message.source))
}

export function writingRequestMessages(messages) {
  return messages.filter(message => !isWritingHostReminder(message)).flatMap(message => {
    if (!Array.isArray(message?.content)) return [message]
    let changed = false
    const content = message.content.flatMap(block => {
      if (block?.type !== 'text' || typeof block.text !== 'string') return [block]
      const text = stripWritingSystemReminders(block.text)
      if (text === block.text) return [block]
      changed = true
      return text.trim() ? [{ ...block, text }] : []
    })
    if (!changed) return [message]
    return content.length ? [{ ...message, content }] : []
  })
}
