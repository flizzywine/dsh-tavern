import { TIMELINE_MEMBERS, memberOf } from './background-members.js'

// The timeline owns the current binding. A historical candidate pointer must
// not override an explicitly empty/rebuilding timeline participant.
export function currentBackgroundSessionId(chat) {
  const participant = chat?.timeline?.participants?.background
  if (participant) return participant.status === 'needs-session' ? '' : String(participant.sessionId || '')
  if (chat?.candidateAgent) return String(chat.candidateAgent.sessionId || '')
  if (Array.isArray(chat?.messages) || chat?.timeline) return ''
  return typeof chat?.backgroundSessionId === 'string' ? chat.backgroundSessionId : null
}

// Every background member Session this game has used besides 书记's current one.
export function referencedBackgroundSessionIds(chat) {
  const ids = new Set()
  const add = value => { if (typeof value === 'string' && value) ids.add(value) }
  const members = participants => { for (const id of TIMELINE_MEMBERS) add(participants?.[id]?.sessionId) }
  add(chat?.candidateAgent?.sessionId)
  for (const id of TIMELINE_MEMBERS) if (id !== 'background') add(chat?.timeline?.participants?.[id]?.sessionId)
  for (const checkpoint of chat?.timeline?.checkpoints || []) members(checkpoint.participants)
  for (const operation of Object.values(chat?.timeline?.operations || {})) {
    members(operation.beforeParticipants)
    if (operation.kind === 'agent' && TIMELINE_MEMBERS.includes(memberOf(operation.role)) && !['running', 'pending'].includes(operation.status)) add(operation.startedSessionId)
  }
  return [...ids]
}
