export function nativeResult(events, afterSeq) {
  const added = eventsAfterSeq(events, afterSeq)
  const start = added.find(event => event.type === 'turn/start')
  if (!start) return { ready: false }
  const end = added.find(event => event.type === 'turn/end' && event.data?.turn === start.data?.turn)
  if (!end) return { ready: false }
  const messages = added.filter(event => event.type === 'assistant/message' && event.data?.turn === start.data.turn)
  const text = messages.flatMap(event => event.data?.message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n')
  const errorEvent = added.find(event => /error|fail/.test(event.type))
  return { ready: true, turn: start.data.turn, reason: end.data.reason, text, error: errorEvent ? errorEvent.type : null, events: added }
}
// Compacted reasoning/tool chunks have no seq; retain them between numbered events.
export function eventsAfterSeq(events, afterSeq = 0) {
  const start = events.findIndex(event => Number(event.seq) > afterSeq)
  return start < 0 ? [] : events.slice(start)
}
