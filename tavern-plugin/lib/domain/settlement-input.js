import {createScopedMessages} from './scoped-messages.js'
import {scannedStoryRows} from './bounded-history.js'

const INITIAL_WINDOW = 8
const MAX_WINDOW = 200

// This projection is internal and must never be passed to full-Chat writes.
// Start with the recent tail; expand to the former 200-row window only when the
// previous reply or stale World Book scan needs more history. A window holding
// all required rows replaces the complete Chat; anything else keeps that read.
//
// A game without official MVU variables has no pending floor to settle and no
// receipt to write: its settlement reads the last reply and the row before it.
// Asking for the complete Chat there made every plain settlement of a long save
// read the whole history to produce one posture.
export async function readSettlementInput(chatId, {readWindow, readChat, scanDepth}) {
  let window = await readWindow(chatId, {limit:INITIAL_WINDOW})
  const valid = value => {
    const chat = value?.chat
    const timeline = chat?.timeline
    return Boolean(value && Number.isSafeInteger(value.revision) && chat._storageRevision === value.revision
      && chat.backgroundConfigVersion === 1 && chat.conversationFeaturesVersion === 1
      && timeline?.schemaVersion === 1 && Array.isArray(timeline.checkpoints)
      && !Object.values(timeline.operations || {}).some(op => op?.kind === 'body' && op.status === 'foreground-completed'))
  }
  if (!valid(window)) return readChat(chatId)
  let chat = window.chat
  let timeline = chat.timeline
  let rows = chat.messages
  let expanded = false
  const expand = async () => {
    if (expanded || window.from === 0) return true
    const next = await readWindow(chatId, {limit:MAX_WINDOW,revision:window.revision})
    if (!valid(next) || next.revision !== window.revision) return false
    window = next
    chat = window.chat
    timeline = chat.timeline
    rows = chat.messages
    expanded = true
    return true
  }
  const scoped = () => ({...chat, messages:createScopedMessages(window.messageCount,rows.map((row,index)=>[window.from+index,row]))})
  if (chat.mvu?.enabled !== true || chat.mvu.owner !== 'official') {
    if (!settlementTailReadable(rows, window) && !await expand()) return readChat(chatId)
    return settlementTailReadable(rows, window) ? scoped() : readChat(chatId)
  }
  const targetIndex = () => rows.findLastIndex(row => row?.role === 'assistant' && row.mvu?.pending === true)
  let target = targetIndex()
  let previous = target > 0 ? rows.slice(0,target).findLastIndex(row => row?.role === 'assistant') : -1
  if ((target < 0 || (window.from > 0 && previous < 0)) && await expand()) {
    target = targetIndex()
    previous = target > 0 ? rows.slice(0,target).findLastIndex(row => row?.role === 'assistant') : -1
  }
  if (target < 0 || (window.from > 0 && previous < 0)) return readChat(chatId)
  const prepared = chat.preparedWorldBook && Number(chat.preparedWorldBook.revision) === Number(timeline.revision)
  if (!prepared && window.from > 0) {
    // One extra row: the pending reply may be replaced by its latest body.
    const depth = typeof scanDepth === 'function' ? await scanDepth(chat) : Infinity
    if (!Number.isSafeInteger(depth)) return readChat(chatId)
    if (!scannedStoryRows(rows, depth + 1)) {
      if (!await expand() || !scannedStoryRows(rows, depth + 1)) return readChat(chatId)
    }
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
