import { sessionEvents } from './session-events.js'

// DSH 0.2 lists a game's subagents from `subagent/catalog` facts in the game's own Session.
// Background agents created before Tavern wrote that fact (background-agent-sessions.js)
// have none, so the session header never shows them. When a game is opened, list its
// existing background children once, as DSH's subagent runtime would have at creation.
export function createBackgroundCatalogBackfill({ agents, sessionQuery, onListed, logger = console }) {
  const done = new Set()
  const running = new Map()

  async function backfill(parentId) {
    const parent = agents?.get?.(parentId)
    if (!parent?.session || typeof parent.session.append !== 'function') return 0
    if (typeof sessionQuery?.listSessions !== 'function' || typeof sessionQuery.readSession !== 'function') { done.add(parentId); return 0 }
    const listed = new Set(sessionEvents(parent.session).filter(event => event.type === 'subagent/catalog').map(event => event.data?.childId))
    // listSessions leaves out retired background workers (background-session-retirement.js).
    const children = (await sessionQuery.listSessions()).filter(record => record.header?.parentSession === parentId
      && record.header.origin === 'subagent' && !listed.has(record.header.id))
      .sort((a, b) => (Number(a.header.createdAt) || 0) - (Number(b.header.createdAt) || 0))
    let count = 0
    for (const record of children) {
      const snapshot = await sessionQuery.readSession(record.header.id).catch(() => null)
      const descriptor = snapshot?.events?.find(event => event.type === 'subagent/descriptor')?.data
      if (!descriptor || !['one-shot', 'continuable'].includes(descriptor.mode) || descriptor.mode === 'continuable' && typeof descriptor.label !== 'string') continue
      parent.session.append('subagent/catalog', { version: 0, childId: record.header.id, childCreatedAt: Math.max(0, Math.floor(Number(record.header.createdAt) || 0)),
        mode: descriptor.mode, ...(typeof descriptor.label === 'string' ? { label: descriptor.label } : {}) })
      count++
    }
    done.add(parentId)
    if (count) onListed?.(parentId, count)
    return count
  }

  /** Run once per game per process; later calls while it runs share the same work. */
  return function ensure(parentId) {
    const id = String(parentId || '')
    if (!id || done.has(id)) return Promise.resolve(0)
    if (!running.has(id)) {
      running.set(id, backfill(id)
        .catch(error => { logger.warn?.('dsh-tavern: 补登后台 Agent 到子智能体列表失败', id, error?.message || error); return 0 })
        .finally(() => running.delete(id)))
    }
    return running.get(id)
  }
}
