const segment = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('世界书日志标识无效')
  return value
}

// Recall audits are debugging evidence; only recent turns keep their detail.
export const WORLDBOOK_RECALL_KEEP_TURNS = 10
// Entries that simply did not apply are most of a large worldbook; record how
// many there were per reason instead of a full row for each.
const ROUTINE_REASONS = new Set(['keywords', 'disabled', 'empty'])
function slim(log) {
  if (!log || !Array.isArray(log.entries)) return log
  const routine = {}
  const entries = log.entries.filter(entry => {
    if (!ROUTINE_REASONS.has(entry?.reason)) return true
    routine[entry.reason] = (routine[entry.reason] || 0) + 1
    return false
  })
  return { ...log, entries, routineEntryCounts: routine }
}

/** Independent per-operation records. Neither prompt text nor chat snapshots carry the full audit. */
export function createWorldbookRecallLog({ store, now = Date.now }) {
  const base = chatId => 'worldbook-recalls/' + segment(chatId) + '/'
  // Drops index rows (and files) of turns older than the window.
  async function retain(chatId) {
    let dropped = []
    await store.updateJson(base(chatId) + 'index.json', previous => {
      const records = previous?.records || []
      const latest = records.reduce((max, record) => Math.max(max, Number(record.turn) || 0), 0)
      const cutoff = latest - WORLDBOOK_RECALL_KEEP_TURNS
      dropped = records.filter(record => (Number(record.turn) || 0) <= cutoff)
      return dropped.length ? { version: 1, records: records.filter(record => !dropped.includes(record)) } : previous
    })
    for (const record of dropped) await store.remove(record.path)
    return { pruned: dropped.length }
  }
  async function record({ chat, frame, log }) {
    const path = base(chat.id) + segment(frame.operationId) + '.json'
    const value = { version: 1, status: 'prepared', createdAt: now(), chatId: chat.id, sessionId: chat.sessionId,
      turn: frame.turn, operationId: frame.operationId, frameId: frame.frameId, branchId: frame.branchId, basedOnRevision: frame.basedOnRevision, ...slim(log) }
    await store.writeJson(path, value)
    await store.updateJson(base(chat.id) + 'index.json', previous => {
      const records = (previous?.records || []).filter(record => record.operationId !== frame.operationId)
      return { version: 1, records: [...records, { path, turn: frame.turn, operationId: frame.operationId, branchId: frame.branchId, createdAt: value.createdAt }] }
    })
    await retain(chat.id)
    return path
  }
  async function read(chat, turn) {
    const index = await store.readJson(base(chat.id) + 'index.json')
    const records = index?.records || []
    const target = [...records].reverse().find(record => (!turn || record.turn === Number(turn)) && (!chat.timeline?.branchId || record.branchId === chat.timeline.branchId))
    return { log: target ? await store.readJson(target.path) : null, availableTurns: [...new Set(records.filter(record => !chat.timeline?.branchId || record.branchId === chat.timeline.branchId).map(record => record.turn))],
      message: target ? '' : '这一轮没有保存详细召回日志；旧轮次不从当前世界书反推。' }
  }
  async function requested(chat, options, requestId) {
    const messages = options.messages || []
    const frame = [...messages].reverse().find(message => message.source?.form === 'foreground-frame')
    const frameId = frame?.source?.trace?.frameId
    if (!frameId) return
    const saved = Object.values(chat.foregroundFrames || {}).find(value => value.frameId === frameId)
    const path = saved?.source?.worldBook?.recallLog
    if (!path || path !== base(chat.id) + segment(saved.operationId) + '.json') return
    const requestText = messages.flatMap(message => message.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n')
    await store.updateJson(path, log => log ? { ...log, status: 'requested', requestedAt: now(), requestIds: [...new Set([...(log.requestIds || []), requestId])],
      outputs: log.outputs.map(output => ({ ...output, requestContainsText: output.location === 'foreground' ? requestText.includes(output.text) : null })) } : log)
  }
  return { record, read, requested, prune: retain }
}
