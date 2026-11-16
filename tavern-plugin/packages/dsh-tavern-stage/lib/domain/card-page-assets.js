// A card page's pack media by asset id (DshCardPage.asset / assets / preload): only the card's own bound packs, in binding
// order (the first pack holding an id wins). The one lookup: the stage service answers both the page's later calls and its
// declared preload with it, so the client never reads pack manifests for a page.
import { selectPackFigure } from './asset-pack-presentation.js'
export const CARD_PAGE_THUMB_SIZES = Object.freeze([256, 512, 1024])

// kind 'figures': id is a figure id or name, variant an outfit key, file 'avatar' (default), 'sprite', or an emotion id (its sprite).
// ref {kind, id, variant?, file?, size?} → {packId, hash, size?} (an image: a background's variant, default its default) or
// {packId, bundleKey, file} (a file of a video bundle: default its entry, 'poster' its poster); null when no pack has it.
export async function locateCardPageAsset(snapshot, packs, ref) {
  for (const packId of packs) {
    const pack = await snapshot(packId)
    if (ref.kind === 'figures') {
      const hash = figureMedia(pack, ref)
      if (hash) return { packId, hash, ...(CARD_PAGE_THUMB_SIZES.includes(ref.size) ? { size: ref.size } : {}) }
      continue
    }
    const asset = pack?.manifest?.assets?.find(item => item.kind === ref.kind && item.id === ref.id)
    if (!asset) continue
    if (asset.bundleKey) return { packId, bundleKey: asset.bundleKey, file: ref.file === 'poster' ? asset.poster : ref.file || asset.entry }
    const rows = asset.variants?.entries || []
    const row = rows.find(item => item.id === ref.variant) || rows.find(item => item.id === asset.variants?.default) || rows[0]
    const hash = row?.content?.media || asset.media
    if (hash) return { packId, hash, ...(CARD_PAGE_THUMB_SIZES.includes(ref.size) ? { size: ref.size } : {}) }
  }
  return null
}

function findFigure(pack, id) {
  return Object.values(pack?.figures || {}).find(figure => figure.enabled && (figure.id === id || figure.name === id))
}

function figureMedia(pack, ref) {
  const figure = findFigure(pack, ref.id)
  if (!figure) return null
  const file = ref.file || 'avatar', isAvatar = file === 'avatar'
  const selected = selectPackFigure(figure, pack.sprites || {}, { outfitKey: ref.variant, ...(isAvatar || file === 'sprite' ? {} : { emotion: file }) })
  if (isAvatar) return selected.avatar || null
  const src = selected.state?.stage?.src || selected.state?.src
  return (src && selected.outfit?.sprite?.assets?.[src]) || selected.avatar || null
}

// The entries of one kind across the card's packs (first pack wins an id): what the pack itself says about them.
export async function listCardPageAssets(snapshot, packs, kind) {
  const seen = new Set(), out = []
  for (const packId of packs) {
    const pack = await snapshot(packId)
    if (kind === 'figures') {
      for (const figure of Object.values(pack?.figures || {})) {
        if (!figure.enabled || seen.has(figure.id)) continue
        seen.add(figure.id)
        out.push({ id: figure.id, name: figure.name || figure.id, ...(figure.description ? { description: figure.description } : {}), variants: figure.outfits.filter(outfit => outfit.enabled).map(outfit => outfit.key) })
      }
      continue
    }
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
