// DSH rc.1 exposes immutable history through snapshotEvents(); older hosts
// expose events. Keep version differences here, without changing the Session.
export function sessionEvents(session) {
  if (!session) return []
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  return Array.isArray(session.events) ? session.events : []
}
