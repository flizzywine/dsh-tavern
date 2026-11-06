// The latest 精修 of a game, for the 精修对比 page. One record per game in the per-game data store,
// overwritten by the next 精修. It names the text version it produced: once an undo, a later edit
// or a regeneration shows another version, the page has nothing to compare and nothing to undo.

export const POLISH_DATA_OWNER = 'dsh-tavern.polish'

function str(value) { return typeof value === 'string' ? value : value == null ? '' : String(value) }

/**
 * The original split into unchanged runs and the applied edits, in reading order.
 * Both columns of the page come from this: an edit shows `find` on the left, `replace` on the right.
 */
export function polishSegments(original, edits) {
  const text = str(original)
  const placed = []
  ;(Array.isArray(edits) ? edits : []).forEach((edit, index) => {
    const find = str(edit?.find), at = find ? text.indexOf(find) : -1
    if (at < 0 || placed.some(item => item.at < at + find.length && at < item.at + item.find.length)) return
    placed.push({ at, find, replace: str(edit.replace), reason: str(edit.reason), n: index + 1 })
  })
  placed.sort((left, right) => left.at - right.at)
  const segments = []
  let cursor = 0
  for (const item of placed) {
    if (item.at > cursor) segments.push({ kind: 'same', text: text.slice(cursor, item.at) })
    segments.push({ kind: 'edit', n: item.n, find: item.find, replace: item.replace, reason: item.reason })
    cursor = item.at + item.find.length
  }
  if (cursor < text.length) segments.push({ kind: 'same', text: text.slice(cursor) })
  return segments
}

export function createPolishRecords({ data, turns, now = Date.now }) {
  /** Keep this 精修 of `turn` as the game's latest, keyed to the text version it produced. */
  // `auto`: written by 自动精修 rather than the 精修 button.
  async function save(sessionId, turn, { original, edits, seconds, auto = false }) {
    const game = await turns.resolveGame(sessionId)
    if (!game) return false
    const key = await turns.currentKey(game.sessionId, turn)
    if (!key) return false
    const kept = edits.map(edit => ({ reason: str(edit.reason), find: str(edit.find), replace: str(edit.replace) }))
    // `original` is the reply's text parts (around its HTML blocks), what an undo writes back.
    await data.saveGame({ chatId: game.chatId, owner: POLISH_DATA_OWNER, data: { version: 2, turn, key, original: original.map(str), edits: kept, seconds: Number(seconds) || 0, at: now(), ...(auto ? { auto: true } : {}) } })
    return true
  }

  /** The latest 精修 record while its turn still shows the text it produced; null otherwise. */
  async function current(sessionId) {
    const game = await turns.resolveGame(sessionId)
    if (!game) return null
    const record = await data.readGame({ chatId: game.chatId, owner: POLISH_DATA_OWNER })
    if (record?.version !== 2 || !Array.isArray(record.original) || await turns.currentKey(game.sessionId, record.turn) !== record.key) return null
    return record
  }

  /** What the 精修对比 page shows; null when there is nothing to compare. */
  async function latest(sessionId) {
    const record = await current(sessionId)
    return record && { turn: record.turn, at: record.at, seconds: record.seconds, count: record.edits.length, auto: record.auto === true, segments: polishSegments(record.original.join('\n\n'), record.edits) }
  }

  return Object.freeze({ save, current, latest })
}
