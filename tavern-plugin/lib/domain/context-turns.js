// compaction may replace history, but cannot strand a turn's prompts.
export function surfaceTurnKeys(session, nodes) {
  const keys = new Map()
  let turn = null
  for (let seq = 0; seq < session.seq; seq++) {
    const event = session.eventAt(seq)
    if (!event) continue
    if (event.type === 'turn/start') turn = event.seq
    const message = session.deriveEventMessage(event)
    if (message && event.type !== 'system/message') {
      const checkpoint = message.source?.kind === 'plugin' && ['compact', 'dsh-compaction-basic'].includes(message.source.plugin)
      // Checkpoints are new events in the current turn, not part of its dialogue.
      if (!checkpoint) keys.set(seq, turn ?? (message.source?.trace?.turn !== undefined ? 'trace:' + message.source.trace.turn : null))
    }
    if (event.type === 'turn/end') turn = null
  }
  return nodes.map(node => keys.get(typeof node === 'number' ? node : node.seq) ?? null)
}

export function wholeTurnKeepIndex(keys, keep) {
  if (keep >= keys.length || keys[keep] === null) return keep
  while (keep > 0 && keys[keep - 1] === keys[keep]) keep--
  return keep
}

// The host still owns summary transactions, locks and tool-pair validation.
// Keep the first retained turn intact on pressure, overflow and manual paths alike.
export function wholeTurnCompactionRange(session, start, end) {
  const nodes = session.surface.nodes
  const first = nodes.indexOf(start), last = nodes.indexOf(end)
  if (first < 0 || last < first) throw new Error('Compaction range is not on the current surface')
  const keys = surfaceTurnKeys(session, nodes)
  const keep = wholeTurnKeepIndex(keys, last + 1)
  if (keep <= first) return null
  return { start, end: nodes[keep - 1] }
}
