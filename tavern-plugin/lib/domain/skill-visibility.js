const SKILL_MESSAGE_KINDS = new Set(['skill-catalog', 'skill-invocation'])

export function filterSkillMessages(messages, mode) {
  if (mode === 'card' || !Array.isArray(messages)) return messages
  return messages.filter(function (message) {
    return !SKILL_MESSAGE_KINDS.has(message && message.source && message.source.kind)
  })
}
