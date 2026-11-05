// A card page's pack media by asset id (DshCardPage.asset / assets / preload): only the card's own bound packs, in binding
// order (the first pack holding an id wins). The one lookup: the stage service answers both the page's later calls and its
// declared preload with it, so the client never reads pack manifests for a page.
export const CARD_PAGE_THUMB_SIZES = Object.freeze([256, 512, 1024])

// ref {kind, id, variant?, file?, size?} → {packId, hash, size?} (an image: a background's variant, default its default) or
// {packId, bundleKey, file} (a file of a video bundle: default its entry, 'poster' its poster); null when no pack has it.
export async function locateCardPageAsset(snapshot, packs, ref) {
  for (const packId of packs) {
    const asset = (await snapshot(packId))?.manifest?.assets?.find(item => item.kind === ref.kind && item.id === ref.id)
    if (!asset) continue
    if (asset.bundleKey) return { packId, bundleKey: asset.bundleKey, file: ref.file === 'poster' ? asset.poster : ref.file || asset.entry }
    const rows = asset.variants?.entries || []
    const row = rows.find(item => item.id === ref.variant) || rows.find(item => item.id === asset.variants?.default) || rows[0]
    const hash = row?.content?.media || asset.media
    if (hash) return { packId, hash, ...(CARD_PAGE_THUMB_SIZES.includes(ref.size) ? { size: ref.size } : {}) }
  }
  return null
}

// The entries of one kind across the card's packs (first pack wins an id): what the pack itself says about them.
export async function listCardPageAssets(snapshot, packs, kind) {
  const seen = new Set(), out = []
  for (const packId of packs) {
    const pack = await snapshot(packId)
    for (const asset of pack?.manifest?.assets || []) {
      if (asset.kind !== kind || asset.enabled === false || seen.has(asset.id)) continue
      seen.add(asset.id)
      out.push({ id: asset.id, name: asset.name || asset.id, ...(asset.description ? { description: asset.description } : {}),
        ...(asset.variants?.entries ? { variants: asset.variants.entries.map(row => row.id) } : {}),
        ...(asset.bundleKey ? { files: (pack.manifest.files || []).filter(file => file.path.startsWith('bundles/' + asset.bundleKey + '/')).map(file => file.path.slice(asset.bundleKey.length + 9)) } : {}) })
    }
  }
  return out
}
