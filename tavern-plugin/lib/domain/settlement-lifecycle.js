function messages(chat) {
  return Array.isArray(chat && chat.messages) ? chat.messages : []
}

export function isOpeningAwaitingSettlement(chat) {
  if ((chat && chat.settleStatus || 'idle') !== 'idle') return false
  const source = messages(chat)
  return source.some(function (message) {
    return message && message.role === 'assistant' && message.greeting === true
  }) && !source.some(function (message) {
    return message && message.greeting !== true
  })
}

export function shouldStartSettlementAfterTurnEnd(chat, reason) {
  if (reason !== 'completed' && reason !== 'max-tokens') return false
  const mode = chat && chat.mode || 'story'
  if (mode !== 'story' && mode !== 'script') return false
  return (chat && chat.settleStatus || 'idle') === 'running'
}

export function createSettlementAfterTurnEndScheduler(options = {}) {
  const readChatForSession = options.readChatForSession
  const queueSettlement = options.queueSettlement
  const defer = typeof options.defer === 'function' ? options.defer : setImmediate
  const logger = options.logger || console
  if (typeof readChatForSession !== 'function' || typeof queueSettlement !== 'function') {
    throw new Error('缺少回合结束后的结算调度依赖')
  }
  return function schedule(input = {}) {
    const reason = input.reason || ''
    if (reason !== 'completed' && reason !== 'max-tokens') return false
    defer(function () {
      Promise.resolve().then(async function () {
        const chat = await readChatForSession(input.sessionId)
        if (!shouldStartSettlementAfterTurnEnd(chat, reason)) return
        await queueSettlement(chat.id)
      }).catch(function (error) {
        logger.error('dsh-tavern: 回合结束后启动后台结算失败', error && error.message || error)
      })
    })
    return true
  }
}
