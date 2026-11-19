import { sessionEvents } from '../domain/session-events.js'

export const SKIP_SESSION_LOG_REPAIR = Symbol('skip session log repair')

// An Agent owns the persistence writer before it appears in the live stores.
// Share that pending acquisition, and retain its handle until every borrower ends.
const leases = new WeakMap()

export async function readHostSessionEvents({ sessions, agents, persistence }, sessionId) {
  const live = sessions.get(sessionId) || agents.get(sessionId)?.session
  if (live) return sessionEvents(live)
  const reader = await persistence.open(sessionId, 'read', { [SKIP_SESSION_LOG_REPAIR]: true })
  try { return (await reader.read(0)).events }
  finally { await reader.close() }
}

export async function acquireHostSession(host, sessionId, { requireAgent = false } = {}) {
  const { sessions, agents } = host
  let entries = leases.get(agents)
  if (!entries) { entries = new Map(); leases.set(agents, entries) }
  let entry = entries.get(sessionId)
  if (entry?.closing) {
    await entry.closing
    return acquireHostSession(host, sessionId, { requireAgent })
  }
  if (!entry) {
    const agent = agents.get(sessionId)
    const session = requireAgent ? agent?.session : sessions.get(sessionId) || agent?.session
    if (session) return { agent: agent?.session === session ? agent : { session }, async dispose() {} }
    entry = { references: 0 }
    entries.set(sessionId, entry)
    entry.ready = Promise.resolve().then(() => host.resume ? host.resume(sessionId) : agents.resume({ resumeSessionId: sessionId }))
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
    const disposal = Promise.resolve().then(() => handle.dispose()).finally(() => entries.delete(sessionId))
    // Waiters can try to acquire once teardown settles. Its error belongs to the disposer.
    entry.closing = disposal.catch(() => {})
    await disposal
  } }
}

async function withLease(host, sessionId, options, work) {
  const handle = await acquireHostSession(host, sessionId, options)
  try { return await work(handle.agent) }
  finally { await handle.dispose() }
}

export function withHostSession(host, sessionId, work) {
  return withLease(host, sessionId, undefined, agent => work(agent.session))
}

export function withHostAgent(host, sessionId, work) {
  return withLease(host, sessionId, { requireAgent: true }, work)
}
