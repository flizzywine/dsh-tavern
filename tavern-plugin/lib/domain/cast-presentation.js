import { CAST_DATA_OWNER, carryCastLines, dialogueQuotes } from './cast-annotation.js'
import { dialogueBubbleLines } from './dialogue-bubbles.js'
import { parseBubbles } from '../../src/client/bubble-line.cjs'

/**
 * Who speaks each line of a turn (docs/design/cast-presentation.md). The story model writes its spoken lines as
 * dialogue bubbles, so a turn's lines are read from the text version shown; nothing is stored for them. A turn
 * written before that keeps the annotation settlement saved for it, bound to its text version; an edit of the reply
 * (the player's, 精修, a plugin's) carries that annotation over to the edited version.
 */
export function createCastPresentation({ enabled, turns, data, publish = () => {} }) {
  async function records(chatId, turn) {
    return data.turnsUpTo({ chatId, owner: CAST_DATA_OWNER, turn })
  }

  /** The lines of the shown text version of some turns; turns without any are left out. */
  async function forTurns(sessionId, wanted) {
    if (await enabled(sessionId) !== true) return { enabled: false, turns: {} }
    const game = await turns.resolveGame(sessionId)
    const list = [...new Set((Array.isArray(wanted) ? wanted : []).map(Number).filter(turn => Number.isSafeInteger(turn) && turn > 0))].slice(0, 100)
    if (!game || !list.length) return { enabled: true, turns: {} }
    const all = await records(game.chatId, Math.max(...list))
    const result = {}
    for (const turn of list) {
      const key = await turns.currentKey(game.sessionId, turn)
      if (!key) continue
      const candidates = all.filter(item => item.turn === turn)
      const record = candidates.find(item => item.key === key)
      const lines = record ? record.data?.lines : await shownLines(game, turn, key, candidates)
      if (Array.isArray(lines) && lines.length) result[turn] = lines
    }
    return { enabled: true, turns: result }
  }

  // The shown version's own bubbles; else, for a turn edited before edits carried their annotation (or by a path that
  // skips it), its lines rebuilt from the earlier version sharing the most quotes, when at least a third of the shown
  // quotes are word for word there (a regenerated text shares almost none).
  async function shownLines(game, turn, key, candidates) {
    const material = await turns.readTurn(game.sessionId, turn).catch(() => null)
    if (!material || material.key !== key) return null
    const bubbles = dialogueBubbleLines(parseBubbles(material.text))
    if (bubbles.length || !candidates.length) return bubbles
    const quotes = dialogueQuotes(material.text)
    if (!quotes.length) return null
    let source = null, shared = 0
    for (const item of candidates) {
      const lines = Array.isArray(item.data?.lines) ? item.data.lines : []
      const count = new Set(lines.filter(line => quotes.includes(line.quote)).map(line => line.quote)).size
      if (count > shared) { source = lines; shared = count }
    }
    if (!source || shared * 3 < quotes.length) return null
    // The old quote count is known when every quote was annotated.
    const highest = Math.max(...source.map(line => line.n))
    const lines = carryCastLines(source, source.length === highest ? highest : -1, quotes)
    if (!lines.length) return null
    await data.saveTurn({ chatId: game.chatId, owner: CAST_DATA_OWNER, turn, key, data: { version: 1, lines } }).catch(() => {})
    return lines
  }

  /** One turn's lines for the text version shown now, whether or not 对话气泡 is on. */
  async function annotation(sessionId, turn) {
    const game = await turns.resolveGame(sessionId)
    const key = game && await turns.currentKey(game.sessionId, turn)
    if (!key) return null
    const record = (await records(game.chatId, turn)).find(item => item.turn === turn && item.key === key)
    let lines = record?.data?.lines
    if (!record) {
      const material = await turns.readTurn(game.sessionId, turn).catch(() => null)
      lines = material && material.key === key ? dialogueBubbleLines(parseBubbles(material.text)) : null
    }
    return Array.isArray(lines) && lines.length ? { turn, textVersion: key, lines: structuredClone(lines) } : null
  }

  /** A reply was committed: its lines came with its text, so tell the chat and plugins they are there. */
  async function announce(sessionId) {
    const material = await turns.readTurn(sessionId)
    const lines = material && !material.greeting ? dialogueBubbleLines(parseBubbles(material.text)) : []
    if (lines.length) publish(material.sessionId || sessionId, { turn: material.turn, textVersion: material.key, lines })
  }

  /**
   * Before an edit of the latest reply: read the shown version's annotation; the returned function,
   * called once the edit is saved, copies it onto the edited version. Never throws: speakers are a nicety.
   */
  async function beforeEdit(sessionId) {
    try {
      const before = await turns.readTurn(sessionId)
      if (!before) return async () => {}
      const turn = before.turn
      const record = (await records(before.chatId, turn)).find(item => item.turn === turn && item.key === before.key)
      if (!Array.isArray(record?.data?.lines) || !record.data.lines.length) return async () => {}
      const oldQuoteCount = dialogueQuotes(before.text).length
      return async () => {
        try {
          const after = await turns.readTurn(sessionId, turn)
          if (!after || after.key === before.key) return
          if ((await records(after.chatId, turn)).some(item => item.turn === turn && item.key === after.key)) return
          const lines = carryCastLines(record.data.lines, oldQuoteCount, dialogueQuotes(after.text))
          if (!lines.length) return
          await data.saveTurn({ chatId: after.chatId, owner: CAST_DATA_OWNER, turn, key: after.key, data: { version: 1, lines } })
          publish(after.sessionId, { turn, textVersion: after.key, lines })
        } catch (error) { console.warn('dsh-tavern: 编辑后保留台词标注失败', error) }
      }
    } catch (error) {
      console.warn('dsh-tavern: 读取台词标注失败', error)
      return async () => {}
    }
  }

  return Object.freeze({ forTurns, annotation, announce, beforeEdit })
}
