function importedAt(card) {
  const value = Number(card && card.importedAt)
  return Number.isFinite(value) && value > 0 ? value : 0
}

export function orderCardsByNewestImport(cards) {
  return (Array.isArray(cards) ? cards : []).slice().sort(function (left, right) {
    const byImport = importedAt(right) - importedAt(left)
    if (byImport !== 0) return byImport
    const leftName = String(left && (left.name || left.path) || '')
    const rightName = String(right && (right.name || right.path) || '')
    return leftName.localeCompare(rightName, 'zh-CN')
  })
}
