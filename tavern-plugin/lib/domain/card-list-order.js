export const RECENT_IMPORT_WINDOW = 3 * 24 * 60 * 60 * 1000

function importedAt(card) {
  const value = Number(card && card.importedAt)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function byName(left, right) {
  const leftName = String(left && (left.name || left.path) || '')
  const rightName = String(right && (right.name || right.path) || '')
  return leftName.localeCompare(rightName, 'zh-CN')
}

/** Counts the games that still exist for each card; card-workbench conversations are not games. */
export function countGamesByCard(conversations) {
  const counts = new Map()
  for (const item of Array.isArray(conversations) ? conversations : []) {
    if (!item || item.mode === 'card' || !item.cardPath) continue
    counts.set(item.cardPath, (counts.get(item.cardPath) || 0) + 1)
  }
  return counts
}

/** Cards imported in the last three days come first, newest first; the rest follow by games played. */
export function orderCardsForLibrary(cards, { gameCounts = new Map(), now = Date.now() } = {}) {
  const recent = card => importedAt(card) > now - RECENT_IMPORT_WINDOW
  const games = card => gameCounts.get(card && card.path) || 0
  return (Array.isArray(cards) ? cards : []).slice().sort(function (left, right) {
    const byRecent = Number(recent(right)) - Number(recent(left))
    if (byRecent !== 0) return byRecent
    if (!recent(left)) {
      const byGames = games(right) - games(left)
      if (byGames !== 0) return byGames
    }
    return importedAt(right) - importedAt(left) || byName(left, right)
  })
}
