// Stability is an equality check of the same serialization on both sides, not an identity: compare it directly.
const serialized = value => JSON.stringify(value)
const revision = chat => Number.isSafeInteger(chat?._storageRevision) ? chat._storageRevision : serialized(chat)

/**
 * Exporting a save only requires a play chat with no live work mutating it right now.
 * Unlike forking, persisted leftovers from interrupted rounds (a trailing user message,
 * or stale regenInProgress / settleStatus / pending timeline operations) must not block
 * exporting a save or a transfer bundle.
 */
export function assertGameSaveExportable(chat, options = {}) {
  if (!chat) throw new Error('找不到要导出的对话')
  const mode = typeof chat.mode === 'string' && chat.mode ? chat.mode : 'story'
  if (!['story', 'script'].includes(mode)) throw new Error('只有游玩对话可以导出存档')
  if (options.agentRunning === true) throw new Error('当前正文仍在生成，请等待完成后再导出')
  if (options.settlementRunning === true) throw new Error('当前轮次正在状态结算，请等待完成后再导出')
  return true
}

/** Read native history before Chat, then verify both after collecting dependencies.
 * Export may run alongside play, but only a stable snapshot can be returned. */
export function createGameSaveSnapshot({ readChat, readSession, readWorldSnapshot, assertIdle }) {
  return async function capture(chatId, sessionId, collect) {
    const session = await readSession(sessionId)
    const nativeVersion = serialized(session)
    const chat = await readChat(chatId)
    if (!chat || chat.sessionId !== sessionId) throw new Error('导出目标已变化，请重新打开游戏后重试')
    assertIdle(chat)
    const chatVersion = revision(chat)
    const world = readWorldSnapshot ? await readWorldSnapshot(chatId) : null
    const worldVersion = value => value ? value.chatRevision + ':' + value.worldRevision : ''
    const result = await collect({ chat, session, world })
    const currentSession = await readSession(sessionId)
    const current = await readChat(chatId)
    const currentWorld = readWorldSnapshot ? await readWorldSnapshot(chatId) : null
    if (!current || current.sessionId !== sessionId || revision(current) !== chatVersion || serialized(currentSession) !== nativeVersion || worldVersion(currentWorld) !== worldVersion(world)) {
      throw new Error('导出期间游戏发生变化，请等待当前操作完成后重新导出')
    }
    assertIdle(current)
    return result
  }
}
