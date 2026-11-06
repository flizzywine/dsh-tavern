import { isRescuedHistoryMessage } from './chat-history-rescue.js'
import { assistantResultForTurn } from './session-turn-result.js'
import { sessionEvents } from './session-events.js'
import { assertConversationForkable } from './conversation-fork.js'

const turnOf = message => Number(message?.turn || (message?.greeting ? 1 : 0))
const lastAssistant = chat => (chat.messages || []).findLast(message => message?.role === 'assistant')

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

function rowsOf(state) {
  return Array.isArray(state?.messages) ? state.messages : []
}

// A snapshot is usable only when it holds exactly the story prefix the chosen
// message ends: same absolute row count, same roles, same narrative text.
// Turn numbers are deliberately ignored here: duplicated, missing or out-of-order
// turns are a projection detail, not the identity of a Chat state.
function holdsStoryPrefix(state, sourceMessages, messageIndex) {
  const rows = rowsOf(state)
  if (rows.length !== messageIndex + 1) return false
  for (let index = 0; index <= messageIndex; index++) {
    const old = rows[index]
    const now = sourceMessages[index]
    if (!old || !now || old.role !== now.role) return false
    if ((old.sourceText ?? old.text) !== (now.sourceText ?? now.text)) return false
  }
  return true
}

// Revisions reachable from a Chat: its own bounded checkpoints, then the parent
// branch it was forked from. The caller walks the queue until one snapshot holds the
// requested prefix, harvesting deeper snapshots from every state it manages to read.
function harvestSnapshots(state, queue, claimed) {
  if (!state || typeof state !== 'object') return
  const identity = str(state.id) + ':' + str(state._storageRevision)
  if (claimed.has(identity)) return
  claimed.add(identity)
  const push = (chatId, revision) => {
    if (!chatId || !Number.isSafeInteger(revision) || revision < 0) return
    const key = chatId + '\u0000' + revision
    if (claimed.has(key)) return
    claimed.add(key)
    queue.push({ chatId, revision })
  }
  const checkpoints = Array.isArray(state.timeline?.checkpoints) ? state.timeline.checkpoints : []
  for (const checkpoint of checkpoints) push(str(state.id), Number(checkpoint?.beforeRevision))
  const parent = state.forkedFrom
  push(str(parent?.stateChatId || parent?.chatId), Number(parent?.stateRevision ?? parent?.storageRevision))
}

/**
 * Resolve the Chat state that a story message ends at, addressed by absolute message
 * index. The chosen snapshot's messages are the source prefix `[0..messageIndex]`; no
 * turn is consulted to find it. A request on the live head resolves to the source itself.
 * @returns `{ messageIndex, state, turn }` — `turn` is informational, for legacy receipts.
 */
export async function conversationStateAtMessage(source, messageIndex, readRevision) {
  if (!source) throw new Error('找不到要分叉的对话')
  const messages = Array.isArray(source.messages) ? source.messages : []
  const index = Number(messageIndex)
  if (!Number.isSafeInteger(index) || index < 0 || index >= messages.length) throw new Error('找不到指定分叉消息')
  const message = messages[index]
  if (message?.role !== 'assistant') throw new Error('分叉点必须是正文消息')
  if (isRescuedHistoryMessage(source, message)) throw new Error('存档救援导入的历史没有状态快照，不能从这条消息分叉')
  if (messages.length === index + 1) {
    assertConversationForkable(source)
    return { messageIndex: index, state: source, turn: turnOf(lastAssistant(source)) }
  }
  const queue = []
  harvestSnapshots(source, queue, new Set())
  const visited = new Set()
  let readable = false
  let stale = false
  while (queue.length) {
    const candidate = queue.shift()
    const key = candidate.chatId + '\u0000' + candidate.revision
    if (visited.has(key)) continue
    visited.add(key)
    let state
    try {
      state = await readRevision(candidate.chatId, candidate.revision)
    } catch (error) {
      if (error?.code === 'DSH_TAVERN_REVISION_NOT_FOUND') { stale = true; continue }
      throw error
    }
    if (!state || state._storageRevision !== candidate.revision) continue
    readable = true
    if (holdsStoryPrefix(state, messages, index)) {
      assertConversationForkable(state, { historical: true })
      return { messageIndex: index, state, turn: turnOf(lastAssistant(state)) }
    }
    // A later snapshot can still hold this prefix through its own parent chain.
    harvestSnapshots(state, queue, visited)
  }
  if (stale) throw new Error('这条消息的回合太早，历史状态已清理（只保留最近 50 轮），无法从这条消息分叉')
  if (readable) throw new Error('历史快照与当前分支正文不一致，无法安全分叉')
  throw new Error('这条消息的历史状态快照不可用，无法安全分叉')
}

// Legacy entry point: locate the story message by its turn, then select the state by
// absolute message index. The turn only picks the row; it never picks the state.
export async function conversationStateAtTurn(source, requestedTurn, readRevision) {
  const turn = requestedTurn === undefined || requestedTurn === 0 ? turnOf(lastAssistant(source)) : Number(requestedTurn)
  if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('找不到指定分叉回合')
  const messageIndex = (source.messages || []).findIndex(message => message?.role === 'assistant' && turnOf(message) === turn)
  if (messageIndex < 0) throw new Error('找不到指定分叉回合')
  const { state } = await conversationStateAtMessage(source, messageIndex, readRevision)
  return { turn, state }
}

// Native fork boundary: the host copies its event log up to one `turn/end`, so the
// downstream native fork still needs this. Story Chat state selection never reads it.
export function conversationForkBoundary(session, state, turn) {
  const events = sessionEvents(session)
  const nativeTurn = Number(state.regeneratedDshTurns?.[turn]) || turn
  const end = events.findLast(event => event.type === 'turn/end' && Number(event.data?.turn) === nativeTurn)
  if (!end || end.data?.reason?.kind !== 'completed') throw new Error('该回合缺少已完成的原生上下文边界')
  const result = assistantResultForTurn(session, turn)
  const following = events.find(event => event.type === 'turn/start' && event.seq > end.seq)
  if (!result || (following && result.event.seq >= following.seq)) throw new Error('该回合正文曾在后续上下文中修改，无法按旧边界安全分叉')
  return end.seq
}
