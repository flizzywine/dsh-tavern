// Borrow loaded sessions; own only handles resumed by this operation. Callers
// decide whether to flush: reads and writes share lifetime rules, not persistence.
export async function withHostSession({ sessions, agents }, sessionId, work) {
  const loaded = sessions.get(sessionId) || agents.get(sessionId)?.session
  if (loaded) return work(loaded)
  const handle = await agents.resume({ resumeSessionId: sessionId })
  try { return await work(handle.agent.session) }
  finally { await handle.dispose() }
}
