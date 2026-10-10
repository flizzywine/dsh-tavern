import { sceneTarget, projectedSceneText } from './scene-illustration.js'
import { sceneWorldbookBinding } from './scene-worldbook.js'
import { projectAgentContent } from './runtime-content-projection.js'

const storyTurnOf = message => Number(message?.turn || (message?.greeting ? 1 : 0))
const isPlay = chat => ['story', 'script'].includes(chat?.mode || 'story')

/**
 * Read-only turn material for the public plugin API. Uses the bounded session
 * summaries and indexed scene targets, so a per-turn notification never reads
 * the complete history of a long save.
 */
export function createPluginTurnReader(deps) {
  async function resolveGame(sessionId) {
    const state = await deps.sessionState(sessionId)
    if (!state || !isPlay(state)) return null
    return { chatId: state.id, sessionId: state.sessionId || sessionId, state }
  }

  async function currentTarget(sessionId, turn) {
    const chat = await deps.sceneState(sessionId, [turn])
    if (!chat) return null
    try { return sceneTarget(chat, turn) } catch (error) {
      if (error.code === 'SCENE_TARGET_UNAVAILABLE') return null
      throw error
    }
  }

  async function currentKey(sessionId, turn) { return (await currentTarget(sessionId, turn))?.key ?? null }

  // A turn is readable once written: an earlier turn always, the latest one
  // once no settlement is pending or running for it. An edit or a rollback
  // leaves it 'idle': its text is final, no settlement is coming.
  async function material(sessionId, turn, { requireLatest = false } = {}) {
    const game = await resolveGame(sessionId)
    if (!game) return null
    const messages = Array.isArray(game.state.messages) ? game.state.messages : []
    let latest = -1
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]?.role === 'assistant') { latest = index; break }
    }
    if (latest < 0) return null
    if (turn === undefined) turn = storyTurnOf(messages[latest])
    const index = messages.findIndex(message => message?.role === 'assistant' && storyTurnOf(message) === turn)
    if (index < 0 || (requireLatest && index !== latest)) return null
    const header = await deps.header(game.sessionId, ['settleStatus', 'macroState', 'cardPath', 'cardName'])
    if (!header) return null
    if (index === latest && !messages[index].greeting && (!['done', 'failed', 'idle'].includes(header.settleStatus) || messages[index].mvu?.pending === true)) return null
    const target = await currentTarget(game.sessionId, turn)
    if (!target) return null
    return {
      chatId: game.chatId, sessionId: game.sessionId, turn, index, key: target.key, sourceDigest: target.sourceDigest,
      source: target.source, text: projectedSceneText(target.source, header.macroState),
      card: { path: String(header.cardPath || ''), name: String(header.cardName || '') }
    }
  }

  async function turnRow(turn) {
    const sliced = await deps.slice(turn.sessionId, [turn.index])
    return sliced ? sliced.chat?.messages?.[0]
      : ((await deps.fullChat(turn.sessionId))?.messages || []).find(message => message?.role === 'assistant' && storyTurnOf(message) === turn.turn)
  }

  // Message variables of the shown version after settlement (MVU data under stat_data).
  async function readVariables(turn) {
    const row = await turnRow(turn)
    const value = row?.variables?.[Math.max(0, Number(row.swipeId) || 0)]
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : null
  }

  async function readCardContext(turn) {
    const header = await deps.header(turn.sessionId, ['mode', 'cardPath', 'cardName', 'macroState', 'cardDefinitionSnapshot'])
    const card = header ? await deps.readChatCard(header).catch(() => null) : null
    const project = value => typeof value === 'string' && value.trim()
      ? projectAgentContent(value, { macroState: header?.macroState, charName: card?.name || header?.cardName }).agentText.trim() : ''
    const row = await turnRow(turn)
    const binding = row ? sceneWorldbookBinding({ messages: [row] }, { turn: turn.turn, sourceDigest: turn.sourceDigest }) : null
    const book = binding && deps.worldbooks ? await deps.worldbooks.read(binding) : null
    const lore = Array.isArray(book?.entries) ? book.entries.map(entry => ({
      title: entry.title, keys: [...(entry.keys || [])], constant: entry.constant === true, content: entry.text
    })) : []
    return { description: project(card?.description), personality: project(card?.personality), scenario: project(card?.scenario), lore }
  }

  return Object.freeze({
    resolveGame: async sessionId => {
      const game = await resolveGame(sessionId)
      return game ? { chatId: game.chatId, sessionId: game.sessionId } : null
    },
    currentKey,
    readTurn: (sessionId, turn) => material(sessionId, turn),
    readLatestSettledTurn: sessionId => material(sessionId, undefined, { requireLatest: true }),
    readCardContext,
    readVariables
  })
}
