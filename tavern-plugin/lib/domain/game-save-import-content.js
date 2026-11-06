import { sceneSaveKeyMap } from './scene-save.js'
import { computeSceneTarget } from './scene-illustration.js'

export function assertImportableSave(save) {
  const states = [save.chat, ...save.revisions.map(item => item.state)]
  if (states.some(state => !state || typeof state !== 'object' || !Array.isArray(state.messages))) throw new Error('存档包已损坏：存档内容不完整')
  if (!['story', 'script'].includes(save.chat.mode || 'story')) throw new Error('存档包不是游玩对话')
  const events = save.session?.events
  if (!Array.isArray(events) || !events.some(event => event?.type === 'turn/end')) throw new Error('存档包已损坏：缺少模型会话记录')
  if (events.some((event, index) => event?.seq !== index)) throw new Error('存档包已损坏：模型会话记录不连续')
}


/** Per-import identity, attachment and history revision mapping; never mutates source states. */
export function createGameSaveImportContent(save, { chatId, sessionId, cardPath, replacedRefs }) {
  const sourceChatId = String(save.chat.id), sourceSessionId = String(save.session.header?.id || save.chat.sessionId)
  const withRefs = value => {
    if (Array.isArray(value)) return value.map(withRefs)
    if (!value || typeof value !== 'object') return value
    if (typeof value.attachmentId === 'string' && replacedRefs.has(value.attachmentId)) return { ...value, ...replacedRefs.get(value.attachmentId) }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, withRefs(child)]))
  }
  // Scene image keys hash the chat id; map the current branch's keys to the new id.
  const keyMap = sceneSaveKeyMap([save.chat, ...save.revisions.map(item => item.state)], chatId)
  const rename = text => {
    let out = text.split(sourceChatId).join(chatId).split(sourceSessionId).join(sessionId)
    for (const [from, to] of keyMap) out = out.split(from).join(to)
    return out
  }
  const renameJson = value => JSON.parse(rename(JSON.stringify(withRefs(value))))
  const background = { role: 'background', lifetime: 'chat', status: 'needs-session', sessionId: '', boundary: null }
  const revisionMap = new Map()
  let latestRevision = 0
  const prepare = state => {
    const next = renameJson(state)
    next.id = chatId; next.sessionId = sessionId; next.cardPath = cardPath
    // Background agents, candidates and undo points name the source install's sessions.
    for (const key of ['forkedFrom', 'regenRecovery', 'regenInProgress', 'rollbackUndo', 'backgroundHistoryIds', 'candidateAgent']) delete next[key]
    const scrub = value => {
      if (Array.isArray(value)) { value.forEach(scrub); return }
      if (!value || typeof value !== 'object') return
      for (const key of ['traceSessionId', 'traceSessionIds', 'startedSessionId']) delete value[key]
      Object.values(value).forEach(scrub)
    }
    scrub(next)
    next.timeline = { ...(next.timeline || {}), participants: { background }, operations: {} }
    next.timeline.checkpoints = (next.timeline.checkpoints || []).filter(checkpoint => revisionMap.has(Number(checkpoint.beforeRevision)))
      .map(checkpoint => ({ ...checkpoint, beforeRevision: revisionMap.get(Number(checkpoint.beforeRevision)), ...(checkpoint.participants ? { participants: { background } } : {}) }))
    // 卡上下文快照是缓存：读的时候 play-card-snapshots.ensure() 会按当前卡重新生成。
    // 一局状态文档里它一家占了 86%（实测 23.3 KB / 27 KB），导进来纯属白写。
    next.cardContextSnapshot = ''
    next.cardContextSnapshotVersion = 0
    delete next.cardContextConstants
    next._storageRevision = latestRevision
    return next
  }

  function recordRevision(sourceRevision, storedRevision) {
    latestRevision = storedRevision
    revisionMap.set(sourceRevision, storedRevision)
  }
  const pluginKeys = new Map()
  for (const message of save.chat.messages || []) {
    if (message?.role !== 'assistant') continue
    const turn = Number(message.turn || (message.greeting ? 1 : 0))
    try { pluginKeys.set(turn + '\u0000' + computeSceneTarget(save.chat, turn).key, computeSceneTarget({ ...save.chat, id: chatId }, turn).key) } catch {}
  }
  return Object.freeze({ prepare, rename, renameJson, recordRevision, pluginKeys })
}
