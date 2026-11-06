/** Only an active runner lease may delegate the parent game's library. */
export async function resolveWorldbookSkillChat(agent, { background, readChat }) {
  const sessionId = agent?.session?.id
  if (!sessionId) return null
  const request = background.activeRequestContext(sessionId)
  if (background.owns(sessionId) && !request) return null
  if (request && ['phone', 'stage-director'].includes(request.task)) return null
  const owner = request?.parentSessionId || sessionId
  if (!owner) return null
  const chat = await readChat(owner)
  if (!chat || chat.sessionId !== owner || !['story', 'script'].includes(chat.mode || 'story')) return null
  return { chat, authorizedSessionId: sessionId }
}
