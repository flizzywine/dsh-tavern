import { isDeepStrictEqual } from 'node:util'

const LIMIT = 6000
// Long generated text (diaries, chat logs) only needs to be recognizable here.
const VALUE_LIMIT = 100
const escapeKey = key => key.replace(/~/g, '~0').replace(/\//g, '~1')
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function statDataOf(message) {
  const value = message?.variables?.[Math.max(0, Number(message.swipeId) || 0)]?.stat_data
  return isObject(value) ? value : null
}

// Objects are walked; a list or scalar is one variable, reported with its whole latest value.
function changedPaths(before, after, path = '', out = []) {
  // A key only in before was deleted this round; it is reported, not skipped.
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after)])) {
    if (key.startsWith('$') || key.startsWith('__')) continue
    const next = after[key], previous = before?.[key], pointer = path + '/' + escapeKey(key)
    if (isObject(next) && isObject(previous)) changedPaths(previous, next, pointer, out)
    else if (!isDeepStrictEqual(previous, next)) out.push([pointer, next])
  }
  return out
}

/**
 * The foreground writes without the variable state; settlement updates it afterwards.
 * Before the next reply, hand back only what the last round changed, latest values.
 */
export function lastRoundVariableChanges(chat) {
  const messages = chat?.messages
  if (!messages || !['story', 'script'].includes(chat.mode || 'story') || chat.mvu?.enabled !== true) return null
  let latest = -1, previous = -1
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'assistant' || !statDataOf(message)) continue
    if (latest < 0) latest = index
    else { previous = index; break }
  }
  if (latest < 0 || previous < 0) return null
  const changes = changedPaths(statDataOf(messages[previous]), statDataOf(messages[latest]))
  if (!changes.length) return null
  const lines = []
  let size = 0, omitted = 0
  for (const [path, value] of changes) {
    const text = value === undefined ? '（已删除）' : JSON.stringify(value)
    const chars = Array.from(text)
    const line = path + ' = ' + (chars.length > VALUE_LIMIT ? chars.slice(0, VALUE_LIMIT).join('') + '…（已截断）' : text)
    if (size + line.length > LIMIT) { omitted++; continue }
    size += line.length
    lines.push(line)
  }
  return ['【上一轮变量变化】上一轮结算后发生变化的变量及最新值（路径相对于 stat_data），其余变量未变。写本轮正文时以此为准。',
    ...lines, ...(omitted ? ['…另有 ' + omitted + ' 项变化未列出，可用 tavern_read_variables 查询'] : [])].join('\n')
}
