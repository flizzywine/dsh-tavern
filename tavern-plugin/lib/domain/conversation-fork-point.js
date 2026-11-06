import { isRescuedHistoryMessage } from './chat-history-rescue.js'
import { assistantResultForTurn } from './session-turn-result.js'
import { sessionEvents } from './session-events.js'
import { assertConversationForkable } from './conversation-fork.js'

const turnOf = message => Number(message?.turn || (message?.greeting ? 1 : 0))
const lastAssistant = chat => (chat.messages || []).findLast(message => message?.role === 'assistant')

// Checkpoints are bounded in each Chat, but their beforeRevision links retain
// access to older journal states. Follow those links, including parent branches.
export async function conversationStateAtTurn(source, requestedTurn, readRevision) {
  const turn = requestedTurn === undefined || requestedTurn === 0 ? turnOf(lastAssistant(source)) : Number(requestedTurn)
  const targetIndex = (source.messages || []).findIndex(message => message?.role === 'assistant' && turnOf(message) === turn)
  if (!Number.isSafeInteger(turn) || turn < 1 || targetIndex < 0) throw new Error('找不到指定分叉回合')
  if (isRescuedHistoryMessage(source, source.messages[targetIndex])) throw new Error('存档救援导入的历史没有状态快照，不能从该回合分叉')
  let state = source
  const visited = new Set()
  while (turnOf(lastAssistant(state)) !== turn) {
    const identity = state.id + ':' + state._storageRevision
    if (visited.has(identity)) throw new Error('历史快照链重复，无法安全分叉')
    visited.add(identity)
    const next = (state.timeline?.checkpoints || []).find(item => Number(item.turn) > turn && Number.isSafeInteger(item.beforeRevision))
    const parent = state.forkedFrom
    const chatId = next ? state.id : parent?.stateChatId || parent?.chatId
    const revision = next ? next.beforeRevision : parent?.stateRevision ?? parent?.storageRevision
    if (!chatId || !Number.isSafeInteger(revision)) throw new Error('该回合缺少完整历史状态快照，无法安全分叉')
    try { state = await readRevision(chatId, revision) } catch (error) {
      if (error?.code === 'DSH_TAVERN_REVISION_NOT_FOUND') throw new Error('该回合太早，历史状态已清理（只保留最近 50 轮），无法从这一轮分叉')
      throw error
    }
    if (!state || state._storageRevision !== revision) throw new Error('该回合历史状态快照不可用，无法安全分叉')
  }
  const prefix = source.messages.slice(0, targetIndex + 1)
  if (state.messages.length !== prefix.length || prefix.some((message, index) => {
    const old = state.messages[index]
    return message.role !== old.role || turnOf(message) !== turnOf(old) || (message.sourceText ?? message.text) !== (old.sourceText ?? old.text)
  })) throw new Error('历史快照与当前分支正文不一致，无法安全分叉')
  assertConversationForkable(state, { historical: state !== source })
  return { turn, state }
}

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
