// copy only one figure and its complete media closure; no source writes.
import { randomUUID } from 'node:crypto'
import { check, canonicalJson } from '../asset-packs/common.js'
import { jsonBytes } from './validation.js'

export function copyFigureAssets(source, figureId, manifest, files, {credits = true, voices = new Map()} = {}) {
  check(source?.figures?.[figureId], '$.source', 'Figure missing', 'ASSET_UNAVAILABLE')
  const figure = structuredClone(source.figures[figureId])
  figure.extensions = {...figure.extensions,dsh_tavern:{...figure.extensions?.dsh_tavern,copiedFrom:figure.extensions?.dsh_tavern?.copiedFrom || {packId:source.manifest.id,figureId}}}
  figure.id = randomUUID()
  const prefix = 'c' + figure.id.replaceAll('-', ''), sprites = new Map(), bundles = new Map()
  for (const outfit of figure.outfits) {
    if (outfit.sprite) {
      const old = outfit.sprite.manifestKey
      if (!sprites.has(old)) {
        const key = prefix + 's' + sprites.size, path = `sprites/${key}/manifest.json`
        sprites.set(old, key); manifest.sprites[key] = path
        files.set(path, source.files.get(source.manifest.sprites[old]))
      }
      outfit.sprite.manifestKey = sprites.get(old)
    }
    // Live2D and Spine outfits both own one inert bundle.
    for (const form of ['live2d', 'spine']) if (outfit[form]) {
      const old = outfit[form].bundleKey
      if (!bundles.has(old)) {
        const key = prefix + 'b' + bundles.size
        bundles.set(old, key); manifest.bundles[key] = structuredClone(source.manifest.bundles[old])
        for (const [path, bytes] of source.files) if (path.startsWith(`bundles/${old}/`)) files.set(`bundles/${key}/` + path.slice(`bundles/${old}/`.length), bytes)
      }
      outfit[form].bundleKey = bundles.get(old)
    }
  }
  const media = new Set()
  const visit = value => {
    if (typeof value === 'string' && Object.hasOwn(source.manifest.blobs, value)) media.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  if (figure.voice) {
    const old = figure.voice.voice, library = manifest.voiceLibrary ||= {version:1,voices:{}}
    if (!voices.has(old)) {
      let next = old
      for (let n = 2; Object.hasOwn(library.voices,next); n++) next = old.slice(0,60) + '-' + n
      library.voices[next] = structuredClone(source.manifest.voiceLibrary.voices[old]); voices.set(old,next)
    }
    figure.voice.voice = voices.get(old); visit(library.voices[figure.voice.voice])
  }
  visit(figure)
  for (const hash of media) {
    const descriptor = source.manifest.blobs[hash]
    check(!manifest.blobs[hash] || canonicalJson(manifest.blobs[hash]) === canonicalJson(descriptor), '$.blob', 'Conflicting blob descriptor')
    manifest.blobs[hash] = structuredClone(descriptor)
    const path = `media/${hash}.${descriptor.ext}`
    files.set(path, source.files.get(path))
  }
  // Preserve attribution with the copied material, using collision-free paths.
  if (credits) for (const [index, old] of (source.manifest.credits || []).entries()) {
    const path = `credits/${prefix}-${index}.txt`
    files.set(path, source.files.get(old)); (manifest.credits ||= []).push(path)
  }
  manifest.figures.push(figure.id)
  files.set(`figures/${figure.id}.json`, jsonBytes(figure))
  return {figureId:figure.id}
}
