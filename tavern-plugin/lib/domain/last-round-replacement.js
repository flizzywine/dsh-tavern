function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function selectedIndex(message) {
  const count = Math.max(Array.isArray(message && message.swipes) ? message.swipes.length : 0, 1)
  return Math.max(0, Math.min(count - 1, Number(message && message.swipeId) || 0))
}

function regenerationConflict(reason) {
  const error = new Error('重新生成期间正文已被另一项操作修改：' + reason)
  error.code = 'DSH_TAVERN_REGEN_CONFLICT'
  return error
}

export function assertRegenerationSourceCurrent(input = {}) {
  const originalChat = input.originalChat
  const currentChat = input.currentChat
  const assistantIndex = Number(input.assistantIndex)
  if (!originalChat || !currentChat || !Array.isArray(originalChat.messages) || !Array.isArray(currentChat.messages)) throw regenerationConflict('聊天状态不完整')
  const originalBranch = str(originalChat.timeline && originalChat.timeline.branchId)
  const currentBranch = str(currentChat.timeline && currentChat.timeline.branchId)
  if (originalBranch !== '' && currentBranch !== originalBranch) throw regenerationConflict('剧情分支已经切换')
  if (currentChat.messages.length !== originalChat.messages.length) throw regenerationConflict('对话轮次已经变化')
  const originalUser = originalChat.messages[assistantIndex - 1]
  const currentUser = currentChat.messages[assistantIndex - 1]
  const originalAssistant = originalChat.messages[assistantIndex]
  const currentAssistant = currentChat.messages[assistantIndex]
  if (!originalUser || !currentUser || originalUser.role !== 'user' || currentUser.role !== 'user' || str(currentUser.text) !== str(originalUser.text)) throw regenerationConflict('玩家输入已经变化')
  if (!originalAssistant || !currentAssistant || originalAssistant.role !== 'assistant' || currentAssistant.role !== 'assistant' || Number(currentAssistant.turn) !== Number(originalAssistant.turn)) throw regenerationConflict('正文楼层已经变化')
  if (str(currentAssistant.text) !== str(originalAssistant.text) || str(currentAssistant.sourceText) !== str(originalAssistant.sourceText)) throw regenerationConflict('正文内容已经变化')
  return currentChat
}

/** Replace one committed user/body pair without discarding any later story rows. */
export function replaceLastRound(input = {}) {
  const originalChat = clone(input.originalChat)
  const regeneratedChat = clone(input.regeneratedChat)
  const assistantIndex = Number(input.assistantIndex)
  if (!originalChat || !regeneratedChat || !Array.isArray(originalChat.messages) || !Array.isArray(regeneratedChat.messages)) throw new Error('重新生成缺少聊天状态')
  const originalAssistant = originalChat.messages[assistantIndex]
  const originalUser = originalChat.messages[assistantIndex - 1]
  // Candidate-first regeneration supplies the validated native/plugin candidate
  // directly. Legacy callers still pass it as the final synthetic story row.
  const regeneratedAssistant = input.replacement || regeneratedChat.messages[regeneratedChat.messages.length - 1]
  if (!originalAssistant || originalAssistant.role !== 'assistant' || !originalUser || originalUser.role !== 'user') throw new Error('原正文不是玩家输入与助手回复组合')
  if (!regeneratedAssistant || regeneratedAssistant.role !== 'assistant') throw new Error('重新生成没有产生助手回复')

  const selected = selectedIndex(regeneratedAssistant)
  const source = Array.isArray(regeneratedAssistant.swipes) && regeneratedAssistant.swipes[selected] !== undefined
    ? str(regeneratedAssistant.swipes[selected])
    : str(regeneratedAssistant.sourceText || regeneratedAssistant.text)
  const replacement = Object.assign({}, clone(originalAssistant), clone(regeneratedAssistant), {
    turn: originalAssistant.turn,
    swipeId: 0,
    swipes: [source]
  })
  delete replacement.bodyEdit
  // The synthetic turn has its own transient storage row. The adopted reply keeps
  // the original story message identity, including when its variables settle later.
  if (originalAssistant.messageUid) replacement.messageUid = originalAssistant.messageUid
  else delete replacement.messageUid
  // The regenerated body replaces the original reply in the native session, so
  // the round keeps the original reply's anchor, never the synthetic turn's.
  if (originalAssistant.nativeAnchor) replacement.nativeAnchor = clone(originalAssistant.nativeAnchor)
  else delete replacement.nativeAnchor
  if (Array.isArray(originalAssistant.variables) || Array.isArray(regeneratedAssistant.variables)) {
    replacement.variables = [clone(Array.isArray(regeneratedAssistant.variables) ? regeneratedAssistant.variables[selected] || {} : {})]
  }
  // Update the target pair in the full original array. Later user inputs and
  // completed rounds were never part of this generation and must survive it.
  regeneratedChat.messages = originalChat.messages.slice()
  regeneratedChat.messages[assistantIndex - 1] = clone(originalUser)
  regeneratedChat.messages[assistantIndex] = replacement
  return { chat: regeneratedChat, assistant: replacement }
}
