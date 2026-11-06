// One cross-pack identity/lamp policy, before any trigger, judge or prompt selection.
const refKey = ref => JSON.stringify([ref.packId, ref.figureId ? 'figures' : ref.kind, ref.figureId || ref.assetId])
const lamp = asset => !asset.enabled ? 0 : asset.recall?.mode === 'constant' ? 2 : 1

function mediaIdentity(pack, asset, kind) {
  const hashes = new Set(), {bundles = {}} = pack.manifest
  const visit = value => {
    if (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)) hashes.add(value)
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
      if (key === 'extensions') continue
      if (key === 'bundleKey' && bundles[item]) hashes.add(bundles[item].contentHash)
      else visit(item)
    }
  }
  if (kind === 'figures') visit(asset)
  else { visit(asset.media); visit(asset.variants); if (kind === 'looks') visit(asset.params); if (asset.bundleKey) visit({bundleKey:asset.bundleKey}) }
  if (kind === 'figures' && asset.voice) visit(pack.manifest.voiceLibrary?.voices[asset.voice.voice])
  // Media-less entries are not identical merely because they have no digests.
  return hashes.size ? JSON.stringify([kind, [...hashes].sort()]) : null
}

/** Verified snapshots only; stored digests are identities, never rehashed on read.
 * sourceRefs are provenance only. Figures are independent entries even when their media is shared.
 */
export function listEffectiveAssets({snapshots = [], boundPackIds = [], globalEnabledPackIds = []} = {}) {
  const ids = [...new Set([...boundPackIds, ...globalEnabledPackIds.slice().sort()])], rows = []
  for (const packId of ids) {
    const pack = snapshots.find(pack => pack.manifest.id === packId)
    if (!pack) continue
    for (const asset of pack.manifest.assets || []) rows.push({pack, asset, ref:{packId,kind:asset.kind,assetId:asset.id}})
    const figures = new Map(Object.values(pack.figures || {}).map(figure => [figure.id,figure]))
    for (const figureId of pack.manifest.figures || []) if (figures.has(figureId)) rows.push({pack, asset:figures.get(figureId), ref:{packId,figureId}})
  }
  const parents = rows.map((_, i) => i), identities = new Map(), media = new Map()
  const root = i => parents[i] === i ? i : (parents[i] = root(parents[i]))
  const join = (map, key, i) => {
    if (map.has(key)) parents[root(i)] = root(map.get(key))
    else map.set(key,i)
  }
  rows.forEach((row, i) => {
    const kind = row.ref.figureId ? 'figures' : row.ref.kind
    join(identities,refKey(row.ref),i)
    if (kind === 'figures') return
    const origin = row.asset.extensions?.dsh_tavern?.copiedFrom
    if (origin) join(identities,refKey(origin),i)
    const digest = origin ? null : mediaIdentity(row.pack,row.asset,kind)
    if (digest) join(media,digest,i)
  })
  const groups = new Map()
  rows.forEach((row,i) => { const key = root(i); if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(row) })
  return [...groups.values()].map(group => {
    const copies = group.filter(row => boundPackIds.includes(row.ref.packId) && row.asset.extensions?.dsh_tavern?.copiedFrom)
    // A bound copy owns the whole entry, including off. Independent entries use the strongest lamp.
    const winner = copies[0] || group.reduce((a,b) => lamp(b.asset) > lamp(a.asset) ? b : a)
    const refs = new Map()
    for (const row of group) {
      refs.set(refKey(row.ref),row.ref)
      const origin = row.asset.extensions?.dsh_tavern?.copiedFrom
      if (origin) refs.set(refKey(origin),origin)
    }
    return {...winner, sourceRefs:[...refs.values()]}
  })
}
