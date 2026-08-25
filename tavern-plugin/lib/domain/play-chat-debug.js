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

function availableTurns(chat) {
  const turns = []
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  let inferred = 1
  for (const message of messages) {
    if (message && message.role === 'user') inferred += 1
    if (!message || message.role !== 'assistant') continue
    const turn = assistantTurn(message, inferred)
    if (!turns.includes(turn)) turns.push(turn)
  }
  return turns.sort(function (a, b) { return a - b })
}

function safeValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value.length > 12000 ? value.slice(0, 12000) + '…[已截断]' : value
  if (typeof value !== 'object') return str(value)
  if (depth >= 6) return '[深度已截断]'
  if (seen.has(value)) return '[循环引用]'
  seen.add(value)
  if (Array.isArray(value)) return value.map(function (item) { return safeValue(item, depth + 1, seen) })
  const result = {}
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    if (/authorization|cookie|api[-_]?key|secret|password|access[-_]?token/i.test(key)) result[key] = '[已隐藏]'
    else result[key] = safeValue(item, depth + 1, seen)
  }
  return result
}

function json(value) {
  try { return JSON.stringify(safeValue(value), null, 2) } catch { return str(value) }
}

function conversationText(chat) {
  const lines = ['【整场游玩对话 · Session 层】']
  const messages = Array.isArray(chat && chat.messages) ? chat.messages : []
  for (const message of messages) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue
    const label = message.role === 'user' ? '玩家' : ('模型（第 ' + assistantTurn(message, 1) + ' 轮）')
    lines.push(label + '：' + str(message.text))
  }
  return lines.join('\n\n')
}

function agentEvidence(value, label) {
  if (!value || value.loaded !== true) return '【' + label + ' Agent Session log】\nSession：' + str(value && value.sessionId) + '\n当前 DSH 运行时未加载该 Session，无法读取原生事件；Tavern 持久记录仍可从 tavern 层读取。'
  return '【' + label + ' Agent Session log】\nSession：' + str(value.sessionId) + '\n\n' + json(value.events || [])
}

export function createPlayChatDebugReference(editorChat, sourceChat, requestedTurn) {
  if (!editorChat || str(editorChat.mode) !== 'card') throw new Error('游玩记录只能挂载到卡片工作台')
  if (!sourceChat || !playMode(sourceChat)) throw new Error('只能引用游玩模式对话')
  if (str(editorChat.cardPath) === '' || str(editorChat.cardPath) !== str(sourceChat.cardPath)) throw new Error('游玩记录与当前人物卡不一致')
  const turn = latestAssistantTurn(sourceChat)
  if (turn < 1) throw new Error('游玩记录还没有可调试的模型回复')
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

export function readPlayChatDebugTurn(editorChat, sourceChat, reference, request = {}, currentProjection = null, evidence = {}) {
  if (!editorChat || str(editorChat.mode) !== 'card') throw new Error('游玩记录只能在卡片工作台中读取')
  if (!sourceChat || !playMode(sourceChat)) throw new Error('游玩记录不存在或不是游玩对话')
  if (!reference || reference.kind !== 'play-chat' || str(reference.chatId) !== str(sourceChat.id)) throw new Error('该游玩记录尚未挂载到当前对话')
  if (str(editorChat.cardPath) !== str(sourceChat.cardPath)) throw new Error('游玩记录与当前人物卡不一致')

  const turn = Math.max(1, Number(request.turn) || Number(reference.turn) || latestAssistantTurn(sourceChat))
  const found = messageForTurn(sourceChat, turn)
  if (found === null) throw new Error('游玩记录中不存在第 ' + turn + ' 轮回复')
  const message = found.message
  const layers = ['overview', 'turns', 'conversation', 'input', 'source', 'session', 'display', 'saved-display', 'diagnostics', 'tavern', 'foreground', 'background', 'iframe']
  const layer = layers.includes(request.layer) ? request.layer : 'overview'
  const projected = typeof currentProjection === 'function' ? currentProjection(message) : currentProjection
  let text = ''
  if (layer === 'turns') text = '【可用游玩轮次】\n' + availableTurns(sourceChat).map(function (item) { return '第 ' + item + ' 轮' }).join('\n')
  else if (layer === 'conversation') text = conversationText(sourceChat)
  else if (layer === 'input') text = found.userText || '（开场轮，无玩家输入）'
  else if (layer === 'source') text = str(message.sourceText) || str(message.text)
  else if (layer === 'session') text = str(message.text)
  else if (layer === 'display') text = projected && Object.prototype.hasOwnProperty.call(projected, 'displayText') ? str(projected.displayText) : (str(message.displayText) || str(message.text))
  else if (layer === 'saved-display') text = str(message.displayText) || str(message.text)
  else if (layer === 'iframe') text = '【iframe 实际运行证据 · 第 ' + turn + ' 轮】\n' + json(message.displayRuntime || { status: '该轮尚无采集记录' })
  else if (layer === 'foreground') text = agentEvidence(evidence.foreground, '前台')
  else if (layer === 'background') text = agentEvidence(evidence.background, '后台')
  else if (layer === 'tavern') {
    text = '【Tavern 持久运行状态】\n' + json({
      chatId: sourceChat.id, mode: sourceChat.mode, sessionId: sourceChat.sessionId,
      settleStatus: sourceChat.settleStatus, settleError: sourceChat.settleError,
      lastSettle: sourceChat.lastSettle, candidates: sourceChat.candidates,
      preparedWorldBook: sourceChat.preparedWorldBook, preparedWorldBookContext: sourceChat.preparedWorldBookContext,
      nativeCommits: sourceChat.nativeCommits, runtimeInputs: sourceChat.runtimeInputs,
      taskMailbox: sourceChat.taskMailbox, timeline: sourceChat.timeline
    })
  }
  else if (layer === 'diagnostics') {
    const applied = projected && projected.applied ? projected.applied : { session: [], display: [] }
    const warnings = projected && Array.isArray(projected.warnings) ? projected.warnings : []
    text = [
      '【当前人物卡正则重新检测】',
      'Session 命中：' + JSON.stringify(applied.session || []),
      '展示命中：' + JSON.stringify(applied.display || []),
      '警告：' + JSON.stringify(warnings),
      '说明：命中结果按当前人物卡重新计算；display 是当前实时投影，saved-display 是该轮保存时的展示快照。'
    ].join('\n')
  } else {
    text = [
      '【最新一轮游玩诊断】第 ' + turn + ' 轮',
      '可按需读取：turns / conversation / input / source / session / display / saved-display / diagnostics / tavern / foreground / background / iframe',
      '模型原文：' + (str(message.sourceText) || str(message.text)).length + ' 字',
      'Session 文本：' + str(message.text).length + ' 字',
      '已保存展示文本：' + (str(message.displayText) || str(message.text)).length + ' 字',
      '展示警告数：' + (Array.isArray(message.projectionWarnings) ? message.projectionWarnings.length : 0),
      '最新一轮只是默认入口，不是读取边界。请只读取判断当前问题所需的层，不要一次展开全部内容。'
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
