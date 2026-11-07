import path from 'node:path'
import { createDurableFilePromotion } from '../durable-file-promotion.js'

/** Cross-process conversation lock shared by native writes and legacy cutover. */
export function createConversationWriteLock({ dataRoot }) {
  const promotion = createDurableFilePromotion({ writeLockStaleMs: Number.MAX_SAFE_INTEGER })
  return Object.freeze({
    async lock(chatId, operation) {
      if (typeof chatId !== 'string' || !chatId || chatId === '.' || chatId === '..' || /[\\/\0]/.test(chatId)) throw new Error('Invalid chat id')
      let result
      await promotion.update(path.join(dataRoot, '.conversation-locks', chatId), async () => {
        result = await operation()
        return undefined
      })
      return result
    }
  })
}
