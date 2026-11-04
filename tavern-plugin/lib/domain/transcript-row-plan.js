import { surfaceReplacementRange } from './session-events.js'
import { createImmutableTurnFields } from './freeze-json.js'

// The conversation page's row plan (Wiki「设计：transcript-row-plan」). The host draws
// every append-origin message forever; instead of listing what to hide, say for each
// saved round which native turn draws its input and which draws its reply. Every other
// finished native turn draws nothing.
//
// The plan is folded incrementally: log events are append-only and fed once each, save
// floors are fed from the first floor whose shape changed. Each feed touches only the
// turns it affects, and the result is a keyed map of exceptions — a native turn absent
// from it shows its own input and reply — so neither computing, sending nor reading it
// grows with the length of the game.

function textOf(message) {
  return (message?.content || []).filter(block => block?.type === 'text').map(block => block.text).join('')
}
const storyOf = event => Number(event?.data?.message?.source?.tavernStoryTurn)
const isAppendReply = event => event?.type === 'assistant/message' && event.surfaceOp === 'append'
const stepKey = event => event?.data?.turn + ':' + event?.data?.step

const turnFields = createImmutableTurnFields()

/**
 * One game's plan, fed in pieces. `result()` returns an immutable turn-keyed map:
 * { [nativeTurn]: { input: 0|1, reply: 0|1, story?: number } } for every native turn that
 * does not simply show its own input and reply.
 */
export function createTranscriptFold() {
  // From the log.
  let folded = -1
  const turns = new Set()
  let last = null, running = false, playerInput = false, queuedInput = false, ended = ''
  let inputSeq = null, queuedSeq = null // where the last turn's player input sits in the log
  const inputTurns = new Set() // native turns a player's input opened
  const drawn = new Map() // story -> the native turn that draws its reply
  const pending = new Map() // step -> rewrites appended in it, decided when it ends
  const stepReplies = new Map() // step -> reply appends with text
  // From the save: one entry per floor.
  const floors = []
  const usersBefore = [] // player inputs before each floor (for floors without a turn)
  const rounds = new Map() // story -> assistant floors that hold its reply
  const inputs = new Map() // story -> user floors that hold its input
  const openingInputs = new Set() // legacy openings whose input exists only in the native log
  // Derived.
  const replyStories = new Map() // native turn -> rounds drawn there
  const dirty = new Set()
  let open = null
  // From the save: a regeneration under way (docs step 3).
  let replacing = new Set(), regenerating = false
  // From the view: void turns that keep the player's own message (a retry adopted it).
  let keepInput = new Set()
  let exceptions = turnFields.from({})

  const replyOf = story => drawn.get(story) ?? story
  function link(story, turn, add) {
    let set = replyStories.get(turn)
    if (add) { if (!set) replyStories.set(turn, set = new Set()); set.add(story) }
    else if (set) { set.delete(story); if (!set.size) replyStories.delete(turn) }
    dirty.add(turn)
  }
  function setDrawn(story, turn) {
    if (drawn.get(story) === turn) return
    const isRound = rounds.has(story)
    if (isRound) link(story, replyOf(story), false)
    drawn.set(story, turn)
    if (isRound) link(story, turn, true)
  }
  function addRound(story) {
    rounds.set(story, (rounds.get(story) || 0) + 1)
    if (rounds.get(story) === 1) { link(story, replyOf(story), true); dirty.add(story) }
  }
  function removeRound(story) {
    const count = (rounds.get(story) || 0) - 1
    if (count > 0) { rounds.set(story, count); return }
    rounds.delete(story)
    link(story, replyOf(story), false)
    dirty.add(story)
  }
  function addInput(story) {
    inputs.set(story, (inputs.get(story) || 0) + 1)
    dirty.add(story)
  }
  function removeInput(story) {
    const count = (inputs.get(story) || 0) - 1
    if (count > 0) inputs.set(story, count)
    else inputs.delete(story)
    dirty.add(story)
  }
  function removeFloor(floor) {
    if (floor.openingInput) {
      openingInputs.delete(floor.story)
      dirty.add(floor.story)
    }
    if (floor.story === null) return
    if (floor.role === 'assistant') removeRound(floor.story)
    else if (floor.role === 'user') removeInput(floor.story)
  }
  // Ordinary user floors inherit the following reply's story number. A user floor
  // whose reply was deleted carries an explicit turn instead, so it neither disappears
  // with that reply nor becomes attached to the next round.
  function unlinkInheritedInputs(story) {
    for (let index = floors.length - 1; index >= 0; index--) {
      const floor = floors[index]
      if (floor.role === 'assistant') break
      if (floor.role !== 'user' || floor.explicitStory || floor.story !== story) continue
      removeInput(story)
      floor.story = null
    }
  }
  function linkPendingInputs(story) {
    for (let index = floors.length - 2; index >= 0; index--) {
      const floor = floors[index]
      if (floor.role === 'assistant') break
      if (floor.role !== 'user' || floor.explicitStory || floor.story !== null) continue
      floor.story = story
      addInput(story)
    }
  }
  function flushStep(key) {
    const rewrites = pending.get(key)
    pending.delete(key)
    // The host draws one row per step. A repair that rewrote many rounds put them all
    // in one step: that row is every round at once, so it stands for none of them.
    if (rewrites && stepReplies.get(key) === 1) setDrawn(rewrites[0].story, rewrites[0].turn)
    stepReplies.delete(key)
  }

  /** Fold log events from index `from` (events[i].seq === i for a session log). */
  function addEvents(events, from = folded + 1) {
    // A log, or a tail of one: seqs are contiguous, so an event sits at seq - first seq.
    const offset = Number.isSafeInteger(events[0]?.seq) ? events[0].seq : 0
    const eventAt = seq => (events[seq - offset]?.seq === seq ? events[seq - offset] : undefined)
    for (let index = Math.max(0, from); index < events.length; index++) {
      const event = events[index]
      folded = index
      if (!event) continue
      if (event.type === 'turn/start') {
        // A player's message queued before its turn starts (the inbox splices it in) opens it.
        if (last !== null) dirty.add(last)
        last = Number(event.data?.turn); running = true; playerInput = queuedInput; queuedInput = false; ended = ''
        inputSeq = playerInput ? queuedSeq : null; queuedSeq = null
        if (playerInput) inputTurns.add(last)
        if (!turns.has(last)) { turns.add(last); dirty.add(last) }
        continue
      }
      if (event.type === 'turn/end') {
        running = false
        ended = String(event.data?.reason?.kind || '')
        for (const key of [...pending.keys()]) if (key.startsWith(event.data?.turn + ':')) flushStep(key)
        continue
      }
      if (event.type === 'step/end') { flushStep(event.data?.turn + ':' + event.data?.step); continue }
      if (event.type === 'user/message' && event.surfaceOp === 'append' && event.data?.source?.kind === 'user' && !event.data?.source?.repair) {
        if (running) { playerInput = true; inputSeq = event.seq; inputTurns.add(last); dirty.add(last) } else { queuedInput = true; queuedSeq = event.seq }
        continue
      }
      if (event.type !== 'assistant/message') continue
      const story = storyOf(event)
      // A rollback replaces the model's surface from a round's input on: when that covers
      // the last turn's player input, the turn is rolled back, not failed and awaiting retry.
      if (event.surfaceOp?.op === 'replace' && !(story > 0) && Number.isSafeInteger(inputSeq)) {
        const range = surfaceReplacementRange(event.surfaceOp)
        if (Number(range.start) <= inputSeq && inputSeq <= Number(range.end)) { playerInput = false; if (last !== null) dirty.add(last) }
      }
      if (isAppendReply(event)) {
        if (textOf(event.data?.message) === '') continue
        const key = stepKey(event)
        stepReplies.set(key, (stepReplies.get(key) || 0) + 1)
        // A rewrite appended as its own row (a repaired round) draws itself.
        if (Number.isSafeInteger(story) && story > 0) {
          if (!pending.has(key)) pending.set(key, [])
          pending.get(key).push({ story, turn: Number(event.data?.turn) })
        }
        continue
      }
      if (!Number.isSafeInteger(story) || story < 1 || event.surfaceOp?.op !== 'replace') continue
      // A replacement is model-only: the round shows at the drawable row it covers —
      // its tail when that is a reply append (the projection's copy, or the attempt's
      // own streamed reply), else the last reply append with text inside the range (an
      // old tool submission's fold copy). With none, the round keeps its own row.
      const range = surfaceReplacementRange(event.surfaceOp)
      const end = eventAt(Number(range.end))
      if (isAppendReply(end)) { setDrawn(story, Number(end.data?.turn)); continue }
      let copy = null
      for (let seq = Number(range.end); seq >= Number(range.start) && copy === null; seq--) {
        const source = eventAt(seq)
        if (isAppendReply(source) && textOf(source.data?.message) !== '' && Number(source.data?.turn) > 0) copy = source
      }
      setDrawn(story, copy ? Number(copy.data.turn) : story)
    }
  }

  /** Replace the save's floors from `from` on (later floors are dropped) with `rows`. */
  function setFloors(from, rows) {
    const start = Math.max(0, Math.min(from, floors.length))
    for (let index = floors.length - 1; index >= start; index--) {
      const floor = floors[index]
      const removedReply = floor.role === 'assistant' ? floor.story : null
      removeFloor(floor)
      floors.pop(); usersBefore.pop()
      if (removedReply !== null && !rounds.has(removedReply)) unlinkInheritedInputs(removedReply)
    }
    for (const row of rows) {
      const index = floors.length
      const before = index === 0 ? 0 : usersBefore[index - 1] + (floors[index - 1].role === 'user' ? 1 : 0)
      // Floors without a turn (old saves) count the way the reply projection does
      // (projectReplyHistory): the opening is round 1, each player input starts the next.
      // A standalone user floor retains the deleted reply's turn explicitly.
      const explicitStory = row?.role === 'user' && Number.isSafeInteger(Number(row.turn)) && Number(row.turn) > 0
      const story = row?.role === 'assistant' ? (Number(row.turn) || (row.greeting === true ? 1 : before + 1))
        : explicitStory ? Number(row.turn) : null
      const floor = { role: row?.role, story: Number.isSafeInteger(story) && story > 0 ? story : null, explicitStory,
        openingInput: row?.role === 'assistant' && row.greeting === true && row.openingInputDeleted !== true }
      floors.push(floor); usersBefore.push(before)
      if (floor.role === 'assistant' && floor.story !== null) {
        addRound(floor.story)
        if (floor.openingInput) openingInputs.add(floor.story)
        linkPendingInputs(floor.story)
      } else if (floor.role === 'user' && floor.story !== null) addInput(floor.story)
    }
  }

  // The native turn the save does not hold but the page must keep, as the host draws it:
  // one still running, or the last one when it failed or was stopped with a player's
  // input in it (its error and retry live there). A round is saved before its turn ends,
  // so a completed turn the save lacks was rolled back; one the save missed (#196) is
  // adopted shortly and shows then.
  function currentOpen() {
    if (last === null) return null
    if (running) return last
    return playerInput && ended !== 'completed' && !rounds.has(last) && !replyStories.has(last) ? last : null
  }
  /** A regeneration under way: the native turns whose old reply it replaces. */
  function setRegeneration({ replacing: turnsReplaced = [], inProgress = false } = {}) {
    const next = new Set(turnsReplaced.map(Number).filter(turn => Number.isSafeInteger(turn) && turn >= 0))
    for (const turn of new Set([...replacing, ...next])) dirty.add(turn)
    if (last !== null) dirty.add(last)
    replacing = next; regenerating = inProgress === true
  }
  /** Turns whose player input stays visible although the round's reply is drawn elsewhere. */
  function setKeepInput(turns = []) {
    const next = new Set((Array.isArray(turns) ? turns : []).map(Number).filter(turn => Number.isSafeInteger(turn) && turn > 0))
    for (const turn of new Set([...keepInput, ...next])) dirty.add(turn)
    keepInput = next
  }
  function classify(turn) {
    // A regeneration's attempt (the save says one is under way) has no player's input,
    // only the host's trigger card: show its reply alone, while it runs and until its
    // body is drawn as the round's. Outside a regeneration a running turn shows as drawn:
    // the log does not always mark the player's input as such.
    const attempt = regenerating && turn === last && !playerInput && (turn === open || !rounds.has(turn) && !replyStories.has(turn))
    if (attempt) return { input: 0, reply: 1 }
    if (turn === open) return undefined
    // The old reply a regeneration is replacing: the round shows its input only, so the
    // page does not read as two replies or as a regeneration that did nothing. The save
    // may hold the round out while it regenerates: the player's input still shows.
    if (replacing.has(turn)) return { input: inputs.has(turn) || inputTurns.has(turn) ? 1 : 0, reply: 0 }
    // A failed turn's player input adopted by a retry: the round's reply is drawn in
    // another native turn, but hiding this turn whole would take the player's own words
    // with it. Draw his message only; the residue and trigger card stay hidden.
    if (keepInput.has(turn) && !rounds.has(turn) && !replyStories.has(turn)) return { input: 1, reply: 0, kept: 1 }
    const input = inputs.has(turn) || openingInputs.has(turn)
    const stories = replyStories.get(turn)
    const reply = Boolean(stories?.size)
    const story = reply ? Math.max(...stories) : turn
    if (!input && !reply && !turns.has(turn)) return undefined
    if (input && reply && story === turn) return undefined
    return { input: input ? 1 : 0, reply: reply ? 1 : 0, ...(reply && story !== turn ? { story } : {}) }
  }
  /** The plan as an immutable turn-keyed map; unchanged turns keep their identity. */
  function result() {
    const next = currentOpen()
    if (next !== open) { if (open !== null) dirty.add(open); if (next !== null) dirty.add(next); open = next }
    if (dirty.size) {
      const sets = [], removes = []
      for (const turn of dirty) {
        if (!Number.isSafeInteger(turn) || turn < 0) continue
        const value = classify(turn)
        if (value === undefined) removes.push(turn)
        else sets.push([turn, value])
      }
      dirty.clear()
      exceptions = turnFields.update(exceptions, sets, removes)
    }
    return exceptions
  }
  return { addEvents, setFloors, setRegeneration, setKeepInput, result, get floorCount() { return floors.length }, get folded() { return folded }, get open() { result(); return open } }
}

const floorOf = message => ({ role: message?.role, turn: message?.turn, greeting: message?.greeting })

/**
 * The plan for what a view holds: its save floors (the whole history, or the bounded
 * window long games are shown with) and the log from the turn the first of those rounds
 * began. The cost follows the window, never the length of the game: native turns before
 * the window's first round are not judged (`from`), and the page leaves them as the host
 * draws them until scrolling brings them into a wider window.
 * @returns {{ turns: object, from: number | null }}
 */
export function planTranscriptWindow({ messages = [], events = [], partial = false, regeneration, keepInput }) {
  const fold = createTranscriptFold()
  fold.setFloors(0, messages.map(floorOf))
  if (!partial) { fold.addEvents(events, 0); fold.setRegeneration(regeneration); fold.setKeepInput(keepInput); return { turns: fold.result(), from: null } }
  let from = Number.MAX_SAFE_INTEGER
  for (const message of messages) {
    const turn = Number(message?.turn)
    if (message?.role === 'assistant' && Number.isSafeInteger(turn) && turn > 0) { from = turn; break }
  }
  // Native turns only grow along the log: walk back to the window's first turn, then
  // keep the player's messages queued right before it (the inbox splices them in).
  let start = events.length
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type !== 'turn/start') continue
    if (Number(event.data?.turn) < from) break
    start = index
  }
  for (let index = start - 1; index >= 0; index--) {
    const type = events[index]?.type
    if (type === 'turn/end' || type === 'turn/start') break
    if (type === 'user/message') start = index
  }
  fold.addEvents(events.slice(start), 0)
  fold.setRegeneration(regeneration)
  fold.setKeepInput(keepInput)
  return { turns: fold.result(), from }
}

/** The whole plan at once, for tests and the replay: the same fold fed everything. */
export function planTranscriptRows({ chat, events = [], regeneration, keepInput }) {
  const fold = createTranscriptFold()
  fold.setFloors(0, (Array.isArray(chat?.messages) ? chat.messages : []).map(floorOf))
  fold.addEvents(events, 0)
  fold.setRegeneration(regeneration)
  fold.setKeepInput(keepInput)
  return fold.result()
}

const INPUT_ROWS = new Set(['user', 'turn-trigger'])

/**
 * Whether the page shows one host row under a plan (the turn-keyed exceptions). The
 * client applies the same rule; the replay and the comparison log use this copy.
 * @param {{ turn: number | null, kind: string }} row
 */
export function planShowsRow(plan, row, from = null) {
  if (!plan || row.turn === null || row.turn === undefined) return true
  // Before a windowed plan's first round: not judged, shown as the host draws it.
  if (from !== null && Number(row.turn) < from) return true
  const entry = plan[String(row.turn)]
  if (!entry) return true
  // A kept input turn draws the player's own message and nothing else.
  if (entry.kept) return row.kind === 'user' || row.kind === 'steering'
  // Host notes (context rows) of a turn that draws nothing go with it.
  if (row.kind === 'context') return entry.input === 1 || entry.reply === 1
  // Replies, tails and errors belong to the turn that draws the round's reply; a turn
  // that only holds the input keeps the input and nothing else.
  return INPUT_ROWS.has(row.kind) ? entry.input === 1 : entry.reply === 1
}

/** The story round a native turn's reply row is drawn as, or the turn itself. */
export function planStoryTurn(plan, turn) {
  return plan?.[String(turn)]?.story ?? Number(turn)
}
