import {readDocument, jsonBytes} from './validation.js'
import {assetContents} from '../shared/asset-variant-content.js'

const figureMedia = figure => new Set(figure.outfits.flatMap(o => [...Object.values(o.avatars || {}), ...Object.values(o.sprite?.assets || {})]))
const outfitMedia = outfit => new Set([...Object.values(outfit?.avatars || {}), ...Object.values(outfit?.sprite?.assets || {})])
// Measurements bound to one picture — the figure's face anchors (keyed by media) and an outfit's measured heads
// (dsh.avatar-heads, per state with its media) — retire with that picture: when this write took a picture the figure had
// out of it (删除差分, 删除这张立绘, a replacement), they go in the same write. A measurement of media the figure never had is
// new input and stays for validation to judge.
function retireMediaMeasurements(figure, previous) {
  if (!previous) return figure
  const had = figureMedia(previous), has = figureMedia(figure), gone = hash => had.has(hash) && !has.has(hash)
  let changed = false
  const outfits = figure.outfits.map(outfit => {
    const heads = outfit.extensions?.['dsh.avatar-heads']
    if (!heads) return outfit
    const before = outfitMedia(previous.outfits.find(o => o.key === outfit.key)), now = outfitMedia(outfit)
    const kept = Object.fromEntries(Object.entries(heads).filter(([, head]) => !(before.has(head?.media) && !now.has(head?.media))))
    if (Object.keys(kept).length === Object.keys(heads).length) return outfit
    changed = true
    const extensions = {...outfit.extensions, 'dsh.avatar-heads': kept}
    if (!Object.keys(kept).length) delete extensions['dsh.avatar-heads']
    const next = {...outfit, extensions}
    if (!Object.keys(extensions).length) delete next.extensions
    return next
  })
  const next = {...figure, outfits}, anchors = figure.extensions?.['dsh.avatar-face-anchors']
  if (anchors && Object.keys(anchors).some(gone)) {
    changed = true
    const kept = Object.fromEntries(Object.entries(anchors).filter(([hash]) => !gone(hash)))
    next.extensions = {...figure.extensions, 'dsh.avatar-face-anchors': kept}
    if (!Object.keys(kept).length) delete next.extensions['dsh.avatar-face-anchors']
    if (!Object.keys(next.extensions).length) delete next.extensions
  }
  return changed ? next : figure
}

// Atomic authoring writes retire replaced images. External imports instead reject unused images.
export function trimAuthoringImages(manifest, files, previousFigures) {
  const figures = manifest.figures.map(id => {
    const name = 'figures/' + id + '.json'
    if (!files.has(name)) return previousFigures[id]
    // a written figure's measurements of the pictures it just lost go before the images are counted
    const figure = readDocument(files.get(name)), kept = retireMediaMeasurements(figure, previousFigures[id])
    if (kept !== figure) files.set(name, jsonBytes(kept))
    return kept
  })
  const sprites = new Set(figures.flatMap(figure => figure.outfits.map(outfit => outfit.sprite?.manifestKey).filter(Boolean)))
  for (const [key, file] of Object.entries(manifest.sprites)) if (!sprites.has(key)) {
    delete manifest.sprites[key]
    files.delete(file)
  }
  const used = new Set()
  const visit = value => {
    if (typeof value === 'string' && Object.hasOwn(manifest.blobs,value)) used.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(figures); visit(manifest.assets); visit(manifest.voiceLibrary); visit(manifest.tagIcons); visit(manifest.backgroundStyle)
  for (const [hash, descriptor] of Object.entries(manifest.blobs)) if (descriptor.mime.startsWith('image/') && !used.has(hash)) {
    delete manifest.blobs[hash]
    files.delete('media/' + hash + '.' + descriptor.ext)
  }
}

// Removed figures retire their own models (Live2D / Spine bundles); a bundle a remaining figure or an asset uses stays.
export function retireFigureBundles(manifest, files, removed, remaining) {
  const owned = new Set(removed.flatMap(figure => figure.outfits.flatMap(outfit => [outfit.live2d?.bundleKey, outfit.spine?.bundleKey])).filter(Boolean))
  const used = new Set(manifest.assets.flatMap(asset => assetContents(asset).map(content => content.bundleKey)))
  for (const figure of remaining) for (const outfit of figure.outfits) { used.add(outfit.live2d?.bundleKey); used.add(outfit.spine?.bundleKey) }
  for (const key of owned) if (!used.has(key)) {
    delete manifest.bundles[key]
    for (const file of files.keys()) if (file.startsWith(`bundles/${key}/`)) files.delete(file)
  }
}
