import { sessionEvents } from './session-events.js'

// Fork and illustration buttons are keyed by the reply the player actually sees.
// A turn may write several model messages (tool step, reply, projection), and the
// visible one is not reliably the last (#234), so every model message of a
// completed native turn maps to it. Projections are often written after the chat
// revision, so this must be derived from session events on every view, never
// from the revision-cached chat projection.
//
// Two coordinate systems meet here and must stay apart: `data.turn` is the native
// lifecycle turn (a regeneration moves the body to a later one), while the fork
// request expects the story turn of the saved row. A projected reply names its
// story turn in `source.tavernStoryTurn`; an untagged reply is translated through
// the regenerated mapping (native -> story). Filing replies under whichever
// number the two happened to produce left a regenerated round keyed by its story
// turn but judged by the native turn that completed, so the round lost its fork
// button, and a leftover lifecycle turn could be offered as a fork target.
//
// A regenerated story keeps only the reply of its latest attempt: the displaced
// original is either shadowed by the replacement that took its place or still
// sits in the native turn the mapping has moved away from, and neither is a fork
// target.
// Earlier turns lose their history after save maintenance (only the latest
// FORK_HISTORY_TURNS turns stay forkable), so they get no fork button.
export const FORK_HISTORY_TURNS = 50

// The story turn an event speaks about. A tagged reply names it directly; every
// other event is native, so it is translated (never taken as a story turn).
function storyTurnOf(event, storyByNative) {
  const tagged = Number(event?.data?.message?.source?.tavernStoryTurn)
  if (Number.isSafeInteger(tagged) && tagged > 0) return tagged
  const native = Number(event?.data?.turn)
  if (!Number.isSafeInteger(native) || native < 1) return 0
  return storyByNative.get(native) ?? native
}

export function forkTurnsByMessageId(session, regeneratedDshTurns = {}) {
  const storyByNative = new Map()
  const nativeByStory = new Map()
  for (const [story, native] of Object.entries(regeneratedDshTurns || {})) {
    const from = Number(story)
    const to = Number(native)
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) continue
    storyByNative.set(to, from)
    nativeByStory.set(from, to)
  }
  const events = sessionEvents(session)
  // A replacement keeps the place of the reply it displaced and lists the seqs it
  // shadows: those are the old projected originals, not fork targets.
  const shadowed = new Set()
  for (const event of events) {
    if (event?.surfaceOp?.op !== 'replace') continue
    for (const seq of Array.isArray(event.sourceEventSeqs) ? event.sourceEventSeqs : []) shadowed.add(Number(seq))
  }
  // Nodes are the messages the model surface still owns; a replaced reply leaves
  // the list while the host may keep drawing its row, so this only breaks ties.
  const visible = new Set()
  for (const node of Array.isArray(session?.surface?.nodes) ? session.surface.nodes : []) {
    const seq = Number(typeof node === 'number' ? node : node?.seq)
    if (Number.isSafeInteger(seq)) visible.add(seq)
  }
  const replies = new Map() // story turn -> [{ messageId, seq, tagged, superseded }]
  const completed = new Set() // story turns whose current native turn completed
  for (const event of events) {
    if (!event) continue
    const story = storyTurnOf(event, storyByNative)
    if (!Number.isSafeInteger(story) || story < 1) continue
    if (event.type === 'turn/start') { replies.delete(story); completed.delete(story); continue }
    if (event.type === 'turn/end') { if (event.data?.reason?.kind === 'completed') completed.add(story); continue }
    if (event.type !== 'assistant/message') continue
    const message = event.data?.message
    if (message?.source?.kind !== 'model' || !message.id) continue
    const native = Number(event.data?.turn)
    const storyTag = Number(message.source?.tavernStoryTurn)
    const tagged = Number.isSafeInteger(storyTag) && storyTag > 0
    // An untagged reply living in the native turn its story has been moved away
    // from is the original that regeneration replaced.
    const moved = !tagged && nativeByStory.has(native) && nativeByStory.get(native) !== native
    const bucket = replies.get(story) || []
    bucket.push({ messageId: String(message.id), seq: Number(event.seq), tagged, superseded: shadowed.has(Number(event.seq)) || moved })
    replies.set(story, bucket)
  }
  const result = {}
  for (const [story, bucket] of replies) {
    if (!completed.has(story)) continue
    // A story whose every reply was displaced has nothing left to fork from.
    const live = bucket.filter(entry => !entry.superseded)
    const shown = visible.size ? live.filter(entry => visible.has(entry.seq)) : []
    const pool = shown.length ? shown : live
    if (!pool.length) continue
    // The tagged projection is the reply a regenerated round keeps; an untagged
    // copy left in the same story turn is what it replaced.
    const tagged = pool.filter(entry => entry.tagged)
    for (const entry of tagged.length ? tagged : pool) result[entry.messageId] = story
  }
  const latest = Math.max(0, ...Object.values(result))
  for (const [messageId, turn] of Object.entries(result)) if (turn <= latest - FORK_HISTORY_TURNS) delete result[messageId]
  return result
}
