import { TIMELINE_MEMBERS, participantOf } from './background-members.js'
const path = 'background-session-retirement.json'

/** Native Session logs remain readable; only retired Tavern workers lose discovery/reuse. */
export function createBackgroundSessionRetirement(store, { readState, isRunning } = {}) {
  async function records() { return (await store.readJson(path)) || {} }
  // Recorded retirements, kept in memory for synchronous readers (the catalog view).
  const known = new Set()
  return {
    async load() { for (const id of Object.keys(await records())) known.add(id) },
    ids() { return known },
    async isRetired(id) { return Object.hasOwn(await records(), id) },
    async retire(id, parentId) {
      if (!id || !parentId) throw new Error('后台会话退休缺少会话编号')
      await store.updateJson(path, old => ({ ...old, [id]: { parentId, retiredAt: Date.now() } }))
      known.add(id)
    },
    async filter(rows, parentId) {
      const retired = await records()
      // Older releases did not record retirement. Fold only explicitly terminal,
      // superseded identities from Tavern's authority; never infer from the label alone.
      if (readState) {
        const parents = new Set(rows.filter(row => row.kind === 'child').map(row => row.parentId || parentId).filter(Boolean))
        for (const owner of parents) {
          const chat = await readState(owner)
          const participants = chat?.timeline?.participants
          // Each member's current Session; an operation is judged against its own member's
          // (书记's when its role has no timeline member).
          const current = role => participants?.[TIMELINE_MEMBERS.includes(participantOf(role)) ? participantOf(role) : 'background']?.sessionId
          if (!TIMELINE_MEMBERS.some(id => participants?.[id]?.sessionId)) continue
          const operations = Object.values(chat.timeline.operations || {})
          const running = new Set(operations.filter(op => op.status === 'running').map(op => op.startedSessionId))
          for (const op of operations) {
            if (op.kind === 'agent' && ['failed', 'interrupted'].includes(op.status) && current(op.role)
              && op.startedSessionId && op.startedSessionId !== current(op.role) && !running.has(op.startedSessionId)) {
              Object.defineProperty(retired, op.startedSessionId, { value: {parentId: owner}, enumerable: true, configurable: true })
            }
          }
        }
      }
      return rows.filter(row => {
        const record = retired[row.id]
        // Never hide unrelated children, still-running consumers or a subtree.
        return row.kind !== 'child' || !record || record.parentId !== (row.parentId || parentId)
          || row.activity === 'running' || isRunning?.(row.id) === true || row.hasChildren === true
      })
    }
  }
}

/** Adapt the pinned DSH discovery boundary; do not rewrite native descriptors or logs. */
export function installRetiredBackgroundFilter(subagents, retirement, sessionQuery) {
  const restore = []
  for (const method of ['listChildren', 'listDescendants']) {
    const original = subagents?.[method]
    if (typeof original !== 'function') continue
    const wrapped = async function (parentId, signal) {
      const rows = await original.call(this, parentId, signal)
      // DSH 0.2 catalog rows ({ id, createdAt, mode, label }) carry no kind: every row listed here is a child.
      const visible = new Set((await retirement.filter(rows.map(row => row.kind ? row : { ...row, kind: 'child' }), parentId)).map(row => row.id))
      signal?.throwIfAborted()
      return rows.filter(row => visible.has(row.id))
    }
    subagents[method] = wrapped
    restore.push(() => { if (subagents[method] === wrapped) subagents[method] = original })
  }
  // The native header counts global Session summaries independently of the
  // child catalog. Apply the same visibility rule at its public read boundary.
  const original = sessionQuery?.listSessions
  if (typeof original === 'function') {
    const wrapped = async function (signal) {
      const records = await original.call(this, signal)
      const parents = new Set(records.map(row => row.header.parentSession).filter(Boolean))
      const rows = records.map(record => ({
        id: record.header.id,
        kind: record.header.origin === 'subagent' ? 'child' : 'session',
        parentId: record.header.parentSession,
        hasChildren: parents.has(record.header.id),
      }))
      const visible = new Set((await retirement.filter(rows)).map(row => row.id))
      signal?.throwIfAborted()
      return records.filter(record => visible.has(record.header.id))
    }
    sessionQuery.listSessions = wrapped
    restore.push(() => { if (sessionQuery.listSessions === wrapped) sessionQuery.listSessions = original })
  }
  return () => { for (const undo of restore) undo() }
}

/**
 * DSH 0.2 shows a game's subagents (header count and popup) from the `subagentCatalog`
 * session projection, folded from append-only `subagent/catalog` facts in the game's
 * own log: a retired background worker stays listed forever. Filter that projection's
 * wire view, the one place every snapshot, push and cached checkpoint read passes
 * through. The log and the folded state stay untouched; running workers are never hidden.
 */
export function installRetiredCatalogView(projections, retirement, { isRunning } = {}) {
  const KEY = 'subagentCatalog'
  const hide = view => function (state) {
    const rows = view(state)
    const retired = retirement.ids()
    if (!Array.isArray(rows) || retired.size === 0) return rows
    return rows.filter(row => !retired.has(row?.id) || isRunning?.(row.id) === true)
  }
  const restore = []
  const registration = projections?.registrations?.get?.(KEY)
  const wire = registration?.def?.wire
  if (wire && typeof wire.view === 'function') {
    const original = wire.view
    wire.view = hide(original)
    restore.push(() => { wire.view = original })
  }
  // Registered after Tavern (load order is the host's): wrap the definition on its way in.
  const register = projections?.register
  if (typeof register === 'function') {
    const wrapped = function (definition) {
      if (definition?.key === KEY && typeof definition.wire?.view === 'function') {
        definition = { ...definition, wire: { ...definition.wire, view: hide(definition.wire.view) } }
      }
      return register.call(this, definition)
    }
    projections.register = wrapped
    restore.push(() => { if (projections.register === wrapped) projections.register = register })
  }
  return () => { for (const undo of restore) undo() }
}
