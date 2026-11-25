export async function isTavernAgentSession(sessionId, { isGame, isBackground, readHeader }) {
  const visited = new Set()
  while (sessionId && !visited.has(sessionId)) {
    if (isBackground(sessionId) || await isGame(sessionId)) return true
    visited.add(sessionId)
    const header = await readHeader(sessionId)
    sessionId = header?.origin === 'subagent' ? header.parentSession : ''
  }
  return false
}
