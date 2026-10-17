import { CAST_DATA_OWNER, CAST_SUBMIT_TOOL, CAST_SUBMIT_TOOL_NAME, castSettlementText, dialogueQuotes, normalizeCastSubmission, recentSpeakers } from './cast-annotation.js'

/**
 * Dialogue annotation as part of the background settlement. Tavern's own counterpart
 * of a plugin settlement tool: the tool stays in the cached prefix, the per-turn note
 * says whether to use it. Results live in the per-game turn data store, bound to the
 * story text version, so rollback, regeneration and edits need no synchronization.
 */
export function createCastPresentation({ enabled, turns, data, publish = () => {} }) {
  // The quotes numbered in this turn's note, so a submission maps back to text.
  const pending = new Map()
  const keyOf = (gameId, turn) => gameId + '\u0000' + turn

  async function records(chatId, turn) {
    return data.turnsUpTo({ chatId, owner: CAST_DATA_OWNER, turn })
  }

  const settlement = Object.freeze({
    tools: () => [CAST_SUBMIT_TOOL],
    has: name => name === CAST_SUBMIT_TOOL_NAME,
    /** Whether settlement must run for this game even with posture and variables off. */
    wanted: async () => await enabled() === true,
    async section({ gameId, turn }) {
      pending.delete(keyOf(gameId, turn))
      if (await enabled() !== true) return ''
      const material = await turns.readPendingTurn(gameId)
      if (!material || material.turn !== turn || material.greeting) return ''
      const quotes = dialogueQuotes(material.text)
      if (!quotes.length) return ''
      pending.set(keyOf(gameId, turn), { chatId: material.chatId, key: material.key, quotes })
      return castSettlementText(quotes, { speakers: recentSpeakers(await records(material.chatId, turn - 1)) })
    },
    async call(name, args, { gameId, turn }) {
      const target = pending.get(keyOf(gameId, turn))
      if (name !== CAST_SUBMIT_TOOL_NAME || !target) return JSON.stringify({ ok: false, retryable: false, error: '本轮没有需要标注的台词，不要调用 cast_submit' })
      let lines
      try { lines = normalizeCastSubmission(args, target.quotes) }
      catch (error) { return JSON.stringify({ ok: false, retryable: true, error: String(error?.message || error) }) }
      await data.saveTurn({ chatId: target.chatId, owner: CAST_DATA_OWNER, turn, key: target.key, data: { version: 1, lines } })
      pending.delete(keyOf(gameId, turn))
      publish(gameId, { turn, textVersion: target.key, lines })
      return JSON.stringify({ ok: true, annotated: lines.length })
    }
  })

  /** Annotations of the shown text versions of some turns; turns without one are left out. */
  async function forTurns(sessionId, wanted) {
    if (await enabled() !== true) return { enabled: false, turns: {} }
    const game = await turns.resolveGame(sessionId)
    const list = [...new Set((Array.isArray(wanted) ? wanted : []).map(Number).filter(turn => Number.isSafeInteger(turn) && turn > 0))].slice(0, 100)
    if (!game || !list.length) return { enabled: true, turns: {} }
    const all = await records(game.chatId, Math.max(...list))
    const result = {}
    for (const turn of list) {
      const candidates = all.filter(item => item.turn === turn)
      if (!candidates.length) continue
      const key = await turns.currentKey(game.sessionId, turn)
      const record = key && candidates.find(item => item.key === key)
      if (Array.isArray(record?.data?.lines) && record.data.lines.length) result[turn] = record.data.lines
    }
    return { enabled: true, turns: result }
  }

  /** One turn's annotation for the text version shown now, whether or not annotating is on. */
  async function annotation(sessionId, turn) {
    const game = await turns.resolveGame(sessionId)
    const key = game && await turns.currentKey(game.sessionId, turn)
    if (!key) return null
    const record = (await records(game.chatId, turn)).find(item => item.turn === turn && item.key === key)
    const lines = record?.data?.lines
    return Array.isArray(lines) && lines.length ? { turn, textVersion: key, lines: structuredClone(lines) } : null
  }

  return Object.freeze({ settlement, forTurns, annotation })
}
