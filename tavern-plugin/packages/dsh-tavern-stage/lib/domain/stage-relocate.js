// Where a story's items are today. A stage record names an asset by {packId, kind, assetId} and a figure by
// {packId, figureId}; the pack in it is where the item was when the round was directed. An item is the same item in
// whichever pack holds it now (素材库「移动到…」 keeps its id), so the stage finds it by kind and id — a figure by its id,
// unique in the whole library — in the packs the card can use, in their order (the card's bound packs, then the global
// ones). Nothing stored is rewritten: a record is read through relocateStage, and what a new round writes names where
// its items are then. An item no usable pack holds keeps the ref it had and shows as unavailable, as before.

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isAssetRef = value => object(value) && typeof value.packId === 'string' && typeof value.kind === 'string' && typeof value.assetId === 'string'
const isFigureRef = value => object(value) && typeof value.packId === 'string' && typeof value.figureId === 'string'

/** packIds: the usable packs in order; snapshots: installed pack snapshots ({manifest}); actorKey: the core's
 *  figureActorKey (a figure's actor key is derived from its ref, so a moved figure's key changes). */
export function stageLocator(packIds, snapshots, actorKey) {
  const assets = new Map(), figures = new Map()
  for (const packId of packIds) {
    const pack = snapshots.find(row => row?.manifest.id === packId)
    if (!pack) continue
    for (const asset of pack.manifest.assets || []) if (!assets.has(asset.kind + '/' + asset.id)) assets.set(asset.kind + '/' + asset.id, packId)
    for (const figureId of pack.manifest.figures || []) if (!figures.has(figureId)) figures.set(figureId, packId)
  }
  return {
    // the pack holding this item now, or null
    asset: ref => assets.get(ref.kind + '/' + ref.assetId) ?? null,
    figure: ref => figures.get(ref.figureId) ?? null,
    actorKey,
  }
}

/** The value (a stage state, a record, a stored opening) with every ref naming where its item is now; the same object
 *  when nothing moved. A moved figure's actor key (derived from its ref) is renamed wherever the value uses it. */
export function relocateStage(value, locator) {
  if (!locator) return value
  const keys = new Map()
  let moved = false
  const scan = node => {
    if (Array.isArray(node)) { node.forEach(scan); return }
    if (!object(node)) return
    if (isAssetRef(node)) { const packId = locator.asset(node); if (packId && packId !== node.packId) moved = true; return }
    if (isFigureRef(node)) {
      const packId = locator.figure(node)
      if (packId && packId !== node.packId) {
        moved = true
        const from = locator.actorKey(node), to = locator.actorKey({packId, figureId:node.figureId})
        if (from !== to) keys.set(from, to)
      }
      return
    }
    Object.values(node).forEach(scan)
  }
  scan(value)
  if (!moved) return value
  const rename = key => keys.get(key) ?? key
  const rebuild = node => {
    if (Array.isArray(node)) return node.map(rebuild)
    if (typeof node === 'string') return rename(node)
    if (!object(node)) return node
    if (isAssetRef(node)) return {...node, packId:locator.asset(node) ?? node.packId}
    if (isFigureRef(node)) return {...node, packId:locator.figure(node) ?? node.packId}
    return Object.fromEntries(Object.entries(node).map(([key, item]) => [rename(key), rebuild(item)]))
  }
  return rebuild(value)
}
