/** Salvage only persisted narrative; never consult the damaged native Session. */
export function rescueHistoryInput(source) {
  if (!source || !['story', 'script'].includes(source.mode || 'story')) throw new Error('只能救援已有游玩存档')
  if (!source.cardPath) throw new Error('旧存档没有关联人物卡，无法迁移')
  const rows = (source.messages || []).filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.text === 'string' && m.text.trim())
  if (!rows.length) throw new Error('旧存档中没有可迁移的剧情文字')
  const object = value => value && typeof value === 'object' && !Array.isArray(value)
  let snapshot, snapshotIndex = -1
  for (let index = 0; index < rows.length; index++) {
    const message = rows[index], swipe = message.swipeId ?? 0
    const value = Number.isSafeInteger(swipe) && swipe >= 0 && Array.isArray(message.variables) ? message.variables[swipe] : undefined
    if (object(value) && object(value.stat_data) && object(value.schema)) { snapshot = structuredClone(value); snapshotIndex = index }
  }
  if (source.mvu?.enabled && !snapshot) throw new Error('旧档没有包含 stat_data 和 schema 的可用 MVU 快照，无法携带状态救援；原存档未修改')
  const snapshotTarget = Math.max(0, rows.findLastIndex(m => m.role === 'assistant'))
  const mvuSnapshot = snapshot ? {
    sourceMessageIndex: snapshotIndex, sourceTurn: Number(rows[snapshotIndex].turn) || null,
    laterAssistantMessages: rows.slice(snapshotIndex + 1).filter(m => m.role === 'assistant').length
  } : null
  return {
    cardPath: source.cardPath, userName: source.macroState?.userName || '你',
    fileName: (source.title || source.cardName || '旧对话') + ' · 存档救援',
    textOnly: !snapshot, rescue: { sourceChatId: source.id, sourceRevision: source._storageRevision || 0, mvuSnapshot },
    text: [JSON.stringify({ user_name: source.macroState?.userName || '你', chat_metadata: {} }),
      ...rows.map((m, index) => JSON.stringify({ is_user: m.role === 'user', mes: m.text, ...(snapshot && index === snapshotTarget ? { variables: [snapshot] } : {}) }))].join('\n')
  }
}
export function isRescuedHistoryMessage(chat, message) {
  return Boolean(chat.importHistory?.rescue && message?.importSource?.operationId === chat.importHistory.operationId)
}
export function assertRescueHistoryEditable(chat) {
  if (isRescuedHistoryMessage(chat, (chat.messages || []).findLast(m => m.role === 'assistant'))) {
    throw new Error('存档救援导入的历史仅供接续剧情，不能回退或重新生成；请发送新消息继续')
  }
}

export function rescueHistoryNotice(rescue) {
  const snapshot = rescue.mvuSnapshot
  const state = snapshot
    ? '已携带最后可用 MVU 快照（' + (snapshot.sourceTurn ? '旧第 ' + snapshot.sourceTurn + ' 轮' : '旧第 ' + (snapshot.sourceMessageIndex + 1) + ' 条消息') + '），继续更新状态。' + (snapshot.laterAssistantMessages ? '快照之后还有 ' + snapshot.laterAssistantMessages + ' 条正文，数值可能滞后，请先核对。' : '')
    : '未携带 MVU 状态。'
  return '存档救援：' + state + '按故事模式接续，不恢复旧剧本进度；导入历史不能回退或重新生成。'
}
