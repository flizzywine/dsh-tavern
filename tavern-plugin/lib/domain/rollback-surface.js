import { storyEventTurn } from './session-upgrade-references.js'
import { isCompactionCheckpoint } from './compaction-checkpoint.js'
import { inputAttachments } from './player-input-content.js'
import { isRescuedHistoryMessage } from './chat-history-rescue.js'
import { createSessionSurfaceMutator, replaceSessionSurface } from './session-surface-mutations.js'
import { restoredSurfaceSeqs } from './surface-restoration.js'
import { sessionEvents, surfaceReplacementRange } from './session-events.js'
import { createSurfaceOwnership, planSurfaceRecovery, planSurfaceRange, SurfaceRecoveryError, OWNED } from './surface-recovery.js'
import { randomUUID } from 'node:crypto'
import { inputKind, isTurnInput, isNewTurnInput, isNewPlayerInput, isFailedTurnEnd } from './session-turn-input.js'
import { resolveRoundAnchor } from './round-anchor.js'
import { isPluginSource, isProducerSource, sourceProducerName } from './message-source.js'

function object(value) {
  return value !== null && typeof value === 'object' ? value : null
}

function eventAt(events, seq) {
  const direct = events[seq]
  if (direct && Number(direct.seq) === Number(seq)) return direct
  return events.find(event => event && Number(event.seq) === Number(seq)) || null
}

function contentText(value) {
  const message = object(value)
  const content = message && message.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content
    .filter(block => object(block) && block.type === 'text')
    .map(block => (typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
}

// Inputs that failed-turn replay may resend as the player's own message.
// Native user messages and legacy replay attempts qualify; regeneration inputs
// do not — they carry synthetic guidance text and belong to regenerate recovery.
function isReplayableInputSource(source) {
  return ['player', 'replay'].includes(inputKind({ source: object(source) }))
}

// The host chat UI turns a user/message into an input row only when its source
// kind is 'user'; every other kind is classified as a context node. A replay
// therefore has to resend the input as the player's own message, otherwise the
// text disappears from the transcript while the suppressed failure keeps it
// hidden. The original request identity is kept so provider prefix reuse and
// failure diagnostics stay continuous.
function replayInputSource(source) {
  const value = object(source) || {}
  const next = { kind: 'user' }
  if (typeof value.rpcId === 'string' && value.rpcId.trim() !== '') next.rpcId = value.rpcId.trim()
  if (typeof value.clientTimeZone === 'string' && value.clientTimeZone.trim() !== '') next.clientTimeZone = value.clientTimeZone
  return next
}

function modelSourceOf(event) {
  const data = object(event && event.data)
  const message = object(data && data.message)
  const source = object(message && message.source)
  return source && source.kind === 'model' ? source : null
}

function isForegroundContext(event) {
  const source = event?.type === 'user/message' && event.data?.source
  return isProducerSource(source, 'dsh-tavern') &&
    ['foreground-frame', 'worldbook-snapshot', 'snapshot', 'variable-changes'].includes(source.form)
}

function isRollbackUserTombstone(event) {
  const source = event && event.type === 'user/message' && event.data && event.data.source
  const producer = sourceProducerName(source)
  return producer !== '' && (
    producer === 'dsh-tavern-failed-turn-cleanup' ||
    producer === 'dsh-tavern-regeneration-abort' ||
    producer === 'dsh-tavern-context-window'
  )
}

function isRollbackAssistantTombstone(event, events) {
  if (!event || event.type !== 'assistant/message' || modelSourceOf(event) === null) return false
  const content = event.data && event.data.message && event.data.message.content
  const op = event.surfaceOp
  if (!Array.isArray(content) || content.length !== 0 || !op || op.op !== 'replace') return false
  const sources = Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs : []
  return sources.some(function (seq) {
    const sourceEvent = eventAt(events, seq)
    return sourceEvent && sourceEvent.type === 'user/message'
  })
}

function modelTurns(events, seqs) {
  const turns = new Set()
  for (const seq of seqs) {
    const event = eventAt(events, seq)
    const turn = storyEventTurn(event)
    if (event && event.type === 'assistant/message' && modelSourceOf(event) !== null && Number.isSafeInteger(turn) && turn > 0) turns.add(turn)
  }
  return [...turns].sort(function (left, right) { return left - right })
}

export function regenerationAttemptTurns(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const eventStart = Math.max(0, Number(input && input.eventStart) || 0)
  const end = regenerationAttemptEnd(events, eventStart)
  const belongs = createSurfaceOwnership(events).classify(event => event.seq >= eventStart && event.seq < end)
  return modelTurns(events, events.filter(event => event && belongs(event.seq) === OWNED).map(event => event.seq))
}

// A replaced reply does not disappear from the page by itself: the host keeps
// drawing the row it already built for that native turn, even though the node is
// gone from the surface. `replacingDshTurns` only covers the moment of
// generation, and the mapping that names the surviving turn is keyed by the
// STORY turn, which the host rows never carry. This list is the durable
// statement "these native turns used to hold a body that has been replaced":
// derived from the log, so it survives a reload.
export function supersededRegenerationTurns({ events = [], nodes = [], keepTurns = [] } = {}) {
  const visible = new Set(nodes.map(Number))
  const turns = new Set()
  // The replacements that still own the page, one per regenerated round: its body and
  // the turns it hides. The transcript draws append-origin events only, so the body
  // tells us which rows are the ones left to show that round.
  const rounds = []
  for (const event of events) {
    if (event?.type !== 'assistant/message' || event.surfaceOp?.op !== 'replace') continue
    // Only the replacement that is still the current node speaks for the page;
    // a chain of regenerations supersedes its own earlier replacements.
    if (visible.size && !visible.has(Number(event.seq))) continue
    // Only a regeneration writes a body for round N into a later turn; a seed or
    // repair rewrite carries no story turn and leaves the opening alone.
    if (!(Number(event.data?.message?.source?.tavernStoryTurn) > 0)) continue
    const story = Number(event.data?.message?.source?.tavernStoryTurn)
    const currentTurn = Number(event.data?.turn)
    const round = { body: contentText(event.data?.message), turns: new Set() }
    const seen = new Set()
    // A regeneration can leave an append copy in an edit turn and later replace
    // that copy with another edit turn. The visible replacement names only the
    // last attempt; follow the projections it superseded, or the copies from two
    // or three rerolls back stay on the page next to the newest body.
    function collect(sourceSeqs) {
      for (const seq of sourceSeqs || []) {
        if (seen.has(seq)) continue
        seen.add(seq)
        const original = eventAt(events, seq)
        if (!original || original.type !== 'assistant/message') continue
        const turn = Number(original.data?.turn)
        if (!Number.isSafeInteger(turn) || turn <= 0 || turn === currentTurn) continue
        // An earlier projection of the same round carries the next link of the chain.
        if (original.surfaceOp?.op === 'replace') {
          if (contentText(original.data?.message) !== '') { turns.add(turn); round.turns.add(turn) }
          if (Number(original.data?.message?.source?.tavernStoryTurn) === story) collect(original.sourceEventSeqs)
          continue
        }
        // Only a turn that actually showed a body leaves a visible row behind; the
        // empty markers of earlier attempts never drew anything.
        if (contentText(original.data?.message) === '') continue
        turns.add(turn); round.turns.add(turn)
      }
    }
    collect(event.sourceEventSeqs)
    if (round.body !== '' && round.turns.size) rounds.push(round)
  }
  if (turns.size === 0 || rounds.length === 0) return [...turns].sort((left, right) => left - right)
  // A round whose body only ever existed as a fold copy has that copy inside the
  // turn we are about to hide. Hiding it as well erases the only row the
  // transcript can draw, and the replacement itself stays model-only: the page
  // then shows the player's input with no reply at all. Keep such a turn unless
  // another drawable copy survives somewhere outside the hidden set. Judged per
  // round: another round's surviving copy says nothing about this one, and judging
  // them together blanked every regenerated round but the earliest.
  const drawable = new Map()
  for (const event of events) {
    if (event?.type !== 'assistant/message' || event.surfaceOp !== 'append') continue
    const turn = Number(event.data?.turn)
    if (!Number.isSafeInteger(turn) || turn <= 0) continue
    const body = contentText(event.data?.message)
    if (!drawable.has(body)) drawable.set(body, new Set())
    drawable.get(body).add(turn)
  }
  // The row the view maps a round to is the one it will render: an old tool
  // submission's fold copy carries the previous text, so it never matches the
  // replacement body, yet it is the only row the page can draw.
  const mapped = (Array.isArray(keepTurns) ? keepTurns : []).map(Number)
  const keep = []
  for (const round of rounds) {
    const copies = [...(drawable.get(round.body) || [])]
    if (copies.some(turn => !turns.has(turn))) continue
    const turn = mapped.find(value => round.turns.has(value)) ?? copies.find(value => round.turns.has(value))
    if (turn !== undefined) keep.push(turn)
  }
  for (const turn of keep) turns.delete(turn)
  return [...turns].sort((left, right) => left - right)
}

// The native turn the committed body was written into. The transcript draws
// append events only, so the round shows where its body is drawable: the range's
// tail when that tail is an append, otherwise the last append copy of the same
// body inside the replaced range. An old tool submission folds that copy before
// the projection learns to add one after the range; pointing such a round at the
// replacement's own turn leaves the page with no row to draw (#283).
export function projectedReplyTurns({ events = [], nodes = [] } = {}) {
  const visible = new Set(nodes.map(Number))
  const bySeq = new Map(events.filter(event => Number.isSafeInteger(event?.seq)).map(event => [event.seq, event]))
  const turns = new Map()
  for (const event of events) {
    if (event?.type !== 'assistant/message' || event.surfaceOp?.op !== 'replace') continue
    if (visible.size && !visible.has(Number(event.seq))) continue
    const source = event.data?.message?.source
    // Repair rewrites a span of model context, not a regeneration projection. Its
    // range tail can belong to any round; recordNativeSurfaceRepair stores the real
    // edit turn instead, so this derived regeneration mapping must leave it alone.
    if (source?.provider === 'dsh-tavern' && source?.model === 'native-repair') continue
    const story = Number(source?.tavernStoryTurn)
    if (!Number.isSafeInteger(story) || story < 1) continue
    const range = surfaceReplacementRange(event.surfaceOp)
    const end = bySeq.get(range.end)
    const drawn = end?.type === 'assistant/message' && end.surfaceOp === 'append' ? Number(end.data?.turn) : NaN
    if (Number.isSafeInteger(drawn) && drawn > 0) { turns.set(story, drawn); continue }
    // Inside the range, the last assistant append with text is the row the
    // transcript drew for this round (the fold copy of a tool submission, or the
    // attempt's own reply). Its text is the previous body when applying a
    // replacement, so the row is located by shape, not by matching the new body.
    const copy = events.findLast(source => source?.type === 'assistant/message' &&
      source.surfaceOp === 'append' &&
      Number(source.seq) >= Number(range.start) && Number(source.seq) <= Number(range.end) &&
      contentText(source.data?.message) !== '' &&
      Number(source.data?.turn) > 0 && Number(source.data?.turn) !== story)
    turns.set(story, copy ? Number(copy.data.turn) : Number(event.data?.turn))
  }
  return turns
}

export function abortedRegenerationTurns(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const seqs = []
  for (const event of events) {
    const source = event && event.type === 'user/message' && event.data && event.data.source
    if (!isProducerSource(source, 'dsh-tavern-regeneration-abort')) continue
    if (Array.isArray(event.sourceEventSeqs)) seqs.push(...event.sourceEventSeqs)
  }
  return modelTurns(events, seqs)
}

// The native rollback may consume a failed-turn cleanup tombstone rather than
// its original streamed assistant node. Follow that provenance to hide the
// interrupted turn too; stopping alone must retain its visible error/partial reply.
export function rolledBackSurfaceTurns(events) {
  const restored = restoredSurfaceSeqs(events)
  const bySeq = new Map(events.filter(event => Number.isSafeInteger(event?.seq)).map(event => [event.seq, event]))
  const turns = new Set()
  const visited = new Set()
  function visit(seq) {
    if (visited.has(seq)) return
    visited.add(seq)
    const event = bySeq.get(seq)
    if (!event) return
    const turn = storyEventTurn(event)
    if (event.type === 'assistant/message' && modelSourceOf(event) !== null && Number.isSafeInteger(turn) && turn > 0) turns.add(turn)
    if (event.surfaceOp?.op === 'replace') for (const source of event.sourceEventSeqs || []) visit(source)
  }
  for (const event of events) {
    if (restored.has(event.seq) || !isRollbackAssistantTombstone(event, events)) continue
    for (const seq of event.sourceEventSeqs || []) visit(seq)
  }
  return [...turns].sort((left, right) => left - right)
}

// Finished turns that a regeneration input opened, read from the log. The save
// records the same turn by number, but a log the turn repair renumbered leaves
// that number pointing at the neighbouring turn; the input itself cannot drift.
export function regenerationInputTurns(events) {
  const turns = new Set()
  let open = null, opened = null
  for (const event of Array.isArray(events) ? events : []) {
    if (event?.type === 'turn/start') { open = Number(event.data?.turn); opened = false }
    else if (event?.type === 'turn/end') {
      if (opened && Number.isSafeInteger(open) && open > 0) turns.add(open)
      open = null
    } else if (open !== null && event?.type === 'user/message' && event.surfaceOp === 'append' &&
      isProducerSource(event.data?.source, 'dsh-tavern-regen')) opened = true
  }
  return [...turns].sort((left, right) => left - right)
}

// A round's player input can sit in a different native turn than its reply: a failed
// input is marked void, then a retry adopts its text and projects the body into another
// turn. Suppression would hide that whole turn, taking the player's own words with it.
// The input row of a drawn reply is the nearest human message before it, and the same
// holds for the attempt currently running. Keep that turn's input visible; its failed
// residue (error rows, trigger cards) is still hidden by the other lists.
export function keptPlayerInputTurns(input = {}) {
  const events = Array.isArray(input.events) ? input.events : []
  const replyTurns = new Set((Array.isArray(input.replyTurns) ? input.replyTurns : [])
    .map(Number).filter(turn => Number.isSafeInteger(turn) && turn > 0))
  const suppressed = new Set((Array.isArray(input.suppressed) ? input.suppressed : [])
    .map(Number).filter(turn => Number.isSafeInteger(turn) && turn > 0))
  if (replyTurns.size === 0 || suppressed.size === 0) return []
  const openTurn = Number(input.openTurn)
  const bodies = new Map()
  let turn = null
  let lastInput = null
  let queued = []
  for (const event of events) {
    if (!event) continue
    if (event.type === 'turn/start') {
      turn = Number(event.data?.turn)
      // A message queued before its turn starts (the inbox splices it in) opens it.
      for (const item of queued) item.turn = turn
      queued = []
      continue
    }
    if (event.type === 'turn/end') { turn = null; continue }
    if (event.type === 'user/message' && event.surfaceOp === 'append' && event.data?.source?.kind === 'user') {
      if (contentText(event.data) === '') continue
      const item = { seq: Number(event.seq), turn }
      // Deliveries before a turn starts still belong to the turn they wake.
      if (turn === null) queued.push(item)
      lastInput = item
      continue
    }
    if (event.type !== 'assistant/message' || event.surfaceOp !== 'append') continue
    if (contentText(event.data?.message) === '') continue
    const owner = Number(event.data?.turn)
    if (!Number.isSafeInteger(owner) || owner <= 0) continue
    bodies.set(owner, { seq: Number(event.seq), input: lastInput })
  }
  const kept = new Set()
  for (const reply of replyTurns) {
    const body = bodies.get(reply)
    const source = body ? body.input
      : Number.isSafeInteger(openTurn) && openTurn > 0 && reply === openTurn ? lastInput : null
    if (source && suppressed.has(Number(source.turn))) kept.add(Number(source.turn))
  }
  return [...kept].sort((left, right) => left - right)
}

export function foregroundSuppressedTurns(chat, events) {
  return Array.from(new Set((Array.isArray(chat?.suppressedDshTurns) ? chat.suppressedDshTurns : [])
    .concat(abortedRegenerationTurns({ events }), rolledBackSurfaceTurns(events))
    .map(Number).filter(turn => Number.isSafeInteger(turn) && turn > 0))).sort((left, right) => left - right)
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
    const body = bySeq.get(surfaceReplacementRange(op).end)
    const turn = storyEventTurn(body)
    const end = endings.get(turn)
    if (!body || body.type !== 'assistant/message' || modelSourceOf(body) === null || !syntheticTurns.has(turn) || turn === Number(event.data.turn)) continue
    if (!end || end.seq <= body.seq || end.seq >= event.seq || end.data.reason.kind !== 'completed') continue
    if (!Array.isArray(body.data.message.content) || !body.data.message.content.some(block => block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')) continue
    for (const failure of failures) {
      if (failure.seq >= surfaceReplacementRange(op).start && failure.seq <= surfaceReplacementRange(op).end) hidden.add(Number(failure.data.turn))
    }
  }
  return [...hidden].sort((a, b) => a - b)
}

export function locateRegenerationSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const messageId = typeof input?.messageId === 'string' ? input.messageId : ''
  if (messageId !== '') {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const event = eventAt(events, nodes[index])
      if (!event || event.type !== 'assistant/message' || event.data?.message?.id !== messageId) continue
      const source = modelSourceOf(event)
      if (source === null) continue
      return Object.freeze({ assistantSeq: Number(nodes[index]), turn: storyEventTurn(event), source })
    }
    return null
  }
  const turn = Number(input && input.turn)
  if (!Number.isSafeInteger(turn) || turn < 1) return null
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const event = eventAt(events, nodes[index])
    if (!event || event.type !== 'assistant/message' || storyEventTurn(event) !== turn) continue
    const source = modelSourceOf(event)
    if (source === null) continue
    // Current swipes leave a non-empty replacement; legacy swipes can be empty.
    // Plugin cleanup markers and messages from other turns are not the saved story body.
    return Object.freeze({ assistantSeq: Number(nodes[index]), turn, source })
  }
  const wanted = (Array.isArray(input && input.texts) ? input.texts : [])
    .filter(value => typeof value === 'string').map(value => value.trim()).filter(Boolean)
  if (wanted.length === 0) return null
  // Block joins and trailing whitespace differ between the save and the log.
  const compact = value => value.replace(/\s+/g, '')
  const matches = value => value !== '' && (wanted.includes(value) || wanted.some(text => compact(text) === compact(value)))
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const event = eventAt(events, nodes[index])
    if (!event || event.type !== 'assistant/message') continue
    const source = modelSourceOf(event)
    if (source === null) continue
    if (!matches(contentText(event.data && event.data.message))) continue
    return Object.freeze({ assistantSeq: Number(nodes[index]), turn, source })
  }
  return null
}

// Failed turns have already left the model surface, but remain visible until
// the user explicitly clears them. Never consume a committed story to do that.
export function pendingFailedSurfaceTurns({ events = [], nodes = [], suppressed = [] }) {
  const hidden = new Set(suppressed.map(Number))
  let ownership, failures
  const turns = new Set()
  for (let index = nodes.length - 1; index >= 0; index--) {
    const event = eventAt(events, nodes[index])
    // A later successful turn may already have been rolled back. Its empty
    // marker and legacy context snapshots do not end the pending failure tail.
    if (isRollbackAssistantTombstone(event, events) || isForegroundContext(event)) continue
    if (!isRollbackUserTombstone(event)) break
    if (sourceProducerName(event.data.source) !== 'dsh-tavern-failed-turn-cleanup') continue
    ownership ??= createSurfaceOwnership(events)
    failures ??= turnIntervals(events).filter(interval => interval.failed && !hidden.has(interval.turn))
    const sources = event.sourceEventSeqs || []
    const failed = new Set(modelTurns(events, sources))
    // A provider can fail before emitting any assistant message. Recover the
    // turn from the cleaned nodes' enclosing lifecycle, including old records.
    const origin = ownership.firstOrigin(event.seq)
    const interval = failures.find(item => origin > item.start && origin < item.end)
    if (interval && ownership.classify(candidate => candidate.seq > interval.start && candidate.seq < interval.end)(event.seq) === OWNED) {
      failed.add(interval.turn)
    }
    for (const turn of failed) {
      if (Number.isSafeInteger(turn) && turn > 0 && !hidden.has(turn)) turns.add(turn)
    }
  }
  return [...turns].sort((a, b) => a - b)
}

// A failed tail never reached the stored story, so recovering it is not a
// rollback: drop the interrupted native residue and hand its original input
// back to the player. The input survives in the append-only log even after the
// cleanup tombstone.
export function replayableFailedTurn(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  let lastEnd = null
  for (const event of events) {
    if (!event || event.type !== 'turn/end' || !Number.isSafeInteger(Number(event.seq))) continue
    const turn = storyEventTurn(event)
    if (!Number.isSafeInteger(turn) || turn < 1) continue
    if (lastEnd === null || Number(event.seq) > Number(lastEnd.seq)) lastEnd = event
  }
  if (lastEnd === null) return null
  const reason = lastEnd.data && lastEnd.data.reason ? lastEnd.data.reason.kind : ''
  if (!isFailedTurnEnd(reason)) return null
  const turn = Number(lastEnd.data.turn)
  const endSeq = Number(lastEnd.seq)
  // A turn that already started after this failure owns the tail now; replaying
  // would insert an older input behind newer story.
  for (const event of events) {
    if (!event || event.type !== 'turn/start' || !Number.isSafeInteger(Number(event.seq))) continue
    if (Number(event.seq) > endSeq) return null
  }
  let startSeq = -1
  for (const event of events) {
    if (!event || event.type !== 'turn/start' || storyEventTurn(event) !== turn) continue
    startSeq = Math.max(startSeq, Number(event.seq) || 0)
  }
  if (startSeq < 0) return null
  for (const event of events) {
    if (!event || event.type !== 'user/message') continue
    const seq = Number(event.seq)
    if (!Number.isSafeInteger(seq) || seq <= startSeq || seq >= endSeq) continue
    // A template edit of an earlier input can land inside this turn; it is not its input.
    if (!isReplayableInputSource(event.data && event.data.source) || !isNewTurnInput(event)) continue
    const userText = contentText(event.data)
    const attachments = inputAttachments(event.data?.content)
    if (userText === '' && !attachments.length) continue
    return Object.freeze({ turn, startSeq, endSeq, userText, ...(attachments.length ? { inputAttachments: attachments } : {}), source: replayInputSource(event.data && event.data.source) })
  }
  return null
}

// A native tail user with no assistant after it is an unfinished story input,
// regardless of whether the provider failure itself was persisted. Never fall
// through to an earlier assistant/user pair: that pair is already complete.
export function replayablePersistedTurn(chat) {
  if (!['story', 'script'].includes(chat?.mode || 'story')) return null
  const failure = object(chat?.foregroundError)
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  const message = object(messages[messages.length - 1])
  if (message?.role !== 'user' || message.native !== true || message.placeholder === true) return null
  const hasText = typeof message.sourceText === 'string' || typeof message.text === 'string'
  const userText = typeof message.sourceText === 'string' ? message.sourceText : (typeof message.text === 'string' ? message.text : '')
  const attachments = Array.isArray(message.inputAttachments) ? structuredClone(message.inputAttachments) : []
  // Session-state projections deliberately omit bodies; their target only drives
  // button visibility. The mutation reads the full row and still validates text.
  if (hasText && userText.trim() === '' && attachments.length === 0) return null
  const failedTurn = Number(failure?.turn)
  const source = replayInputSource(message.source)
  if (!source.rpcId) source.rpcId = randomUUID()
  return Object.freeze({
    persisted: true,
    messageIndex: messages.length - 1,
    turn: Number.isSafeInteger(failedTurn) && failedTurn > 0 ? failedTurn : 0,
    userText,
    ...(attachments.length ? { inputAttachments: attachments } : {}),
    source
  })
}

export function locateRollbackSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  let userIndex = -1
  // An anchored round says where its input is; no scan, no guess (round-anchor.js).
  const anchored = resolveRoundAnchor({ events, nodes }, input && input.anchor)
  const anchoredInput = anchored && anchored.input !== null ? eventAt(events, anchored.input) : null
  if (anchoredInput?.type === 'user/message' && isTurnInput(anchoredInput.data)) userIndex = nodes.indexOf(anchored.input)
  for (let index = nodes.length - 1; userIndex < 0 && index >= 0; index -= 1) {
    const event = eventAt(events, nodes[index])
    if (isCompactionCheckpoint(event)) return null
    // The round starts at its input: messages other plugins or card scripts add
    // around it belong to the round and go with it, never stand in for it.
    if (event && event.type === 'user/message' && (isTurnInput(event.data) || !isPluginSource(event.data?.source)) && !isRollbackUserTombstone(event)) {
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
    // A previous rollback leaves an empty, model-sourced replacement because
    // native DSH restore rejects plugin-owned assistant messages. It is a
    // projection tombstone, not the assistant reply paired with this user.
    if (candidateSource !== null && !isRollbackAssistantTombstone(event, events)) {
      assistantIndex = index
      assistantEvent = event
      source = candidateSource
      break
    }
  }
  if (assistantIndex < 0 || assistantEvent === null || source === null) return null

  const ownership = createSurfaceOwnership(events)
  const start = ownership.firstOrigin(nodes[userIndex])
  const belongs = ownership.classify(event => event.seq >= start)
  const turn = storyEventTurn(assistantEvent)
  const range = planSurfaceRange({ nodes, start: nodes[userIndex], end: nodes.at(-1),
    accepts: seq => {
      const event = ownership.eventAt(seq)
      if (isRollbackUserTombstone(event) || isRollbackAssistantTombstone(event, events)) return true
      if (belongs(seq) !== OWNED) return false
      if (event?.type === 'assistant/message' && storyEventTurn(event) !== turn) return false
      const frameTurn = Number(event?.data?.source?.trace?.turn)
      return !(frameTurn > 0) || frameTurn === turn
    }, message: '回退消息归属不一致，无法安全清理' })
  const shadowedSeqs = range.shadowedSeqs
  return Object.freeze({
    userSeq: Number(nodes[userIndex]),
    assistantSeq: Number(nodes[assistantIndex]),
    endSeq: Number(shadowedSeqs[shadowedSeqs.length - 1]),
    turn: Math.max(0, storyEventTurn(assistantEvent) || 0),
    step: Math.max(1, Number(assistantEvent.data && assistantEvent.data.step) || 1),
    source,
    shadowedSeqs: Object.freeze(shadowedSeqs.slice())
  })
}

/**
 * Rounds the save already rolled back but the model still sees (the native
 * shadow was lost before it was saved): shadow them again, newest first, the
 * same way a rollback does. Stops at the first round that is not one of them.
 */
export function reshadowRolledBackRounds(session, turns) {
  const done = []
  for (;;) {
    let target
    try { target = locateRollbackSurface({ events: sessionEvents(session), nodes: session.surface?.nodes || [] }) }
    catch (error) { if (error instanceof SurfaceRecoveryError) break; throw error }
    if (!target || !turns.has(target.turn) || done.includes(target.turn)) break
    replaceSessionSurface(session, 'assistant/message', {
      turn: target.turn, step: target.step,
      message: { id: 'tavern-rollback-repair:' + target.turn + ':' + target.assistantSeq, role: 'assistant', content: [], source: target.source }
    }, { start: target.userSeq, end: target.endSeq, sourceEventSeqs: [...target.shadowedSeqs] })
    done.push(target.turn)
  }
  return done
}

export function planRegenerationSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const oldAssistantSeq = Number(input && input.oldAssistantSeq)
  const eventStart = Math.max(0, Number(input && input.eventStart) || 0)
  const oldAssistantIndex = nodes.indexOf(oldAssistantSeq)
  if (oldAssistantIndex < 0) throw new Error('旧正文已经不在当前模型消息面中')

  const ownership = createSurfaceOwnership(events)
  const end = regenerationAttemptEnd(events, eventStart)
  const attempt = ownership.classify(event => event.seq >= eventStart && event.seq < end)
  let finalAssistantSeq = null
  for (let index = nodes.length - 1; index > oldAssistantIndex; index--) {
    const seq = Number(nodes[index])
    const event = ownership.eventAt(seq)
    if (attempt(seq) === OWNED && event?.type === 'assistant/message' && modelSourceOf(event) !== null) {
      finalAssistantSeq = seq
      break
    }
  }
  if (finalAssistantSeq === null) throw new SurfaceRecoveryError('重新生成流程未在当前模型消息面中产生正文')

  const failed = turnIntervals(events).filter(interval => interval.failed && interval.end < eventStart)
  const residue = ownership.classify(event => failed.some(interval => event.seq > interval.start && event.seq < interval.end))
  const accepts = seq => seq === oldAssistantSeq || attempt(seq) === OWNED || residue(seq) === OWNED ||
    isRollbackUserTombstone(ownership.eventAt(seq)) || isRollbackAssistantTombstone(ownership.eventAt(seq), events)
  const between = nodes.slice(oldAssistantIndex, nodes.indexOf(finalAssistantSeq) + 1).map(Number)
  // Messages written between the old reply and this attempt by something else
  // (a card script's chat message, a context refresh) are not ours to remove.
  // Leave them where they are and replace our own runs around them; refusing
  // would make this round impossible to regenerate for good. Story replies of
  // another round are never stepped over.
  const foreign = between.filter(seq => !accepts(seq))
  const story = foreign.find(seq => ownership.eventAt(seq)?.type === 'assistant/message' && modelSourceOf(ownership.eventAt(seq)) !== null)
  if (story !== undefined) throw new SurfaceRecoveryError('重新生成消息归属不一致，无法安全清理', story)
  const runs = []
  for (const seq of between) {
    if (foreign.includes(seq)) { if (runs.at(-1)?.length) runs.push([]); continue }
    if (!runs.length) runs.push([])
    runs.at(-1).push(seq)
  }
  const [main, ...rest] = runs.filter(run => run.length).map(run => planSurfaceRange({ nodes, start: run[0], end: run.at(-1), accepts, message: '重新生成消息归属不一致，无法安全清理' }))
  // Replacing a saved round is never allowed to consume or precede newer story.
  if (nodes.slice(nodes.indexOf(finalAssistantSeq) + 1).some(seq =>
    !isRollbackUserTombstone(ownership.eventAt(seq)) && !isRollbackAssistantTombstone(ownership.eventAt(seq), events))) {
    throw new SurfaceRecoveryError('重新生成后已有新的消息，无法安全清理')
  }
  return Object.freeze({ ...main, finalAssistantSeq, cleanups: Object.freeze(rest) })
}

/** The committed body replaces the old reply; later runs of the attempt become empty markers. */
export function regenerationProjection(replacement, data, operationId) {
  return {
    data,
    range: { start: replacement.start, end: replacement.end, sourceEventSeqs: [...replacement.shadowedSeqs] },
    cleanups: (replacement.cleanups || []).map((run, index) => ({
      data: { id: 'tavern-regen-cleanup:' + operationId + ':' + index, role: 'user', content: [], source: { kind: 'plugin:dsh-tavern-regeneration-abort' } },
      range: { start: run.start, end: run.end, sourceEventSeqs: [...run.shadowedSeqs] }
    }))
  }
}

/**
 * Idempotent: each replacement reuses its id and sources, so a retry after a crash writes nothing twice.
 *
 * The transcript draws append-origin events only; a replacement stays model-only.
 * A round whose body exists only as a replacement (it was submitted through a tool
 * call, so it never streamed an answer of its own) therefore renders as nothing
 * after regenerating. Give it a transcript copy, then shadow the range including
 * that copy — the same shape the fold writes for a live submission.
 */
export function applyRegenerationProjection(session, projection) {
  if (projection.kind === 'append-round') return applyIndependentRoundProjection(session, projection)
  const events = sessionEvents(session)
  const blocks = Array.isArray(projection.data?.message?.content) ? projection.data.message.content : []
  const body = blocks.filter(block => block?.type === 'text').map(block => block.text).join('')
  // Judge by the shape the range ends on, never by the message source: a
  // projection inherits the source of the reply it replaces, so a source check
  // silently skips the copy for every ordinary round.
  const endEvent = events.find(event => Number(event?.seq) === Number(projection.range?.end))
  const needsTranscriptCopy = body !== '' && endEvent?.type === 'assistant/message' && endEvent.surfaceOp !== 'append'
  // Only a copy written AFTER the range may be reused. A fold copy inside the
  // range is the old turn's row: it stays model-only once that turn is hidden as
  // superseded, so reusing it leaves the round blank. Rewriting it as the
  // replacement's tail keeps the retry idempotent without that trap.
  const shown = needsTranscriptCopy
    ? events.find(event => event?.type === 'assistant/message' && event.surfaceOp === 'append' &&
        Number(event.seq) > Number(projection.range?.end) &&
        (event.data?.message?.content || []).some(block => block?.type === 'text' && block.text === body))
    : undefined
  const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes.map(Number) : []
  const replaceCleanups = () => {
    for (const cleanup of projection.cleanups || []) replaceSessionSurface(session, 'user/message', cleanup.data, cleanup.range)
  }
  if (!needsTranscriptCopy) {
    replaceSessionSurface(session, 'assistant/message', projection.data, projection.range)
    replaceCleanups()
    return
  }
  // Retry after a crash: the copy is on the surface already, and the old range
  // may already be shadowed. Nothing left to write then.
  const copySeq = shown ? Number(shown.seq) : -1
  const from = nodes.indexOf(Number(projection.range?.start))
  if (from < 0) {
    if (copySeq < 0) replaceSessionSurface(session, 'assistant/message', projection.data, projection.range)
    replaceCleanups()
    return
  }
  const surface = createSessionSurfaceMutator(session)
  surface.editStep(() => {
    const shownSeq = copySeq >= 0
      ? copySeq
      : Number((entry => (typeof entry === 'number' ? entry : entry.seq))(surface.append('assistant/message', projection.data, { surfaceOp: 'append' })))
    const to = session.surface.nodes.map(Number).indexOf(shownSeq)
    if (to < from) return
    surface.replace('assistant/message', projection.data, {
      start: projection.range.start,
      end: shownSeq,
      sourceEventSeqs: session.surface.nodes.slice(from, to + 1).map(Number),
    })
  })
  replaceCleanups()
}

/** A failed input has no body to replace. Replay its visible pair once after commit. */
function applyIndependentRoundProjection(session, projection) {
  const locate = () => {
    const events = sessionEvents(session)
    return {
      input: events.find(event => event.type === 'user/message' && event.data?.id === projection.input?.id),
      reply: events.find(event => event.type === 'assistant/message' && event.data?.message?.id === projection.data?.message?.id)
    }
  }
  let found = locate()
  if (!found.reply) {
    const surface = createSessionSurfaceMutator(session)
    surface.editStep((turn, step) => {
      // Opening the new edit turn first keeps cleanup and both appends in one
      // native turn. A crash can safely retry each append by its stable id.
      clearFailedTurnSurface({ session, turn: projection.failedTurn, id: () => projection.input.id + ':cleanup' })
      if (!found.input) surface.append('user/message', { ...projection.input, turn }, { surfaceOp: 'append' })
      surface.append('assistant/message', { ...projection.data, turn, step }, { surfaceOp: 'append', sourceEventSeqs: [] })
    })
    found = locate()
  }
  if (!found.input || !found.reply) throw new Error('失败输入重生成缺少已提交的原生消息')
  return { nativeAnchor: { formatVersion: 4, turn: Number(found.reply.data.turn), input: Number(found.input.seq), reply: Number(found.reply.seq) } }
}

/** Turns cut off without ending (the server stopped mid-reply) whose nodes the model still sees. */
export function interruptedSurfaceTurns({ events = [], nodes = [] }) {
  const visible = nodes.map(Number)
  return turnIntervals(events).filter(interval => interval.interrupted && visible.some(seq => seq > interval.start && seq < interval.end)).map(interval => interval.turn)
}

function turnIntervals(events) {
  const starts = new Map(), intervals = []
  for (const event of events) {
    if (!event) continue
    const turn = storyEventTurn(event)
    if (event.type === 'turn/start') {
      // A turn that never ended before the next one began was cut off (the
      // server stopped mid-reply): it failed, and its input must not ride along.
      for (const [open, start] of starts) {
        if (open !== turn) intervals.push({ turn: open, start, end: event.seq, failed: true, interrupted: true })
      }
      for (const open of [...starts.keys()]) if (open !== turn) starts.delete(open)
      starts.set(turn, event.seq)
    }
    if (event.type === 'turn/end' && starts.has(turn)) {
      intervals.push({ turn, start: starts.get(turn), end: event.seq, failed: isFailedTurnEnd(event.data?.reason?.kind) })
      starts.delete(turn)
    }
  }
  return intervals
}

function regenerationAttemptEnd(events, eventStart) {
  let started = false
  for (const event of events) {
    if (!event || event.seq < eventStart) continue
    if (event.type === 'turn/end' || isNewPlayerInput(event)) return event.seq
    if (event.type === 'turn/start') {
      if (started) return event.seq
      started = true
    } else if (event.surfaceOp === 'append' && ['user/message', 'assistant/message', 'tool/result'].includes(event.type)) {
      // Legacy recovery can start at the injected input, after turn/start.
      // A later turn/start is still a boundary if turn/end was never written.
      started = true
    }
  }
  return Infinity
}

export function planFailedTurnSurface(input) {
  const events = Array.isArray(input && input.events) ? input.events : []
  const nodes = Array.isArray(input && input.nodes) ? input.nodes : []
  const turn = Math.max(0, Number(input && input.turn) || 0)
  const interval = turnIntervals(events).findLast(interval => interval.turn === turn)
  if (!interval) return null
  const { start: startSeq, end: endSeq } = interval

  return planSurfaceRecovery({
    nodes,
    ownership: input.ownership || createSurfaceOwnership(events),
    selectOrigin: event => event.seq > startSeq && event.seq < endSeq,
    inScope: event => event.seq > startSeq,
    ignore: isRollbackUserTombstone,
    message: '失败回合的模型消息面不是连续区间，无法安全清理'
  })
}

export function clearFailedTurnSurface(input) {
  const session = input && input.session
  if (!session || typeof session.append !== 'function') return 0
  const cleanup = planFailedTurnSurface({
    events: sessionEvents(session),
    nodes: session.surface && session.surface.nodes,
    turn: input.turn
  })
  if (cleanup === null) return 0
  const makeId = typeof input.id === 'function' ? input.id : function () { return randomUUID() }
  // DSH permits plugin-injected user messages, but assistant messages must be
  // model-sourced on restore. Keep this empty tombstone explicitly plugin-owned.
  replaceSessionSurface(session, 'user/message', {
    id: makeId(),
    role: 'user',
    content: [],
    source: { kind: 'plugin:dsh-tavern-failed-turn-cleanup' }
  }, { start: cleanup.start, end: cleanup.end, sourceEventSeqs: cleanup.shadowedSeqs })
  return cleanup.shadowedSeqs.length
}

/** Remove only the temporary DSH surface nodes appended by a regeneration attempt. */
export function clearRegenerationAttemptSurface(input) {
  const session = input && input.session
  if (!session || typeof session.append !== 'function') return 0
  const nodes = session.surface && Array.isArray(session.surface.nodes) ? session.surface.nodes : []
  const eventStart = Math.max(0, Number(input && input.eventStart) || 0)
  const events = sessionEvents(session)
  const end = regenerationAttemptEnd(events, eventStart)
  const cleanup = planSurfaceRecovery({
    nodes, ownership: createSurfaceOwnership(events),
    selectOrigin: event => event.seq >= eventStart && event.seq < end,
    inScope: event => event.seq >= eventStart,
    // Failed cleanup may precede regeneration abort; convert it once to the
    // abort marker, then retries are true no-ops (including after a flush error).
    ignore: event => sourceProducerName(event?.data?.source) === 'dsh-tavern-regeneration-abort',
    message: '重新生成临时消息不是连续区间，无法安全清理'
  })
  if (!cleanup) return 0
  const makeId = typeof input.id === 'function' ? input.id : function () { return randomUUID() }
  replaceSessionSurface(session, 'user/message', {
    id: makeId(),
    role: 'user',
    content: [],
    source: { kind: 'plugin:dsh-tavern-regeneration-abort' }
  }, { start: cleanup.start, end: cleanup.end, sourceEventSeqs: cleanup.shadowedSeqs })
  return cleanup.shadowedSeqs.length
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

// Recover only ended, uncommitted failures still present at the surface tail.
// A missing cleanup hook must not turn an interrupted input into a dead end.
function unclearedFailedTail(chat, events, nodes) {
  const tail = nodes.findLast(seq => {
    const event = eventAt(events, seq)
    return !isRollbackAssistantTombstone(event, events) && !isRollbackUserTombstone(event) && !isForegroundContext(event)
  })
  if (tail === undefined) return []
  const latest = (chat.messages || []).findLast(message => message?.role === 'assistant')
  const lastEvent = eventAt(events, tail)
  if (lastEvent?.type === 'assistant/message' && (storyEventTurn(lastEvent) === Number(latest?.turn) || storyEventTurn(lastEvent) === Number(chat.regeneratedDshTurns?.[String(latest?.turn)]))) return []
  const committed = new Set((chat.messages || []).filter(message => message?.role === 'assistant').map(message => Number(message.turn)))
  for (const turn of Object.values(chat.regeneratedDshTurns || {})) committed.add(Number(turn))
  const intervals = turnIntervals(events)
  const ownership = createSurfaceOwnership(events)
  let remaining = [...nodes]
  const result = []
  while (remaining.length) {
    const event = eventAt(events, remaining.at(-1))
    if (isRollbackAssistantTombstone(event, events) || isRollbackUserTombstone(event) || isForegroundContext(event)) { remaining.pop(); continue }
    const origin = ownership.firstOrigin(event?.seq)
    const interval = intervals.findLast(item =>
      (event?.type === 'assistant/message' && storyEventTurn(event) === item.turn) ||
      (origin > item.start && origin < item.end))
    if (!interval?.failed || committed.has(interval.turn)) break
    const plan = planFailedTurnSurface({ events, nodes, turn: interval.turn, ownership })
    if (!plan) break
    result.push(interval.turn)
    const removed = new Set(plan.shadowedSeqs)
    remaining = remaining.filter(seq => !removed.has(seq))
  }
  return result
}

// UI and mutation share the same native target and failed-tail precedence.
function planRollbackAvailability(chat, { events = [], nodes = [] } = {}) {
  const unclearedTurns = unclearedFailedTail(chat, events, nodes)
  const failedTurns = [...new Set([...pendingFailedSurfaceTurns({ events, nodes, suppressed: chat.suppressedDshTurns || [] }), ...unclearedTurns])].sort((a, b) => a - b)
  if (failedTurns.length) return { canRollback: true, canClearIncompleteReply: true, failedTurns, unclearedTurns, target: null, reason: '' }
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  const latest = messages.findLast(message => message?.role === 'assistant' && message.greeting !== true)
  const target = locateRollbackSurface({ events, nodes, anchor: latest?.nativeAnchor })
  if (isRescuedHistoryMessage(chat, latest)) return { canRollback: false, canClearIncompleteReply: false, failedTurns, target: null, reason: '存档救援导入的历史不可回退，请发送新消息继续' }
  const turn = Number(latest?.turn)
  const matches = target && (!(turn > 0) || target.turn === turn || target.turn === Number(chat.regeneratedDshTurns?.[String(turn)]))
  const hasMessages = hasRollbackMessages(messages)
  const canRollback = hasMessages && Boolean(matches)
  return { canRollback, canClearIncompleteReply: false, failedTurns, target: canRollback ? target : null,
    reason: canRollback ? '' : hasMessages ? '当前轮次已不在可回退的消息流中，请继续发送新消息；历史正文仍保留。' : '当前没有可回退的已提交轮次' }
}

// Unsafe recovery is a domain result in views, and the mutation consumes that
// same result. Never let a corrupt range take down the entire status query.
export function rollbackAvailability(chat, input = {}) {
  try {
    return planRollbackAvailability(chat, input)
  } catch (error) {
    if (!(error instanceof SurfaceRecoveryError)) throw error
    return { canRollback: false, canClearIncompleteReply: false, failedTurns: [], unclearedTurns: [], target: null, reason: error.message }
  }
}

export function failedTurnReplayAvailability({ chat = null, events = [], nodes = [], cleared = [] } = {}) {
  const target = replayablePersistedTurn(chat) || replayableFailedTurn({ events })
  if (!target) return { target: null, reason: '当前没有待处理的失败回合' }
  // A persisted row disappears when the player withdraws it. The clearing marker
  // left behind must not hide a row that is still waiting for its first reply.
  if (!target.persisted && cleared.map(Number).includes(target.turn)) return { target: null, reason: '这次失败已清除，请重新发送' }
  try {
    planFailedTurnSurface({ events, nodes, turn: target.turn })
    return { target, reason: '' }
  } catch (error) {
    if (!(error instanceof SurfaceRecoveryError)) throw error
    return { target: null, reason: error.message }
  }
}
