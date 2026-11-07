import { legacyMessageUid } from './message-uid.js'

// Absolute-index projection of one story window. The page `chat.messages` holds
// the closed range [from, to] (to = end - 1, matching the native window reader,
// and an empty window is from 0 with to -1); the caller also passes
// full-history `summaries` (one {role, turn, greeting} per absolute index) so
// floor numbers and turn-key uniqueness stay identical when the same story is
// read page by page. Floors follow raw assistant array order: openings and
// greetings are not skipped, and every non-assistant row reads floorNo null.
// A page or summary set that cannot be aligned with the full history throws
// instead of projecting silently wrong floors.

const isPositiveTurn = turn => typeof turn === 'number' && Number.isInteger(turn) && turn > 0

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const describe = value => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  return `${String(value)} (${typeof value})`
}

function fail(message) {
  throw Object.assign(new Error(message), { code: 'STORY_TRANSCRIPT_INVALID' })
}

/**
 * Project story rows at their absolute positions.
 * @param window - {chat, from, to, messageCount, revision}; chat.messages is the
 *   current page and must hold exactly `to - from + 1` rows, i.e. the closed
 *   range [from, to]. `to` is `from - 1` for an empty page and at most
 *   `messageCount - 1`; a whole-history read is from 0 with to messageCount - 1.
 * @param summaries - full-history `{role, turn, greeting}` rows at the same
 *   absolute indices, length `messageCount`. Omitted only when from is 0 and
 *   the page itself covers the complete history.
 * @returns {source, revision, from, to, messageCount, floorCount, floorOffset, messages}
 *   where every message entry is `{absoluteIndex, key, legacyTurn, floorNo, messageUid, message}`
 *   and `message` is the original page object. `floorCount` is the assistant
 *   count of the full history, `floorOffset` the assistant count before `from`,
 *   and `floorNo` a 1-based assistant floor number (null for other roles);
 *   `key` is `turn:<n>` only for a positive integer turn unique across the full
 *   history, otherwise `index:<absoluteIndex>`; `legacyTurn` keeps a positive
 *   integer turn and is null otherwise.
 */
export function projectStoryTranscript(window, summaries) {
  if (!isRecord(window)) fail(`故事窗口无效：window 必须是对象，收到 ${describe(window)}`)
  const page = window.chat?.messages
  if (!Array.isArray(window.chat?.messages)) fail('故事窗口无效：window.chat.messages 必须是数组')
  const { from, to, messageCount, revision } = window
  if (!Number.isInteger(messageCount) || messageCount < 0) {
    fail(`故事窗口无效：messageCount 必须是 >= 0 的整数，收到 ${describe(messageCount)}`)
  }
  if (!Number.isInteger(from) || from < 0 || from > messageCount) {
    fail(`故事窗口无效：from 必须在 [0, ${messageCount}] 内，收到 ${String(from)}`)
  }
  // to is inclusive: from - 1 is an empty page, messageCount - 1 the last row.
  if (!Number.isInteger(to) || to < from - 1 || to > messageCount - 1) {
    fail(`故事窗口无效：to 必须在 [${from - 1}, ${messageCount - 1}] 内（闭区间），收到 ${String(to)}`)
  }
  if (page.length !== to - from + 1) {
    fail(`故事窗口不连续：chat.messages 有 ${page.length} 条，闭区间 [${from}, ${to}] 需要 ${to - from + 1} 条`)
  }
  if (summaries !== undefined && summaries !== null && !Array.isArray(summaries)) {
    fail(`故事窗口不连续：summaries 必须是全历史数组，收到 ${describe(summaries)}`)
  }
  let history = summaries
  if (history === undefined || history === null) {
    if (from !== 0 || page.length !== messageCount) {
      fail('故事窗口缺少全历史：未提供 summaries 时，页面必须在 from=0 覆盖 [0, messageCount) 的全部历史')
    }
    history = page
  }
  const label = history === page ? 'chat.messages' : 'summaries'
  if (history.length !== messageCount) {
    fail(`故事窗口不连续：${label} 有 ${history.length} 条，messageCount 为 ${messageCount}`)
  }

  // Assistant prefix counts drive both the absolute floor number of every row
  // and the full-history offset, without assuming turns are ordered.
  const assistantPrefix = new Array(messageCount + 1)
  assistantPrefix[0] = 0
  const turnCounts = new Map()
  for (let index = 0; index < messageCount; index++) {
    const entry = history[index]
    if (!isRecord(entry)) fail(`故事窗口不连续：${label}[${index}] 缺项（全历史应有 ${messageCount} 条）`)
    if (typeof entry.role !== 'string' || entry.role === '') {
      fail(`故事窗口不连续：${label}[${index}] 缺少 role`)
    }
    assistantPrefix[index + 1] = assistantPrefix[index] + (entry.role === 'assistant' ? 1 : 0)
    if (isPositiveTurn(entry.turn)) turnCounts.set(entry.turn, (turnCounts.get(entry.turn) ?? 0) + 1)
  }

  const messages = []
  for (let absoluteIndex = from; absoluteIndex <= to; absoluteIndex++) {
    const summary = history[absoluteIndex]
    const message = page[absoluteIndex - from]
    if (isRecord(message) && typeof message.role === 'string' && message.role !== summary.role) {
      throw new Error(
        `故事窗口不一致：${label}[${absoluteIndex}].role 为 ${summary.role}，`
        + `chat.messages 第 ${absoluteIndex - from} 条为 ${message.role}`
      )
    }
    if (isRecord(message) && message.turn !== undefined && message.turn !== null
      && summary.turn !== undefined && summary.turn !== null && message.turn !== summary.turn) {
      throw new Error(
        `故事窗口不一致：${label}[${absoluteIndex}].turn 为 ${String(summary.turn)}，`
        + `chat.messages 第 ${absoluteIndex - from} 条为 ${String(message.turn)}`
      )
    }
    const turn = isRecord(message) ? message.turn : summary.turn
    const legacyTurn = isPositiveTurn(turn) ? turn : null
    const key = legacyTurn !== null && turnCounts.get(turn) === 1 ? `turn:${turn}` : `index:${absoluteIndex}`
    messages.push({
      absoluteIndex,
      key,
      legacyTurn,
      floorNo: summary.role === 'assistant' ? assistantPrefix[absoluteIndex] + 1 : null,
      messageUid: legacyMessageUid(message, absoluteIndex),
      message
    })
  }

  return {
    source: 'story',
    revision,
    from,
    to,
    messageCount,
    floorCount: assistantPrefix[messageCount],
    floorOffset: assistantPrefix[from],
    messages
  }
}
