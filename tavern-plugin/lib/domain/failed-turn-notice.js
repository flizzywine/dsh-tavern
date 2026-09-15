// Foreground Turn 失败后，核心会把失败的输入带「本轮运行失败」前缀送回输入框，
// 玩家接着输入的正文会被拼在同一段文本里。这类文本既是消息内容，也决定了该轮的汇报。
//
// 已有的 `pendingFailedSurfaceTurns` 只从会话尾部向前扫（遇到非清理墓碑就停），
// 因此「失败之后又聊过几轮」的旧失败无法再被「清除未完成回复」识别；本模块提供
// 与轮次无关的清理：去掉消息里的失败前缀，并把对应轮次写进 chat.suppressedDshTurns
// （该字段由 foregroundSuppressedTurns / historyProjection 消费，行为与
//  round-history.js 的 rollback.interrupted 分支一致）。

export const FAILED_TURN_NOTICE_MARKER = '本轮运行失败'

function positiveTurns(list) {
  return (Array.isArray(list) ? list : [])
    .map(Number)
    .filter(turn => Number.isSafeInteger(turn) && turn > 0)
}

/** 命中失败前缀时返回去掉前缀后的文本；否则返回 null。 */
export function stripFailedNoticeText(text) {
  const value = String(text == null ? '' : text)
  if (!value.startsWith(FAILED_TURN_NOTICE_MARKER)) return null
  const cut = value.indexOf('\n')
  return (cut >= 0 ? value.slice(cut + 1) : '').replace(/^\s+/, '')
}

/** 就地去掉 messages 里的失败前缀，返回 { cleared, turns }（turns 为这些消息所属轮次）。 */
export function cleanFailedNoticeMessages(messages) {
  const turns = []
  let cleared = 0
  for (const message of (Array.isArray(messages) ? messages : [])) {
    const next = stripFailedNoticeText(message && message.text)
    if (next === null) continue
    message.text = next
    cleared += 1
    const turn = Number(message && message.turn)
    if (Number.isSafeInteger(turn) && turn > 0 && !turns.includes(turn)) turns.push(turn)
  }
  return { cleared, turns }
}

/** 从会话事件里找出携带失败前缀的轮次：inbox 注入与用户消息，映射到其后第一个带 turn 的事件。 */
export function failedNoticeEventTurns(events) {
  const list = Array.isArray(events) ? events : []
  const hits = []
  for (const event of list) {
    const data = event && event.data
    if (!event || !data) continue
    let text = ''
    if (event.type === 'agent/inbox/spliced') {
      for (const item of (Array.isArray(data.inserted) ? data.inserted : [])) {
        for (const block of (item && Array.isArray(item.content) ? item.content : [])) {
          if (block && block.type === 'text') text += String(block.text || '')
        }
      }
    } else if (event.type === 'user/message') {
      const source = data.source || {}
      if (source.kind === 'plugin' && source.plugin === 'dsh-tavern') continue
      const content = data.message && Array.isArray(data.message.content) ? data.message.content : null
      if (content) { for (const block of content) if (block && block.type === 'text') text += String(block.text || '') }
      else text = String(data.text || '')
    }
    if (text.startsWith(FAILED_TURN_NOTICE_MARKER) && Number.isSafeInteger(event.seq)) hits.push(Number(event.seq))
  }
  const turns = []
  for (const seq of hits) {
    for (const event of list) {
      if (!Number.isSafeInteger(event && event.seq) || Number(event.seq) <= seq) continue
      const turn = Number(event.data && event.data.turn)
      if (!Number.isSafeInteger(turn) || turn <= 0) continue
      if (!turns.includes(turn)) turns.push(turn)
      break
    }
  }
  return turns.sort((a, b) => a - b)
}

/**
 * 在 chat 草稿上应用清理。
 * options: { requested, remembered, replace, events }
 * 返回 { cleared, turns, suppressedDshTurns }；请求轮次与记忆轮次在 replace 时只保留 requested。
 */
export function applyFailedNoticeCleanup(chat, options = {}) {
  const replace = options.replace === true
  const requested = positiveTurns(options.requested)
  // 未显式传入时回落到 chat 上已记录的轮次，避免调用方漏传导致记忆被清零。
  const remembered = replace
    ? []
    : positiveTurns(options.remembered !== undefined ? options.remembered : (chat && chat.clearedFailedNoticeTurns))
  const turns = new Set(requested.concat(remembered))
  const { cleared, turns: messageTurns } = cleanFailedNoticeMessages(chat && chat.messages)
  for (const turn of messageTurns) turns.add(turn)
  for (const turn of failedNoticeEventTurns(options.events)) turns.add(turn)
  const recorded = [...turns].sort((a, b) => a - b)
  const base = replace ? requested : positiveTurns(chat && chat.suppressedDshTurns)
  const suppressedDshTurns = [...new Set(base.concat(recorded))].sort((a, b) => a - b)
  if (chat) {
    chat.clearedFailedNoticeTurns = recorded
    chat.suppressedDshTurns = suppressedDshTurns
  }
  return { cleared, turns: recorded, suppressedDshTurns }
}
