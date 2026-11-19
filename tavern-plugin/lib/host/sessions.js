// An Agent owns the persistence writer before it appears in the live stores.
// Share that pending acquisition, and retain its handle until every borrower ends.
const leases = new WeakMap()

export async function acquireHostSession({ sessions, agents }, sessionId) {
  let entries = leases.get(agents)
  if (!entries) { entries = new Map(); leases.set(agents, entries) }
  let entry = entries.get(sessionId)
  if (entry?.closing) {
    await entry.closing
    return acquireHostSession({ sessions, agents }, sessionId)
  }
  if (!entry) {
    const agent = agents.get(sessionId)
    const session = sessions.get(sessionId) || agent?.session
    if (session) return { agent: agent || { session }, async dispose() {} }
    entry = { references: 0 }
    entries.set(sessionId, entry)
    entry.ready = Promise.resolve().then(() => agents.resume({ resumeSessionId: sessionId }))
  }
  entry.references++
  let handle
  try { handle = await entry.ready }
  catch (error) {
    if (entries.get(sessionId) === entry) entries.delete(sessionId)
    throw error
  }
  let released = false
  return { agent: handle.agent, async dispose() {
    if (released) return
    released = true
    if (--entry.references > 0) return
    entry.closing = Promise.resolve().then(() => handle.dispose())
    try { await entry.closing }
    finally { if (entries.get(sessionId) === entry) entries.delete(sessionId) }
  } }
}

// Callers decide whether to flush: reads and writes share lifetime rules.
export async function withHostSession(host, sessionId, work) {
  const handle = await acquireHostSession(host, sessionId)
  try { return await work(handle.agent.session) }
  finally { await handle.dispose() }
}
