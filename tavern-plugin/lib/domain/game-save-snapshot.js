import { createHash } from 'node:crypto'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const revision = chat => Number.isSafeInteger(chat?._storageRevision) ? chat._storageRevision : digest(chat)

/** Read native history before Chat, then verify both after collecting dependencies.
 * Export may run alongside play, but only a stable snapshot can be returned. */
export function createGameSaveSnapshot({ readChat, readSession, assertIdle }) {
  return async function capture(chatId, sessionId, collect) {
    const session = await readSession(sessionId)
    const nativeVersion = digest(session)
    const chat = await readChat(chatId)
    if (!chat || chat.sessionId !== sessionId) throw new Error('导出目标已变化，请重新打开游戏后重试')
    assertIdle(chat)
    const chatVersion = revision(chat)
    const result = await collect({ chat, session })
    const currentSession = await readSession(sessionId)
    const current = await readChat(chatId)
    if (!current || current.sessionId !== sessionId || revision(current) !== chatVersion || digest(currentSession) !== nativeVersion) {
      throw new Error('导出期间游戏发生变化，请等待当前操作完成后重新导出')
    }
    assertIdle(current)
    return result
  }
}
