// Run after lamp/trigger/judge selection, on resolved effective rows (not display labels).
export function filterGenericSfx(rows, boundPackIds, globalEnabledPackIds) {
  const bound = new Set(boundPackIds), global = new Set(globalEnabledPackIds)
  const fromCard = row => bound.has(row.ref.packId)
  const categories = new Set(rows.filter(row => row.asset.category && fromCard(row)).map(row => row.asset.category))
  return rows.filter(row => !row.asset.category || !categories.has(row.asset.category) || fromCard(row)
    || !global.has(row.ref.packId))
}
