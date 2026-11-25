// copy only one figure and its complete media closure; no source writes.
import { randomUUID } from 'node:crypto'
import { check, canonicalJson } from '../asset-packs/common.js'
import { jsonBytes } from './validation.js'

// 动态立绘: the 视频 entries the figure's stills name (outfit sprite.videos) come along as entries of the target with their
// bundles, under fresh ids where the target has (or once had) the id; videos maps a source id to its copy, shared by the
// figures of one copy so a loop two figures name is copied once.
// Every place a figure names a 视频 entry: [holder, key] - an image's idle and talking loops and its transitions (into).
export function figureVideoSlots(figure) {
  const slots = []
  for (const outfit of figure.outfits) for (const motion of Object.values(outfit.sprite?.videos || {})) {
    slots.push([motion, 'video'], [motion, 'talk'])
    for (const edge of Object.values(motion.into || {})) slots.push([edge, 'video'])
  }
  return slots
}
function copyFigureVideos(source, figure, manifest, files, videos, retired) {
  for (const [motion, key] of figureVideoSlots(figure)) {
    const old = motion[key]
    if (old === undefined) continue
    if (!videos.has(old)) {
      const entry = structuredClone(source.manifest.assets.find(a => a.kind === 'videos' && a.id === old))
      check(entry, '$.source', 'Missing video entry: ' + old, 'ASSET_UNAVAILABLE')
      let id = old
      for (let n = 2; manifest.assets.some(a => a.kind === 'videos' && a.id === id) || retired.has('asset/videos/' + id); n++) id = old.slice(0, 44) + '-' + n
      let bundle = entry.bundleKey
      for (let n = 2; Object.hasOwn(manifest.bundles, bundle) || retired.has('bundle/' + bundle); n++) bundle = entry.bundleKey.slice(0, 56) + '-' + n
      manifest.bundles[bundle] = structuredClone(source.manifest.bundles[entry.bundleKey])
      for (const [path, bytes] of source.files) if (path.startsWith(`bundles/${entry.bundleKey}/`)) files.set(`bundles/${bundle}/` + path.slice(`bundles/${entry.bundleKey}/`.length), bytes)
      entry.id = id; entry.bundleKey = bundle
      entry.extensions = {...entry.extensions, dsh_tavern:{...entry.extensions?.dsh_tavern, copiedFrom:entry.extensions?.dsh_tavern?.copiedFrom || {packId:source.manifest.id, kind:'videos', assetId:old}}}
      manifest.assets.push(entry); videos.set(old, id)
    }
    motion[key] = videos.get(old)
  }
}

// keepId: a move — the figure keeps its id (figure ids are unique in the whole library) and is no copy of anything.
export function copyFigureAssets(source, figureId, manifest, files, {credits = true, voices = new Map(), extensions = {}, copyVoice = true, videos = new Map(), retired = new Set(), keepId = false} = {}) {
  check(source?.figures?.[figureId], '$.source', 'Figure missing', 'ASSET_UNAVAILABLE')
  const figure = structuredClone(source.figures[figureId])
  if (!copyVoice) {
    delete figure.voice
    for (const emotion of figure.emotions ?? []) delete emotion.voiceEmotion
  }
  figure.extensions = keepId ? {...figure.extensions,...extensions}
    : {...figure.extensions,...extensions,dsh_tavern:{...figure.extensions?.dsh_tavern,copiedFrom:figure.extensions?.dsh_tavern?.copiedFrom || {packId:source.manifest.id,figureId}}}
  if (!Object.keys(figure.extensions).length) delete figure.extensions
  figure.id = keepId ? figureId : randomUUID()
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
  copyFigureVideos(source, figure, manifest, files, videos, retired)
  const media = new Set()
  const visit = value => {
    if (typeof value === 'string' && Object.hasOwn(source.manifest.blobs, value)) media.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  if (figure.voice?.voice) {
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
