import { sessionEvents } from './session-events.js'
import { createSessionSurfaceMutator } from './session-surface-mutations.js'
import { createRoundAnchorResolver, roundAnchor, validAnchor } from './round-anchor.js'
import { isCompactionCheckpoint } from './compaction-checkpoint.js'
import { isTurnInput } from './session-turn-input.js'
import { nativeOpeningMessageId } from './native-opening.js'
import { RETAINED_STORY_ROUNDS } from './story-compaction.js'

// The Chat is the save; the native surface is its projection (Wiki「设计：native-session-repair」).
// Repair keeps the longest surface prefix that still agrees with the Chat and rewrites
// only the rounds after it, so the prompt-cache prefix and any compaction survive.
// The walk starts at the last round and stops at the first intact one: its cost
// follows how many rounds broke, not how long the game is.

function textOf(content) {
  return (Array.isArray(content) ? content : []).filter(block => block?.type === 'text').map(block => block.text).join('')
}

function chatRounds(chat) {
  const rounds = []
  let pending = null
  for (const [index, message] of (chat.messages || []).entries()) {
    if (message?.role === 'user') {
      // Only the last adjacent user can pair with the next reply. Earlier users are
      // story messages in their own right, not lines to merge into that reply's input.
      if (pending) rounds.push({ ...pending, standalone: true })
      pending = { messageIndex: index, userText: String(message.text ?? '') }
      continue
    }
    if (message?.role !== 'assistant') continue
    // The native reply holds the raw model output (sourceText) unless an edit wrote the
    // projected text; both are this round. Saved texts are trimmed, native ones may not be.
    const texts = new Set([message.text, message.sourceText, message.projectionText].filter(value => typeof value === 'string').map(value => value.trim()))
    rounds.push({ messageIndex: index, turn: Number(message.turn) || 0, greeting: message.greeting === true,
      userText: pending?.userText ?? null, replyText: String(message.text ?? ''), texts, anchor: message.nativeAnchor })
    pending = null
  }
  if (pending) rounds.push({ ...pending, standalone: true })
  return rounds
}

// What a model would read as story after the last reply: a pending input, more
// prose, or tool traffic. Injected context and empty tombstones are harmless.
function isStoryResidue(event) {
  if (event?.type === 'assistant/message' && String(event.data?.message?.id || '').startsWith('tavern-game-mode:')) return false
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
  let replies = null, inputs = null
  function replyByText(texts, before = nodes.length) {
    if (replies === null) {
      replies = new Map()
      for (let index = checkpoint + 1; index < nodes.length; index++) {
        const event = at(index)
        if (event?.type !== 'assistant/message' || event.data?.message?.source?.kind !== 'model') continue
        const text = textOf(event.data.message.content).trim()
        if (!replies.has(text)) replies.set(text, [])
        replies.get(text).push(index)
      }
    }
    return Math.max(-1, ...[...texts].map(text => replies.get(text)?.findLast(index => index < before) ?? -1))
  }
  function inputByText(text, before = nodes.length) {
    if (inputs === null) {
      inputs = new Map()
      for (let index = checkpoint + 1; index < nodes.length; index++) {
        const event = at(index)
        if (event?.type !== 'user/message' || !isTurnInput(event.data)) continue
        const value = textOf(event.data.content)
        if (!inputs.has(value)) inputs.set(value, [])
        inputs.get(value).push(index)
      }
    }
    return inputs.get(text)?.findLast(index => index < before) ?? -1
  }
  // Where this round's reply stands, if the surface still says what the Chat says.
  function locate(round, before = nodes.length) {
    if (round.standalone) {
      const index = inputByText(round.userText, before)
      return { index, start: index, summarized: false }
    }
    if (round.greeting) {
      const index = nodes.findIndex(seq => bySeq.get(seq)?.data?.message?.id === openingId)
      return { index: index > checkpoint && index < before ? index : -1, start: index, summarized: false }
    }
    if (validAnchor(round.anchor)) {
      const found = resolve(round.anchor)
      if (found?.reply != null) {
        const index = nodes.indexOf(found.reply)
        const event = at(index)
        const intact = index > checkpoint && index < before && event?.type === 'assistant/message' && round.texts.has(textOf(event.data?.message?.content).trim())
        const input = round.userText === null || found.input === null ? -1 : nodes.indexOf(found.input)
        return { index: intact ? index : -1, start: input >= 0 && input < index ? input : index,
          summarized: checkpoint >= 0 && (found.reply === nodes[checkpoint] || found.input === nodes[checkpoint]) }
      }
    }
    const index = replyByText(round.texts, before)
    const input = round.userText === null ? -1 : inputByText(round.userText, index)
    return { index, start: input >= 0 ? input : index, summarized: false }
  }
  // A failed, stopped or still running turn left on the surface is the failed-turn
  // replay's to clear or resend (CONTEXT.md, Failed Turn Replay); only a completed
  // turn the save does not have is residue.
  const residue = seq => isStoryResidue(bySeq.get(seq)) && ended.get(turnOfSeq.get(seq)) === 'completed'
  // Keeping every node and writing nothing is no repair at all.
  const plan = (status, keep, rewrite) => ({ status: !rewrite.length && keep >= nodes.length ? 'intact' : status, keep, rounds: rewrite, checkpoint })
  // A deleted middle row can leave the last reply intact, so the ordinary last-intact
  // shortcut is insufficient for an unpaired history. Walk every such unit and treat
  // completed story between two matched units as the deleted rows' stale projection.
  if (rounds.some(round => round.standalone || (!round.greeting && round.userText === null))) {
    let nextStart = nodes.length, dirty = false
    for (let position = rounds.length - 1; position >= 0; position--) {
      const round = rounds[position], found = locate(round, nextStart)
      if (found.index >= 0) {
        if (dirty || nodes.slice(found.index + 1, nextStart).some(residue)) return plan('tail', found.index + 1, rounds.slice(position + 1))
        nextStart = found.start
        continue
      }
      if (found.summarized || summarizedRound(round)) {
        if (!dirty && !nodes.slice(checkpoint + 1, nextStart).some(residue)) return plan('intact', nodes.length, [])
        return plan('tail', checkpoint + 1, rounds.slice(position + 1))
      }
      dirty = true
    }
    if (!dirty) {
      let prefix = checkpoint + 1
      if (checkpoint < 0) { prefix = 0; while (prefix < nodes.length && isPrefixNode(at(prefix), openingId)) prefix++ }
      if (!nodes.slice(prefix, nextStart).some(residue)) return plan('intact', nodes.length, [])
    }
    if (checkpoint >= 0) return plan('tail', checkpoint + 1, rounds.filter(round => !round.greeting && !summarizedRound(round)).slice(-RETAINED_STORY_ROUNDS))
    let keep = 0
    while (keep < nodes.length && isPrefixNode(at(keep), openingId)) keep++
    return plan('full', keep, rounds)
  }
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
  const storySource = turn => Number.isSafeInteger(Number(turn)) && Number(turn) > 0 ? { ...source, tavernStoryTurn: Number(turn) } : source
  const anchors = []
  // The repair runs between rounds, where no step is open: all its writes share one
  // edit step. Each reply keeps its story turn in tavernStoryTurn (story alignment
  // reads it), since its event carries the edit step's numbers.
  mutator.editStep(() => {
    for (const [index, round] of plan.rounds.entries()) {
      const id = `tavern-native-repair:${repairId}:${index}`
      const turn = round.turn
      const input = round.userText === null ? null : write('user/message', { id: id + ':input', role: 'user',
        content: [{ type: 'text', text: round.userText }], source: { kind: 'user', repair: { id: repairId } } })
      if (round.standalone) continue
      const reply = write('assistant/message', { turn, step: 1, message: { id: round.greeting ? nativeOpeningMessageId(chat.id) : id + ':reply',
        role: 'assistant', content: [{ type: 'text', text: round.replyText }], source: storySource(turn) } })
      // The story turn belongs in the source marker; the anchor and display mapping
      // locate the actual edit turn that the mutator assigned to this reply.
      const replyTurn = Number(reply?.data?.turn) || turn
      anchors.push({ messageIndex: round.messageIndex, anchor: input ? roundAnchor(replyTurn, input, reply) : null, replyTurn })
    }
    // A stale tail with nothing to write in its place: shadow it with an empty node.
    if (pending) write('assistant/message', { turn: 0, step: 1, message: { id: `tavern-native-repair:${repairId}:empty`, role: 'assistant', content: [], source } })
  })
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
  for (const { messageIndex, anchor, replyTurn } of anchors) {
    const row = current.messages?.[messageIndex], read = repaired.messages?.[messageIndex]
    if (row?.role !== 'assistant' || row.text !== read?.text || Number(row.turn) !== Number(read?.turn)) continue
    // A reply whose input was deleted has no valid pair anchor. Clear the stale
    // anchor instead of leaving it to resolve against an older reply (often the
    // opening) on every subsequent reconciliation.
    if (!anchor) {
      if (row.nativeAnchor !== undefined) { delete row.nativeAnchor; changed = true }
    } else {
      row.nativeAnchor = anchor
      changed = true
    }
    const storyTurn = Number(read?.turn)
    const nativeTurn = Number(replyTurn) || Number(anchor?.turn)
    if (Number.isSafeInteger(storyTurn) && storyTurn > 0 && Number.isSafeInteger(nativeTurn) && nativeTurn > 0) {
      const key = String(storyTurn)
      const mappings = current.regeneratedDshTurns && typeof current.regeneratedDshTurns === 'object' && !Array.isArray(current.regeneratedDshTurns)
        ? current.regeneratedDshTurns : {}
      if (nativeTurn === storyTurn && Object.hasOwn(mappings, key)) {
        const next = { ...mappings }
        delete next[key]
        if (Object.keys(next).length) current.regeneratedDshTurns = next
        else delete current.regeneratedDshTurns
        changed = true
      } else if (nativeTurn !== storyTurn && Number(mappings[key]) !== nativeTurn) {
        current.regeneratedDshTurns = { ...mappings, [key]: nativeTurn }
        changed = true
      }
    }
    // The rewritten reply already carries the edit; replaying the marker would target a shadowed node.
    delete row.bodyEdit
  }
  return changed
}
