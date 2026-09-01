import { randomUUID } from 'node:crypto'

function object(value) {
  return value !== null && typeof value === 'object' ? value : null
}

function eventAt(events, seq) {
  const direct = events[seq]
  if (direct && Number(direct.seq) === Number(seq)) return direct
  return events.find(event => event && Number(event.seq) === Number(seq)) || null
}

function modelSourceOf(event) {
  const data = object(event && event.data)
  const message = object(data && data.message)
  const source = object(message && message.source)
  return source && source.kind === 'model' ? source : null
}

function isFailedTurnCleanup(event) {
  const source = event && event.type === 'user/message' && event.data && event.data.source
  return source && source.kind === 'plugin' && source.plugin === 'dsh-tavern-failed-turn-cleanup'
}

// Legacy regeneration left a durable empty replacement at the saved story turn.
// Surface replacement hides messages, not DSH's turn/end error nodes. Derive
// their display suppression without changing the immutable event history.
export function supersededRegenerationErrorTurns(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const syntheticTurns = new Set((Array.isArray(input && input.suppressedDshTurns) ? input.suppressedDshTurns : []).map(Number))
  if (syntheticTurns.size === 0) return []
  const bySeq = new Map()
  const endings = new Map()
  const failures = []
  const hidden = new Set()
  for (const event of events) {
    if (!event || !Number.isSafeInteger(event.seq)) continue
    bySeq.set(event.seq, event)
    if (event.type === 'turn/end') {
      endings.set(Number(event.data.turn), event)
      if (event.data.reason && event.data.reason.kind === 'error') failures.push(event)
    }
    const op = event.surfaceOp
    if (event.type !== 'assistant/message' || modelSourceOf(event) === null || !op || op.op !== 'replace') continue
    const content = event.data.message.content
    if (!Array.isArray(content) || content.length !== 0) continue
    const body = bySeq.get(op.end)
    const turn = Number(body && body.data && body.data.turn)
    const end = endings.get(turn)
    if (!body || body.type !== 'assistant/message' || modelSourceOf(body) === null || !syntheticTurns.has(turn) || turn === Number(event.data.turn)) continue
    if (!end || end.seq <= body.seq || end.seq >= event.seq || end.data.reason.kind !== 'completed') continue
    if (!Array.isArray(body.data.message.content) || !body.data.message.content.some(block => block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')) continue
    for (const failure of failures) {
      if (failure.seq >= op.start && failure.seq <= op.end) hidden.add(Number(failure.data.turn))
    }
  }
  return [...hidden].sort((a, b) => a - b)
}

export function locateRegenerationSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const turn = Number(input && input.turn)
  if (!Number.isSafeInteger(turn) || turn < 1) return null
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const event = eventAt(events, nodes[index])
    if (!event || event.type !== 'assistant/message' || Number(event.data && event.data.turn) !== turn) continue
    const source = modelSourceOf(event)
    if (source === null) continue
    // Current swipes leave a non-empty replacement; legacy swipes can be empty.
    // Plugin cleanup markers and messages from other turns are not the saved story body.
    return Object.freeze({ assistantSeq: Number(nodes[index]), turn, source })
  }
  return null
}

export function locateRollbackSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  let userIndex = -1
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const event = eventAt(events, nodes[index])
    if (event && event.type === 'user/message' && !isFailedTurnCleanup(event)) {
      userIndex = index
      break
    }
  }
  if (userIndex < 0) return null

  let assistantIndex = -1
  let assistantEvent = null
  let source = null
  for (let index = nodes.length - 1; index > userIndex; index -= 1) {
    const event = eventAt(events, nodes[index])
    const candidateSource = event && event.type === 'assistant/message' ? modelSourceOf(event) : null
    if (candidateSource !== null) {
      assistantIndex = index
      assistantEvent = event
      source = candidateSource
      break
    }
  }
  if (assistantIndex < 0 || assistantEvent === null || source === null) return null

  const shadowedSeqs = nodes.slice(userIndex)
  return Object.freeze({
    userSeq: Number(nodes[userIndex]),
    assistantSeq: Number(nodes[assistantIndex]),
    endSeq: Number(shadowedSeqs[shadowedSeqs.length - 1]),
    turn: Math.max(0, Number(assistantEvent.data && assistantEvent.data.turn) || 0),
    step: Math.max(1, Number(assistantEvent.data && assistantEvent.data.step) || 1),
    source,
    shadowedSeqs: Object.freeze(shadowedSeqs.slice())
  })
}

export function planRegenerationSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const oldAssistantSeq = Number(input && input.oldAssistantSeq)
  const eventStart = Math.max(0, Number(input && input.eventStart) || 0)
  const oldAssistantIndex = nodes.indexOf(oldAssistantSeq)
  if (oldAssistantIndex < 0) throw new Error('旧正文已经不在当前模型消息面中')

  let finalAssistantIndex = -1
  for (let index = nodes.length - 1; index > oldAssistantIndex; index -= 1) {
    const seq = Number(nodes[index])
    if (seq < eventStart) continue
    const event = eventAt(events, seq)
    if (event && event.type === 'assistant/message' && modelSourceOf(event) !== null) {
      finalAssistantIndex = index
      break
    }
  }
  if (finalAssistantIndex < 0) throw new Error('重新生成流程未在当前模型消息面中产生正文')

  const shadowedSeqs = nodes.slice(oldAssistantIndex, finalAssistantIndex + 1).map(Number)
  if (shadowedSeqs.length === 0) throw new Error('重新生成流程没有需要替换的旧消息')
  return Object.freeze({
    start: shadowedSeqs[0],
    end: shadowedSeqs[shadowedSeqs.length - 1],
    finalAssistantSeq: Number(nodes[finalAssistantIndex]),
    shadowedSeqs: Object.freeze(shadowedSeqs)
  })
}

export function planFailedTurnSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const turn = Math.max(0, Number(input && input.turn) || 0)
  let startSeq = -1
  let endSeq = -1
  for (const event of events) {
    if (!event || !Number.isSafeInteger(event.seq) || Number(event.data && event.data.turn) !== turn) continue
    if (event.type === 'turn/start') startSeq = Math.max(startSeq, event.seq)
    if (event.type === 'turn/end') endSeq = Math.max(endSeq, event.seq)
  }
  if (startSeq < 0 || endSeq <= startSeq) return null

  let firstIndex = -1
  let lastIndex = -1
  for (let index = 0; index < nodes.length; index += 1) {
    const seq = Number(nodes[index])
    if (seq <= startSeq || seq >= endSeq) continue
    if (firstIndex < 0) firstIndex = index
    lastIndex = index
  }
  if (firstIndex < 0 || lastIndex < firstIndex) return null

  const shadowedSeqs = nodes.slice(firstIndex, lastIndex + 1).map(Number)
  const outsideTurn = shadowedSeqs.find(function (seq) { return seq <= startSeq || seq >= endSeq })
  if (outsideTurn !== undefined) throw new Error('失败回合的模型消息面不是连续区间，无法安全清理: ' + outsideTurn)
  return Object.freeze({
    start: shadowedSeqs[0],
    end: shadowedSeqs[shadowedSeqs.length - 1],
    shadowedSeqs: Object.freeze(shadowedSeqs)
  })
}

export function clearFailedTurnSurface(input) {
  const session = input && input.session
  if (!session || typeof session.append !== 'function') return 0
  const cleanup = planFailedTurnSurface({
    events: session.events,
    nodes: session.surface && session.surface.nodes,
    turn: input.turn
  })
  if (cleanup === null) return 0
  const makeId = typeof input.id === 'function' ? input.id : function () { return randomUUID() }
  // DSH permits plugin-injected user messages, but assistant messages must be
  // model-sourced on restore. Keep this empty tombstone explicitly plugin-owned.
  session.append('user/message', {
    id: makeId(),
    role: 'user',
    content: [],
    source: { kind: 'plugin', plugin: 'dsh-tavern-failed-turn-cleanup' }
  }, {
    surfaceOp: { op: 'replace', start: cleanup.start, end: cleanup.end },
    sourceEventSeqs: cleanup.shadowedSeqs
  })
  return cleanup.shadowedSeqs.length
}

/** Remove only the temporary DSH surface nodes appended by a regeneration attempt. */
export function clearRegenerationAttemptSurface(input) {
  const session = input && input.session
  if (!session || typeof session.append !== 'function') return 0
  const nodes = session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
  const eventStart = Math.max(0, Number(input && input.eventStart) || 0)
  const temporary = nodes.filter(function (seq) { return Number(seq) >= eventStart }).map(Number)
  if (temporary.length === 0) return 0
  const firstIndex = nodes.indexOf(temporary[0])
  const lastIndex = nodes.indexOf(temporary[temporary.length - 1])
  if (firstIndex < 0 || lastIndex < firstIndex || lastIndex - firstIndex + 1 !== temporary.length) {
    throw new Error('重新生成临时消息不是连续区间，无法安全清理')
  }
  const makeId = typeof input.id === 'function' ? input.id : function () { return randomUUID() }
  session.append('user/message', {
    id: makeId(),
    role: 'user',
    content: [],
    source: { kind: 'plugin', plugin: 'dsh-tavern-regeneration-abort' }
  }, {
    surfaceOp: { op: 'replace', start: temporary[0], end: temporary[temporary.length - 1] },
    sourceEventSeqs: temporary
  })
  return temporary.length
}

export function hasRollbackMessages(messages) {
  const list = Array.isArray(messages) ? messages : []
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = object(list[index])
    if (!message || message.role !== 'assistant' || message.greeting === true) continue
    const user = object(list[index - 1])
    return user !== null && user.role === 'user'
  }
  return false
}
