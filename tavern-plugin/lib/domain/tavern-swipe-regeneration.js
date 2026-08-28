function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function selectedSwipe(message) {
  const count = Math.max(Array.isArray(message && message.swipes) ? message.swipes.length : 0, 1)
  return Math.max(0, Math.min(count - 1, Number(message && message.swipeId) || 0))
}

/** Merge a regenerated DSH turn back into the original Tavern assistant message as a new selected swipe. */
export function mergeRegeneratedSwipe(input = {}) {
  const originalChat = clone(input.originalChat)
  const regeneratedChat = clone(input.regeneratedChat)
  const assistantIndex = Number(input.assistantIndex)
  if (!originalChat || !regeneratedChat || !Array.isArray(originalChat.messages) || !Array.isArray(regeneratedChat.messages)) throw new Error('重新生成缺少聊天状态')
  const originalAssistant = originalChat.messages[assistantIndex]
  const originalUser = originalChat.messages[assistantIndex - 1]
  const regeneratedAssistant = regeneratedChat.messages[regeneratedChat.messages.length - 1]
  if (!originalAssistant || originalAssistant.role !== 'assistant' || !originalUser || originalUser.role !== 'user') throw new Error('原正文不是玩家输入与助手回复组合')
  if (!regeneratedAssistant || regeneratedAssistant.role !== 'assistant') throw new Error('重新生成没有产生助手回复')

  const originalSwipes = Array.isArray(originalAssistant.swipes) && originalAssistant.swipes.length > 0
    ? clone(originalAssistant.swipes)
    : [str(originalAssistant.sourceText || originalAssistant.text)]
  const regeneratedSwipeId = selectedSwipe(regeneratedAssistant)
  const regeneratedSource = Array.isArray(regeneratedAssistant.swipes) && regeneratedAssistant.swipes[regeneratedSwipeId] !== undefined
    ? str(regeneratedAssistant.swipes[regeneratedSwipeId])
    : str(regeneratedAssistant.sourceText || regeneratedAssistant.text)
  const nextSwipeId = originalSwipes.length
  const mergedAssistant = Object.assign({}, clone(originalAssistant), clone(regeneratedAssistant), {
    turn: originalAssistant.turn,
    swipeId: nextSwipeId,
    swipes: originalSwipes.concat(regeneratedSource)
  })
  if (Array.isArray(originalAssistant.variables) || Array.isArray(regeneratedAssistant.variables)) {
    const variables = Array.isArray(originalAssistant.variables) ? clone(originalAssistant.variables) : originalSwipes.map(function () { return {} })
    while (variables.length < originalSwipes.length) variables.push({})
    variables.push(clone(Array.isArray(regeneratedAssistant.variables) ? regeneratedAssistant.variables[regeneratedSwipeId] || {} : {}))
    mergedAssistant.variables = variables
  }
  regeneratedChat.messages = originalChat.messages.slice(0, assistantIndex - 1).concat([clone(originalUser), mergedAssistant])
  return { chat: regeneratedChat, assistant: mergedAssistant, swipeId: nextSwipeId }
}
