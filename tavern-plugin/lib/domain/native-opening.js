import { createHash } from 'node:crypto'

// Stable identity in the existing message.id field: a retry after flush/crash
// can recognize its own greeting without another save-format field or event.
export function nativeOpeningMessageId(chatId) {
  return 'tavern-opening:' + createHash('sha256').update(chatId == null ? '' : String(chatId)).digest('hex')
}
