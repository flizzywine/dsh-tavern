import {readFile} from 'node:fs/promises'
import {jsonBytes, readDocument, sealPack} from './validation.js'
import {canonicalJson} from '../asset-packs/common.js'
import {BLOB_MIME_TYPES} from '../asset-packs/manifest.js'
import {FIGURE_IMAGE_EXTENSION, figureImageReferenceMedia} from '../asset-packs/figure.js'
import {imageKind} from './media.js'

// A figure's 外貌 lives in the host's 配图 人物库, not in its pack. A pack leaving this library (export, copy) carries it as
// the figure extension dsh.image-character, which the host supplies (options.figureImageExtras) and moves back into a
// record wherever the pack is written again. The stored pack never holds it. The record's 参考图 travel as pack media the
// extension names by hash ({media, name}); one the pack lacks the host reads out of its 人物库 (options.figureImageMedia).
export {FIGURE_IMAGE_EXTENSION}

export async function figureImageExtras(options, packId, figureIds) {
  return figureIds.length && options.figureImageExtras ? (await options.figureImageExtras({packId, figureIds})) || {} : {}
}

// Adds to a pack being written the 参考图 its carried extensions name that it does not hold yet (a picture uploaded in the
// 配图 人物库 rather than copied from this pack). packId: the pack the extensions were read from.
export async function carryFigureImageMedia(options, packId, extras, manifest, files, hashed) {
  for (const [figureId, extension] of Object.entries(extras)) for (const media of figureImageReferenceMedia(extension)) {
    if (manifest.blobs[media]) continue
    // the 人物库 keeps PNG, JPEG and WebP named by their sha256, as a pack keeps its media
    const bytes = Buffer.from((await options.figureImageMedia({packId, figureId, media})).bytes)
    const ext = imageKind(bytes), name = `media/${media}.${ext}`
    manifest.blobs[media] = {ext, mime:BLOB_MIME_TYPES[ext], size:bytes.length}
    files.set(name, bytes); hashed?.set(name, media)
  }
}

// An update of an installed pack keeps each figure's local 外貌 (the host fills only what its record lacks). The preview
// lists every kept figure whose carried 外貌 differs from its record's ({figureId,name,local,incoming}); the user may
// adopt the incoming one (applyImport adoptLooks), which the host is told before the pack is written.
export async function figureLookChanges(options, before, pack) {
  const carried = id => pack.figures[id]?.extensions?.[FIGURE_IMAGE_EXTENSION]
  const ids = before ? pack.manifest.figures.filter(id => before.manifest.figures.includes(id) && carried(id)) : []
  const local = await figureImageExtras(options, pack.manifest.id, ids)
  return ids.filter(id => local[id] && canonicalJson(local[id]) !== canonicalJson(carried(id)))
    .map(id => ({figureId:id, name:pack.figures[id].name, local:local[id], incoming:carried(id)}))
}

// The export view of a pack with each figure's extension added, resealed.
export async function withFigureImageExtras(pack, options) {
  const extras = await figureImageExtras(options, pack.manifest.id, pack.manifest.figures || [])
  if (!Object.keys(extras).length) return pack
  const files = new Map(pack.files), manifest = structuredClone(pack.manifest)
  for (const [figureId, extension] of Object.entries(extras)) {
    const name = 'figures/' + figureId + '.json', data = files.get(name)
    if (!data) continue
    const figure = readDocument(data.file ? await readFile(data.file) : Buffer.from(data))
    files.set(name, jsonBytes({...figure, extensions:{...figure.extensions, [FIGURE_IMAGE_EXTENSION]:extension}}))
  }
  await carryFigureImageMedia(options, pack.manifest.id, extras, manifest, files)
  await sealPack(manifest, files, pack)
  return {...pack, manifest, files}
}
