// A new game is named after its card until the player's first turn. DSH 0.2 shows an
// untitled Session by its folder name, which for every game is the data folder
// ("resources"). The placeholder is a pinned title, so DSH's own first-prompt titling
// does not run; after the first turn Tavern asks for it explicitly (refresh), unless the
// player renamed the game in the meantime.
export function gamePlaceholderTitle(cardName) {
  const name = String(cardName || '').trim()
  return (name || '游戏') + '的新对话'
}

export function createGameTitles({ sessionTitle: titles, sessions, logger = console }) {
  // The title service may start after Tavern; look it up each time.
  let sessionTitle = null
  const live = id => sessions?.get?.(String(id || ''))
  const usable = () => {
    sessionTitle = typeof titles === 'function' ? titles() : titles
    return Boolean(sessionTitle && typeof sessionTitle.get === 'function' && typeof sessionTitle.rename === 'function')
  }

  /** Name a fresh game after its card; a game that already has a title keeps it. */
  function name(sessionId, cardName) {
    const session = live(sessionId)
    if (!session || !usable() || sessionTitle.get(session) !== undefined) return false
    try { sessionTitle.rename(session, gamePlaceholderTitle(cardName)); return true }
    catch (error) { logger.warn?.('dsh-tavern: 新游戏命名失败', sessionId, error?.message || error); return false }
  }

  /** After a turn: replace the card-name placeholder with DSH's own title from the player's words. */
  async function afterTurn(sessionId, cardName) {
    const session = live(sessionId)
    if (!session || !usable() || typeof sessionTitle.refresh !== 'function') return false
    const current = sessionTitle.get(session)
    if (!current || current.source?.kind !== 'user' || current.title !== gamePlaceholderTitle(cardName)) return false
    try { return Boolean(await sessionTitle.refresh(session)) }
    catch (error) { logger.warn?.('dsh-tavern: 生成对话标题失败', sessionId, error?.message || error); return false }
  }

  return Object.freeze({ name, afterTurn })
}
