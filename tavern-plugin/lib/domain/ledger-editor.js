import { applyLedgerDelta, readLedger } from './story-ledger.js'

export function createLedgerEditor({ chats, timeline, isBusy }) {
  return async function editLedger({ sessionId, expected, delta }) {
    const chat = await chats.forSession(sessionId)
    if (!chat || chat.mode === 'card') throw new Error('当前没有游玩对话')
    return chats.update(chat.id, current => {
      if (isBusy(current) || ['pending', 'running', 'waiting-runtime'].includes(current.settleStatus)) throw new Error('请等待当前生成和后台任务结束后修改台账')
      if (JSON.stringify(readLedger(current.ledger)) !== expected) throw new Error('台账已更新，请重新打开编辑')
      const turn = current.messages?.findLast(m => m?.role === 'assistant')?.turn || 0
      const ledger = applyLedgerDelta(current.ledger, delta, turn)
      return timeline.apply({ chat: current, intent: { kind: 'ledger.edit', ledger } }).chat
    }, { source: 'ledger.edit' })
  }
}
