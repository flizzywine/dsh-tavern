import {readFile} from 'node:fs/promises'
import {jsonBytes, readDocument, sealPack} from './validation.js'

// A figure's 外貌 lives in the host's 配图 人物库, not in its pack. A pack leaving this library (export, copy) carries it as
// the figure extension dsh.image-character, which the host supplies (options.figureImageExtras) and moves back into a
// record wherever the pack is written again. The stored pack never holds it.
export const FIGURE_IMAGE_EXTENSION = 'dsh.image-character'

export async function figureImageExtras(options, packId, figureIds) {
  return figureIds.length && options.figureImageExtras ? (await options.figureImageExtras({packId, figureIds})) || {} : {}
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
  await sealPack(manifest, files, pack)
  return {...pack, manifest, files}
}
