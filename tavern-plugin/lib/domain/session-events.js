import { producerSource } from './message-source.js'
// DSH rc.1 exposes immutable history through snapshotEvents(); older hosts
// expose events. Keep version differences here, without changing the Session.
export function sessionEvents(session) {
  if (!session) return []
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  return Array.isArray(session.events) ? session.events : []
}

// Released V4 rejects any surface event written outside an open turn, and the
// token meter rejects a step that starts before the previous one ended. Both the
// reserved head and the Agent's own step therefore have to agree on which turn
// and step is open, so read it from the log instead of assuming.
export function openTurnStep(events) {
  let turn = null
  let step = null
  for (const event of events) {
    if (event.type === 'turn/start') { turn = event.data?.turn ?? null; step = null }
    else if (event.type === 'turn/end') { turn = null; step = null }
    else if (event.type === 'step/start') step = event.data?.step ?? null
    else if (event.type === 'step/end') step = null
  }
  return { turn, step }
}

// The reserved system head is a surface node, and released V4 rejects a surface
// event written before any turn opened. The opening turn therefore opens before
// the head and stays open until the greeting closes it. A turn the host already
// opened (system-prompt assembly) is used as-is: never nest a second one.
export function ensureOpeningTurn(session) {
  if (!session || typeof session.append !== 'function') return
  const opened = () => sessionEvents(session)
  const current = openTurnStep(opened())
  // A host step is already open (system-prompt assembly): its turn is the right
  // place for the reserved head, and nesting another one is invalid. A reserved
  // turn that lost only its step/start is still ours to finish.
  if (current.turn !== null && !(current.turn === 1 && current.step === null)) return
  if (!opened().some(event => event.type === 'turn/start' && event.data?.turn === 1)) appendSessionEvent(session, 'turn/start', { turn: 1 })
  if (!opened().some(event => event.type === 'step/start' && event.data?.turn === 1 && event.data?.step === 1)) appendSessionEvent(session, 'step/start', { turn: 1, step: 1 })
}

// A session whose reserved opening turn never receives a greeting must still
// close it: the Agent opens its own first turn, and an open reserved turn makes
// that write collide. Closing it lets the Agent continue at the next turn.
export function closeOpeningTurn(session) {
  if (!session || typeof session.append !== 'function') return
  const current = openTurnStep(sessionEvents(session))
  if (current.turn !== 1 || current.step !== 1) return
  appendSessionEvent(session, 'step/end', { turn: 1, step: 1 })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
}

// Close a reserved opening turn that no greeting will ever fill, and publish it
// as already used: the Agent numbers its next turn from the turn it can read, so
// it continues after the reserved one instead of colliding with it.
export function releaseOpeningTurn(session, agent) {
  closeOpeningTurn(session)
  if (agent && agent.phase && agent.phase.kind === 'idle') {
    agent.phase.lastTurn = Math.max(Number(agent.phase.lastTurn) || 0, 1)
  }
}

// Surface edits are appended to an append-only log, so released V4 reads them at
// the tail: a replacement written while the previous turn already ended fails
// requireStep ("assistant/message does not match an open turn and step") and the
// whole archive stops loading. Give such an edit its own turn, and publish it as
// used so the Agent's next turn continues after it.
export function withSurfaceEditTurn(session, agent, write) {
  const current = openTurnStep(sessionEvents(session))
  const opened = current.turn === null || current.step === null
  let turn = current.turn
  let step = current.step
  if (opened) {
    turn = sessionEvents(session).reduce((highest, event) =>
      event.type === 'turn/start' ? Math.max(highest, Number(event.data?.turn) || 0) : highest, 0) + 1
    step = 1
    appendSessionEvent(session, 'turn/start', { turn })
    appendSessionEvent(session, 'step/start', { turn, step })
  }
  try {
    return write(turn, step)
  } finally {
    if (opened) {
      appendSessionEvent(session, 'step/end', { turn, step })
      appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
      if (agent && agent.phase && agent.phase.kind === 'idle') {
        agent.phase.lastTurn = Math.max(Number(agent.phase.lastTurn) || 0, turn)
      }
    }
  }
}

// Released V4 requires every assistant/tool surface event to sit inside an open
// turn AND an open step, carrying that step's numbers. Rewrites of older rounds
// run while their own step already closed: place the write in the step open now,
// open a step when only the turn is open, and fall back to a dedicated turn when
// nothing is open at all.
export function withSurfaceEditStep(session, agent, write) {
  const current = openTurnStep(sessionEvents(session))
  if (current.turn !== null && current.step !== null) return write(current.turn, current.step)
  if (current.turn !== null) {
    const step = sessionEvents(session).reduce((highest, event) =>
      event.type === 'step/start' && event.data?.turn === current.turn ? Math.max(highest, Number(event.data.step) || 0) : highest, 0) + 1
    appendSessionEvent(session, 'step/start', { turn: current.turn, step })
    try { return write(current.turn, step) } finally {
      appendSessionEvent(session, 'step/end', { turn: current.turn, step })
    }
  }
  return withSurfaceEditTurn(session, agent, write)
}

// V3 compaction pins only surface node zero. Reserve the host's empty system
// slot before Tavern seeds, so the first real Agent step fills that same slot.
// Existing surfaces are never reordered or rewritten.
export function ensureSessionSystemHead(session) {
  if (!(session?.header?.version >= 3) || session.surface.nodes.length > 0) return
  ensureOpeningTurn(session)
  appendSessionEvent(session, 'system/message', { turn: 1, step: 1, message: {
    id: 'tavern-system-head:' + session.id, role: 'system', content: [],
    source: producerSource('@deepseek-ai/dsh-system-prompt', undefined, 'system')
  } }, { surfaceOp: 'append' })
}

// Normalize only new writes at the host boundary. Existing events, seqs and
// provenance stay untouched; V3 migrations remain owned by DSH.
export function sessionEventData(session, type, data) {
  return session?.header?.version >= 3 && type === 'assistant/message' && data.stream === undefined
    ? { ...data, stream: [] } : data
}

export function appendSessionEvent(session, type, data, intent) {
  if (session?.header?.version >= 3) {
    if (intent) {
      intent = { ...intent }
      const op = intent.surfaceOp
      if (op && typeof op === 'object' && op.op === 'replace' && 'start' in op) {
        intent.surfaceOp = { op: 'replace', startSeq: op.start, endSeq: op.end }
      }
      if (type === 'assistant/message' && intent.surfaceOp === 'append') delete intent.sourceEventSeqs
    }
  }
  data = sessionEventData(session, type, data)
  return intent === undefined ? session.append(type, data) : session.append(type, data, intent)
}

export function surfaceReplacementRange(op) {
  return { start: op.startSeq ?? op.start, end: op.endSeq ?? op.end }
}
