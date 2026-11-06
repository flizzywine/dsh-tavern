export function settledTurn(chat, before, input) {
  if (!chat) return { ready: false }
  const additions = (chat.messages || []).slice(before)
  const userIndex = additions.findIndex(message => message.role === 'user')
  if (userIndex < 0) return { ready: false }
  if (additions[userIndex].text !== input) return { ready: false, error: '落盘玩家输入与脚本不一致' }
  const reply = additions.slice(userIndex + 1).find(message => message.role === 'assistant' && !message.greeting)
  if (!reply) return { ready: false }
  if (['error', 'failed'].includes(chat.settleStatus)) return { ready: false, error: chat.settleError || '后台结算失败', reply }
  if (reply.mvu?.receipt?.failures?.length) return { ready: false, error: 'MVU 结算回执包含失败项', reply }
  return { ready: chat.settleStatus === 'done' && !reply.mvu?.pending, reply }
}

