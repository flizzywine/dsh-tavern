// 优先级 (recall.priority) is removed — nothing ordered by it any more. This is the single
// old-data conversion, shared by archive ingress (importPack) and the one-time offline migration of installed packs, as
// figure-names.js is. Validators reject a stored `priority` as UNKNOWN_FIELD; no reader tolerates it.
const strip = recall => {
  if (!recall || typeof recall !== 'object' || Array.isArray(recall) || !Object.hasOwn(recall, 'priority')) return recall
  const next = {...recall}; delete next.priority; return next
}
export function migrateRecallPriorityAsset(asset) {
  return asset?.recall && Object.hasOwn(asset.recall, 'priority') ? {...asset, recall:strip(asset.recall)} : asset
}
export function migrateRecallPriorityFigure(figure) {
  if (!figure || typeof figure !== 'object') return figure
  const outfits = Array.isArray(figure.outfits) ? figure.outfits.map(outfit => outfit?.recall && Object.hasOwn(outfit.recall, 'priority') ? {...outfit, recall:strip(outfit.recall)} : outfit) : figure.outfits
  const recall = strip(figure.recall)
  if (recall === figure.recall && (!Array.isArray(figure.outfits) || outfits.every((outfit, index) => outfit === figure.outfits[index]))) return figure
  return {...figure, ...(figure.recall !== undefined ? {recall} : {}), ...(figure.outfits !== undefined ? {outfits} : {})}
}
// manifest → a new manifest when any entry carried a priority, else the same object.
export function migrateRecallPriorityManifest(manifest) {
  if (!Array.isArray(manifest?.assets)) return manifest
  const assets = manifest.assets.map(migrateRecallPriorityAsset)
  return assets.every((asset, index) => asset === manifest.assets[index]) ? manifest : {...manifest, assets}
}
// Publisher baselines (local.distribution.baseMetadata) hold copies of entry / figure recall: an old baseline with a
// priority would read as a local edit on the next catalogue update.
export function migrateRecallPriorityBaselines(local) {
  const rows = local?.distribution?.baseMetadata
  if (!rows || !Object.values(rows).some(row => row?.recall && Object.hasOwn(row.recall, 'priority'))) return local
  const next = structuredClone(local)
  for (const row of Object.values(next.distribution.baseMetadata)) if (row?.recall) row.recall = strip(row.recall)
  return next
}
