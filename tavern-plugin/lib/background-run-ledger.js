// One record per background run, kept per game, so the status panel can show what ran,
// what is queued and what failed. In memory only: durable task truth stays in the story timeline.
const TRANSITIONS = {
  queued: ['running', 'cancelled', 'failed'],
  running: ['completed', 'failed', 'cancelled'],
  // The run finished, but the story changed before its result could be saved.
  completed: ['discarded'],
  discarded: [],
  failed: [],
  cancelled: []
}
const KEPT_PER_GAME = 30

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

export function createBackgroundRunLedger(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now
  const games = new Map()
  let sequence = 0

  function move(record, status, fields) {
    if (!TRANSITIONS[record.status].includes(status)) return
    Object.assign(record, fields, { status })
  }

  function begin(input) {
    const gameId = str(input.sessionId)
    const record = {
      id: 'run-' + ++sequence,
      task: str(input.task) || 'background',
      plugin: str(input.pluginName),
      lane: input.persistent === true ? 'resident' : 'ephemeral',
      member: str(input.member),
      turn: Math.max(0, Number(input.turn) || 0),
      model: str(input.selection?.model),
      status: 'queued',
      queuedAt: now()
    }
    const list = games.get(gameId) || []
    list.push(record)
    // Drop the oldest finished runs; unfinished ones always stay visible.
    while (list.length > KEPT_PER_GAME) {
      const index = list.findIndex(item => !['queued', 'running'].includes(item.status))
      if (index < 0) break
      list.splice(index, 1)
    }
    games.set(gameId, list)
    return {
      // The background session the run used, so a later discard can find it.
      bind: agentSessionId => { record.agentSessionId = str(agentSessionId) },
      start: selection => move(record, 'running', { startedAt: now(), ...(selection?.model ? { model: str(selection.model) } : {}) }),
      finish: () => move(record, 'completed', { endedAt: now() }),
      fail: (error, cancelled) => move(record, cancelled ? 'cancelled' : 'failed', { endedAt: now(), ...(cancelled ? {} : { error: str(error?.message || error).slice(0, 300) }) })
    }
  }

  // The newest completed run of this task in that background session.
  function discard({ sessionId, role, agentSessionId }) {
    const pool = str(sessionId) ? games.get(str(sessionId)) || [] : [...games.values()].flat()
    const record = pool.findLast(item => item.status === 'completed' && item.task === str(role) &&
      (!agentSessionId || item.agentSessionId === str(agentSessionId)))
    if (record) move(record, 'discarded', { discardedAt: now() })
  }

  // Newest first.
  function list(gameId) {
    return (games.get(str(gameId)) || []).slice().reverse().map(record => ({ ...record }))
  }

  // The coordinator's background slot: who held it when, and who was turned away.
  const locks = new Map()
  function lock(event) {
    const gameId = str(event?.sessionId)
    if (!gameId) return
    const list = locks.get(gameId) || []
    if (event.kind === 'held') list.push({ kind: 'held', slot: str(event.slot), role: str(event.role), operationId: str(event.operationId), from: now() })
    else if (event.kind === 'released') {
      const held = list.findLast(item => item.kind === 'held' && item.operationId === str(event.operationId) && item.to === undefined)
      if (held) Object.assign(held, { to: now(), status: str(event.status) })
    } else if (event.kind === 'refused') list.push({ kind: 'refused', slot: str(event.slot), role: str(event.role), holder: str(event.holder), at: now() })
    locks.set(gameId, list.slice(-KEPT_PER_GAME * 2))
  }

  function locksOf(gameId) {
    return (locks.get(str(gameId)) || []).map(item => ({ ...item }))
  }

  function forget(gameId) {
    games.delete(str(gameId))
    locks.delete(str(gameId))
  }

  return Object.freeze({ begin, discard, list, forget, lock, locks: locksOf })
}
