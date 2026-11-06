import { storyEventTurn } from './session-upgrade-references.js'
import { sessionEvents } from './session-events.js'
import { assistantResultForTurn } from './session-turn-result.js'
import { inputEventForTurn, isFailedTurnEnd } from './session-turn-input.js'
import { roundAnchor } from './round-anchor.js'

function contentText(message) {
  return (Array.isArray(message?.content) ? message.content : []).filter(block => block?.type === 'text').map(block => String(block.text ?? '')).join('\n').trim()
}

/**
 * Completed player rounds that the model saw but the story save never recorded,
 * after its latest committed round. Such a gap (#196) made regenerate, rollback
 * and body edits act on the wrong round for good; adopting it heals the save.
 * Rolled-back, failed, regenerate and replay rounds are never adopted.
 */
export function uncommittedRounds(session, header = {}) {
  const commits = header.nativeCommits && typeof header.nativeCommits === 'object' ? header.nativeCommits : {}
  const committed = Object.keys(commits).map(Number).filter(Number.isSafeInteger)
  // Legacy saves without commit records cannot be judged: leave them alone.
  if (!committed.length) return []
  const regenerated = header.regeneratedDshTurns && typeof header.regeneratedDshTurns === 'object' ? Object.values(header.regeneratedDshTurns).map(Number) : []
  const skipped = new Set([...(Array.isArray(header.suppressedDshTurns) ? header.suppressedDshTurns : []), ...regenerated].map(Number))
  const latest = Math.max(...committed, ...Object.keys(header.regeneratedDshTurns || {}).map(Number).filter(Number.isSafeInteger))
  const nodes = new Set((session.surface?.nodes || []).map(Number))
  const rounds = []
  for (const event of sessionEvents(session)) {
    if (event?.type !== 'turn/end') continue
    const turn = storyEventTurn(event)
    if (!(turn > latest) || skipped.has(turn) || isFailedTurnEnd(event.data?.reason?.kind)) continue
    const inputEvent = inputEventForTurn(session, turn), input = inputEvent?.data
    if (!input || input.source?.kind !== 'user') continue
    const reply = assistantResultForTurn(session, turn)
    // The reply must still be what the model sees: a rolled-back round is tombstoned.
    if (!reply || reply.text === '' || !nodes.has(Number(reply.event.seq))) continue
    rounds.push({ turn, requestId: String(input.source.rpcId ?? '').trim(), userText: contentText(input), userContent: input.content || [], assistantText: reply.text, nativeAnchor: roundAnchor(turn, inputEvent, reply.event) })
  }
  return rounds.sort((left, right) => left.turn - right.turn)
}
