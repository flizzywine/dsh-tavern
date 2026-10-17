import { sessionEvents } from './session-events.js'
import { createSessionSurfaceMutator } from './session-surface-mutations.js'
import { createRoundAnchorResolver, roundAnchor, validAnchor } from './round-anchor.js'
import { isCompactionCheckpoint } from './compaction-checkpoint.js'
import { isTurnInput } from './session-turn-input.js'
import { nativeOpeningMessageId } from './native-opening.js'
import { RETAINED_STORY_ROUNDS } from './story-compaction.js'

// The Chat is the save; the native surface is its projection (docs/design/native-session-repair.md).
// Repair keeps the longest surface prefix that still agrees with the Chat and rewrites
// only the rounds after it, so the prompt-cache prefix and any compaction survive.
// The walk starts at the last round and stops at the first intact one: its cost
// follows how many rounds broke, not how long the game is.

function textOf(content) {
  return (Array.isArray(content) ? content : []).filter(block => block?.type === 'text').map(block => block.text).join('')
}

function chatRounds(chat) {
  const rounds = []
  let users = []
  for (const [index, message] of (chat.messages || []).entries()) {
    if (message?.role === 'user') { users.push(String(message.text ?? '')); continue }
    if (message?.role !== 'assistant') continue
    // The native reply holds the raw model output (sourceText) unless an edit wrote the
    // projected text; both are this round. Saved texts are trimmed, native ones may not be.
    const texts = new Set([message.text, message.sourceText, message.projectionText].filter(value => typeof value === 'string').map(value => value.trim()))
    rounds.push({ messageIndex: index, turn: Number(message.turn) || 0, greeting: message.greeting === true,
      userText: users.length ? users.join('\n\n') : null, replyText: String(message.text ?? ''), texts, anchor: message.nativeAnchor })
    users = []
  }
  return rounds
}

// What a model would read as story after the last reply: a pending input, more
// prose, or tool traffic. Injected context and empty tombstones are harmless.
function isStoryResidue(event) {
  if (event?.type === 'tool/result') return true
  if (event?.type === 'user/message') return isTurnInput(event.data) && textOf(event.data.content) !== ''
  if (event?.type === 'assistant/message') return textOf(event.data?.message?.content) !== ''
  return false
}

function isPrefixNode(event, openingId) {
  if (!event) return true
  if (event.type === 'system/message') return true
  if (event.type === 'user/message') return !isTurnInput(event.data) && !isCompactionCheckpoint(event)
  if (event.type === 'assistant/message') {
    const message = event.data?.message
    return message?.id !== openingId && message?.source?.model === 'synthetic-trajectory'
  }
  return false
}

/** Decide what to keep and which Chat rounds to write after it. Pure. */
export function planNativeSurfaceRepair({ chat, events = [], nodes = [] }) {
  const bySeq = new Map(events.map(event => [event.seq, event]))
  const at = index => bySeq.get(nodes[index])
  const openingId = nativeOpeningMessageId(chat.id)
  const rounds = chatRounds(chat)
  const checkpoint = nodes.findLastIndex(seq => isCompactionCheckpoint(bySeq.get(seq)))
  const resolve = createRoundAnchorResolver({ events, nodes })
  const turnOfSeq = new Map(), ended = new Map()
  let started = 0
  for (const event of events) {
    if (event?.type === 'turn/start') started = Number(event.data?.turn) || started
    if (event?.type === 'turn/end') ended.set(Number(event.data?.turn), event.data?.reason?.kind || '')
    turnOfSeq.set(event?.seq, started)
  }
  // The last native turn the compaction summary stands for: those rounds live only in the
  // summary, so a repair must never write them back (an old save whose anchors no longer
  // resolve would otherwise bring the summarized story back after the summary).
  const covered = checkpoint < 0 ? 0 : Math.max(0, ...(at(checkpoint)?.sourceEventSeqs || []).map(seq => turnOfSeq.get(seq) || 0))
  const nativeTurn = round => validAnchor(round.anchor) ? Number(round.anchor.turn) : round.turn
  const summarizedRound = round => covered > 0 && !round.greeting && nativeTurn(round) <= covered
  let replies = null
  function replyByText(texts) {
    if (replies === null) {
      replies = new Map()
      for (let index = checkpoint + 1; index < nodes.length; index++) {
        const event = at(index)
        if (event?.type !== 'assistant/message' || event.data?.message?.source?.kind !== 'model') continue
        replies.set(textOf(event.data.message.content).trim(), index)
      }
    }
    return Math.max(-1, ...[...texts].map(text => replies.get(text) ?? -1))
  }
  // Where this round's reply stands, if the surface still says what the Chat says.
  function locate(round) {
    if (round.greeting) {
      const index = nodes.findIndex(seq => bySeq.get(seq)?.data?.message?.id === openingId)
      return index > checkpoint ? index : -1
    }
    if (validAnchor(round.anchor)) {
      const found = resolve(round.anchor)
      if (found?.reply != null) {
        const index = nodes.indexOf(found.reply)
        const event = at(index)
        const intact = index > checkpoint && event?.type === 'assistant/message' && round.texts.has(textOf(event.data?.message?.content).trim())
        return { index: intact ? index : -1, summarized: checkpoint >= 0 && (found.reply === nodes[checkpoint] || found.input === nodes[checkpoint]) }
      }
    }
    return { index: replyByText(round.texts), summarized: false }
  }
  // A failed, stopped or still running turn left on the surface is the failed-turn
  // replay's to clear or resend (CONTEXT.md, Failed Turn Replay); only a completed
  // turn the save does not have is residue.
  const residue = seq => isStoryResidue(bySeq.get(seq)) && ended.get(turnOfSeq.get(seq)) === 'completed'
  // Keeping every node and writing nothing is no repair at all.
  const plan = (status, keep, rewrite) => ({ status: !rewrite.length && keep >= nodes.length ? 'intact' : status, keep, rounds: rewrite, checkpoint })
  for (let position = rounds.length - 1; position >= 0; position--) {
    const round = rounds[position]
    const found = locate(round)
    const index = typeof found === 'number' ? found : found.index
    if (index >= 0) {
      const rewrite = rounds.slice(position + 1)
      // Only residue after an intact last round: shadow it, keep that round.
      if (!rewrite.length && !nodes.slice(index + 1).some(residue)) return plan('intact', nodes.length, [])
      return plan('tail', index + 1, rewrite)
    }
    if (found.summarized || summarizedRound(round)) return plan('tail', checkpoint + 1, rounds.slice(position + 1))
  }
  // Nothing after the last compaction matches: it kept the latest rounds verbatim.
  if (checkpoint >= 0) return plan('tail', checkpoint + 1, rounds.filter(round => !round.greeting && !summarizedRound(round)).slice(-RETAINED_STORY_ROUNDS))
  let keep = 0
  while (keep < nodes.length && isPrefixNode(at(keep), openingId)) keep++
  return plan('full', keep, rounds)
}

/** Write a plan onto the surface: one replacement over the stale tail, then appends. */
export function applyNativeSurfaceRepair(session, chat, plan, { repairId }) {
  if (plan.status === 'intact') return { applied: false, anchors: [] }
  if (!/^[\w-]{1,100}$/.test(String(repairId || ''))) throw new Error('修复标识无效')
  const mutator = createSessionSurfaceMutator(session, sessionEvents(session))
  const targets = (session.surface?.nodes || []).slice(plan.keep)
  let pending = targets.length > 0
  function write(type, data) {
    if (pending) {
      pending = false
      return mutator.replace(type, data, { start: targets[0], end: targets.at(-1), sourceEventSeqs: targets })
    }
    return mutator.append(type, data, type === 'assistant/message' ? { surfaceOp: 'append', sourceEventSeqs: [] } : { surfaceOp: 'append' })
  }
  const source = { kind: 'model', provider: 'dsh-tavern', model: 'native-repair' }
  const anchors = []
  for (const [index, round] of plan.rounds.entries()) {
    const id = `tavern-native-repair:${repairId}:${index}`
    // Story turn, as a regenerate's projection writes it (story alignment reads it).
    const turn = round.turn
    const input = round.userText === null ? null : write('user/message', { id: id + ':input', role: 'user',
      content: [{ type: 'text', text: round.userText }], source: { kind: 'user', repair: { id: repairId } } })
    const reply = write('assistant/message', { turn, step: 1, message: { id: round.greeting ? nativeOpeningMessageId(chat.id) : id + ':reply',
      role: 'assistant', content: [{ type: 'text', text: round.replyText }], source } })
    anchors.push({ messageIndex: round.messageIndex, anchor: input ? roundAnchor(turn, input, reply) : null })
  }
  // A stale tail with nothing to write in its place: shadow it with an empty node.
  if (pending) write('assistant/message', { turn: 0, step: 1, message: { id: `tavern-native-repair:${repairId}:empty`, role: 'assistant', content: [], source } })
  return { applied: true, anchors }
}

/** Plan and apply against the session as it is now. Callers persist anchors and flush. */
export function repairNativeSurface(session, chat, options) {
  const plan = planNativeSurfaceRepair({ chat, events: sessionEvents(session), nodes: session.surface?.nodes || [] })
  return { plan, ...applyNativeSurfaceRepair(session, chat, plan, options) }
}

/** Record a repair in the save: new anchors for rewritten rounds, marker cleared.
 * A row that changed since the repair read it keeps its old anchor; the next
 * reconcile repairs again. Returns false when there is nothing to write. */
export function recordNativeSurfaceRepair(current, repaired, anchors) {
  let changed = false
  if (current.nativeSync) { delete current.nativeSync; changed = true }
  for (const { messageIndex, anchor } of anchors) {
    const row = current.messages?.[messageIndex], read = repaired.messages?.[messageIndex]
    if (!anchor || row?.role !== 'assistant' || row.text !== read?.text || Number(row.turn) !== Number(read?.turn)) continue
    row.nativeAnchor = anchor
    // The rewritten reply already carries the edit; replaying the marker would target a shadowed node.
    delete row.bodyEdit
    changed = true
  }
  return changed
}
