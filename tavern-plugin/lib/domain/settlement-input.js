import {createScopedMessages} from './scoped-messages.js'
import {scannedStoryRows} from './bounded-history.js'

// This projection is internal and must never be passed to full-Chat writes.
// Settlement reads the pending floor, the helper rows back to the previous
// reply, the latest two story rows and, when the next turn's world-book recall
// is stale, every floor its deepest entry scans. A window holding all of that
// replaces the complete Chat; anything else keeps the complete read.
//
// A game without official MVU variables has no pending floor to settle and no
// receipt to write: its settlement reads the last reply and the row before it.
// Asking for the complete Chat there made every plain settlement of a long save
// read the whole history to produce one posture.
export async function readSettlementInput(chatId, {readWindow, readChat, scanDepth}) {
  const window = await readWindow(chatId, {limit:200})
  const chat = window?.chat
  const timeline = chat?.timeline
  const rows = chat?.messages
  if (!window || !Number.isSafeInteger(window.revision) || chat._storageRevision !== window.revision
    || chat.backgroundConfigVersion !== 1 || chat.conversationFeaturesVersion !== 1
    || timeline?.schemaVersion !== 1 || !Array.isArray(timeline.checkpoints)
    || Object.values(timeline.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed')) return readChat(chatId)
  const scoped = () => ({...chat, messages:createScopedMessages(window.messageCount,rows.map((row,index)=>[window.from+index,row]))})
  if (chat.mvu?.enabled !== true || chat.mvu.owner !== 'official') {
    return settlementTailReadable(rows, window) ? scoped() : readChat(chatId)
  }
  const target = rows.findLastIndex(row => row?.role === 'assistant' && row.mvu?.pending === true)
  const previous = target > 0 ? rows.slice(0,target).findLastIndex(row => row?.role === 'assistant') : -1
  if (target < 0 || (window.from > 0 && previous < 0)) return readChat(chatId)
  const prepared = chat.preparedWorldBook && Number(chat.preparedWorldBook.revision) === Number(timeline.revision)
  if (!prepared && window.from > 0) {
    // One extra row: the pending reply may be replaced by its latest body.
    const depth = typeof scanDepth === 'function' ? await scanDepth(chat) : Infinity
    if (!Number.isSafeInteger(depth) || !scannedStoryRows(rows, depth + 1)) return readChat(chatId)
  }
  return scoped()
}

// The plain settlement reads the last reply and the row before it. A window cut
// short of either one keeps the complete read.
function settlementTailReadable(rows, window) {
  if (!Array.isArray(rows) || rows.length === 0) return false
  if (window.from === 0) return true
  const lastReply = rows.findLastIndex(row => row?.role === 'assistant')
  if (lastReply < 0) return false
  return rows.slice(0, lastReply).some(row => row?.role === 'user' || row?.role === 'assistant')
}
