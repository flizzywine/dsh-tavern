import { createHash } from 'node:crypto'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function playMode(chat) {
  const mode = str(chat && chat.mode) || 'story'
  return mode === 'story' || mode === 'script'
}

function assistantTurn(message, fallback) {
  return Math.max(0, Number(message && message.turn) || (message && message.greeting === true ? 1 : fallback))
}

function latestAssistantTurn(chat) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  let inferred = 1
  let latest = 0
  for (const message of messages) {
    if (message && message.role === 'user') inferred += 1
    if (!message || message.role !== 'assistant') continue
    latest = Math.max(latest, assistantTurn(message, inferred))
  }
  return latest
}

function messageForTurn(chat, requestedTurn) {
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  let inferred = 1
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message && message.role === 'user') inferred += 1
    if (!message || message.role !== 'assistant') continue
    if (assistantTurn(message, inferred) !== requestedTurn) continue
    let userText = ''
    for (let previous = index - 1; previous >= 0; previous -= 1) {
      const candidate = messages[previous]
      if (candidate && candidate.role === 'user') { userText = str(candidate.text); break }
      if (candidate && candidate.role === 'assistant') break
    }
    return { message, userText }
  }
  return null
}

function snapshotDigest(chat) {
  const snapshot = str(chat && chat.cardContextSnapshot)
  return snapshot === '' ? '' : createHash('sha256').update(snapshot).digest('hex').slice(0, 16)
}

function referencePath(chatId) {
  return 'play-chat:' + str(chatId)
}

export function createPlayChatDebugReference(editorChat, sourceChat, requestedTurn) {
  if (!editorChat || str(editorChat.mode) !== 'card') throw new Error('游玩记录只能挂载到卡片工作台')
  if (!sourceChat || !playMode(sourceChat)) throw new Error('只能引用游玩模式对话')
  if (str(editorChat.cardPath) === '' || str(editorChat.cardPath) !== str(sourceChat.cardPath)) throw new Error('游玩记录与当前人物卡不一致')
  const turn = Math.max(1, Number(requestedTurn) || latestAssistantTurn(sourceChat))
  if (messageForTurn(sourceChat, turn) === null) throw new Error('游玩记录中不存在第 ' + turn + ' 轮回复')
  return {
    kind: 'play-chat',
    path: referencePath(sourceChat.id),
    label: (str(sourceChat.cardName) || '人物卡') + ' · 游玩第 ' + turn + ' 轮',
    chatId: str(sourceChat.id),
    turn,
    sourceUpdatedAt: Number(sourceChat.updatedAt || sourceChat.createdAt) || 0,
    cardSnapshotVersion: Math.max(0, Number(sourceChat.cardContextSnapshotVersion) || 0),
    cardSnapshotDigest: snapshotDigest(sourceChat)
  }
}

export function readPlayChatDebugTurn(editorChat, sourceChat, reference, request = {}, currentProjection = null) {
  if (!editorChat || str(editorChat.mode) !== 'card') throw new Error('游玩记录只能在卡片工作台中读取')
  if (!sourceChat || !playMode(sourceChat)) throw new Error('游玩记录不存在或不是游玩对话')
  if (!reference || reference.kind !== 'play-chat' || str(reference.chatId) !== str(sourceChat.id)) throw new Error('该游玩记录尚未挂载到当前对话')
  if (str(editorChat.cardPath) !== str(sourceChat.cardPath)) throw new Error('游玩记录与当前人物卡不一致')

  const turn = Math.max(1, Number(request.turn) || Number(reference.turn) || latestAssistantTurn(sourceChat))
  const found = messageForTurn(sourceChat, turn)
  if (found === null) throw new Error('游玩记录中不存在第 ' + turn + ' 轮回复')
  const message = found.message
  const layer = ['overview', 'source', 'session', 'display', 'diagnostics'].includes(request.layer) ? request.layer : 'overview'
  let text = ''
  if (layer === 'source') text = str(message.sourceText) || str(message.text)
  else if (layer === 'session') text = str(message.text)
  else if (layer === 'display') text = str(message.displayText) || str(message.text)
  else if (layer === 'diagnostics') {
    const projected = typeof currentProjection === 'function' ? currentProjection(message) : currentProjection
    const applied = projected && projected.applied ? projected.applied : { session: [], display: [] }
    const warnings = projected && Array.isArray(projected.warnings) ? projected.warnings : []
    text = [
      '【当前人物卡正则重新检测】',
      'Session 命中：' + JSON.stringify(applied.session || []),
      '展示命中：' + JSON.stringify(applied.display || []),
      '警告：' + JSON.stringify(warnings),
      '说明：命中结果按当前人物卡重新计算；历史显示文本仍来自该轮保存的数据。'
    ].join('\n')
  } else {
    text = [
      '玩家输入：\n' + (found.userText || '（开场轮，无玩家输入）'),
      '模型原文：' + (str(message.sourceText) || str(message.text)).length + ' 字',
      'Session 文本：' + str(message.text).length + ' 字',
      '展示文本：' + (str(message.displayText) || str(message.text)).length + ' 字',
      '历史警告：' + JSON.stringify(Array.isArray(message.projectionWarnings) ? message.projectionWarnings : [])
    ].join('\n\n')
  }

  const offset = Number.isInteger(request.offset) && request.offset > 0 ? request.offset : 1
  const limit = Number.isInteger(request.limit) ? Math.max(1, Math.min(request.limit, 12000)) : 6000
  const start = Math.min(offset - 1, text.length)
  const chunk = text.slice(start, start + limit)
  return {
    ref: referencePath(sourceChat.id),
    chatId: str(sourceChat.id),
    turn,
    layer,
    text: chunk,
    totalChars: text.length,
    from: chunk.length > 0 ? start + 1 : 0,
    to: chunk.length > 0 ? start + chunk.length : 0,
    done: start + chunk.length >= text.length,
    cardSnapshotVersion: Math.max(0, Number(reference.cardSnapshotVersion) || 0),
    cardSnapshotDigest: str(reference.cardSnapshotDigest)
  }
}
