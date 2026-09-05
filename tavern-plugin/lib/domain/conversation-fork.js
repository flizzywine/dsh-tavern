function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** Acknowledge the committed fork without rebuilding its presentation view. */
export function conversationForkReceipt(chat, replayed = {}) {
  return {
    chatId: str(chat && chat.id),
    sessionId: str(chat && chat.sessionId),
    lastTurn: Math.max(0, Number(replayed.lastTurn) || 0),
    messageCount: Math.max(0, Number(replayed.messageCount) || 0)
  }
}

/** Create an independent game aggregate at the source Chat's committed head. */
export function forkConversationChat(source, options = {}) {
  if (!source || str(source.id) === '') throw new Error('找不到要分叉的源对话')
  const targetChatId = str(options.chatId)
  const targetSessionId = str(options.sessionId)
  if (targetChatId === '' || targetSessionId === '') throw new Error('分叉目标缺少 Chat 或 Session 标识')
  const now = typeof options.now === 'function' ? options.now() : Date.now()
  const makeId = typeof options.id === 'function' ? options.id : function (prefix) { return prefix + '-' + randomUUID() }
  const sourceTimeline = object(source.timeline)
  const checkpoints = Array.isArray(sourceTimeline.checkpoints) ? sourceTimeline.checkpoints : []
  const latestCheckpoint = checkpoints[checkpoints.length - 1]
  const chat = clone(source)

  delete chat._storageRevision
  delete chat.regenInProgress
  chat.id = targetChatId
  chat.sessionId = targetSessionId
  chat.createdAt = now
  chat.updatedAt = now
  chat.nativeOpeningAppended = true
  chat.nativeCommits = {}
  chat.suppressedDshTurns = []
  chat.regeneratedDshTurns = {}
  chat.candidates = null
  chat.candidateAgent = null
  chat.foregroundError = null
  chat.settleError = null
  chat.forkedFrom = {
    chatId: str(source.id),
    sessionId: str(source.sessionId),
    branchId: str(sourceTimeline.branchId),
    revision: Math.max(0, Number(sourceTimeline.revision) || 0),
    storageRevision: Math.max(0, Number(source._storageRevision) || 0),
    checkpointId: str(latestCheckpoint && latestCheckpoint.id),
    forkedAt: now
  }
  chat.timeline = {
    schemaVersion: 1,
    branchId: makeId('branch'),
    revision: 0,
    checkpoints: [],
    participants: {},
    operations: {},
    updatedAt: now
  }
  return chat
}

export function assertConversationForkable(chat, options = {}) {
  if (!chat) throw new Error('找不到要分叉的对话')
  if (!['story', 'script'].includes(str(chat.mode) || 'story')) throw new Error('只有游玩对话可以分叉')
  if (options.agentRunning === true || chat.regenInProgress === true) throw new Error('当前正文仍在生成，请等待完成后再分叉')
  const timeline = object(chat.timeline)
  const unfinished = Object.values(object(timeline.operations)).find(function (operation) {
    return operation && (operation.status === 'running' || (operation.kind === 'body' && operation.status === 'foreground-completed'))
  })
  if (unfinished) throw new Error('当前轮次尚未完成生成或状态结算，请等待完成后再分叉')
  if (['pending', 'running'].includes(str(chat.settleStatus))) throw new Error('当前轮次尚未完成状态结算，请等待完成后再分叉')
  if (chat.mvu?.enabled === true && chat.mvu?.openingInitialization?.status === 'pending') {
    throw new Error('MVU 开局状态尚未初始化完成，请等待完成后再分叉')
  }
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  const last = messages[messages.length - 1]
  if (last && last.role === 'user') throw new Error('当前玩家输入尚未产生正文，不能分叉')
  return true
}
