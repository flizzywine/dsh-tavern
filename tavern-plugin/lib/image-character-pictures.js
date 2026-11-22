import { figurePackPictures } from './domain/image-character-appearance.js'

// A figure's 设定图 and borrowed 立绘 live in its pack only (ADR 0012). 配图 reads them by a record's link
// (figurePackId, figureId) through these two host calls, so a 设定图 the pack drops or replaces is gone from the next
// picture with nothing to sync. A picture is named by its sha256 as in the 人物库's own store.
export function createFigurePictures(library) {
  const figureOf = async (packId, figureId, packs = new Map()) => {
    if (!packs.has(packId)) packs.set(packId, library().getPackSnapshot({ packId, readOnly: true }))
    const pack = await packs.get(packId)
    const figure = pack && typeof figureId === 'string' ? pack.figures[figureId] : null
    return figure ? { pack, figure } : null
  }
  const descriptor = (pack, hash, name) => {
    const blob = pack.manifest.blobs?.[hash]
    return blob ? { id: hash, mediaType: blob.mime, byteLength: blob.size, name } : null
  }
  return {
    /** [{packId, figureId}] → [{packId, figureId, identity, outfits: {[outfit key]: {picture, borrowed}}}], a picture being a
     *  reference descriptor {id, mediaType, byteLength, name}. A figure no installed pack holds is left out. */
    async list(figures) {
      if (!library() || !Array.isArray(figures)) return []
      const packs = new Map()
      const rows = await Promise.all(figures.slice(0, 4096).map(async ({ packId, figureId } = {}) => {
        const found = await figureOf(packId, figureId, packs)
        if (!found) return null
        const { pack, figure } = found, pictures = figurePackPictures(pack, figure)
        const outfits = {}
        for (const [key, { hash, borrowed }] of Object.entries(pictures.outfits)) {
          const label = figure.outfits.find(outfit => outfit.key === key)?.label || key
          const picture = descriptor(pack, hash, figure.name + '／' + label + (borrowed ? ' 立绘' : ' 设定图'))
          if (picture) outfits[key] = { picture, borrowed }
        }
        return { packId, figureId, identity: pictures.identity ? descriptor(pack, pictures.identity, figure.name + ' 人物设定图') : null, outfits }
      }))
      return rows.filter(Boolean)
    },
    /** The bytes of one of a figure's pictures (only a picture list() gives that figure). */
    async read({ packId, figureId, id } = {}) {
      const found = library() && await figureOf(packId, figureId)
      if (!found) throw Object.assign(new Error('人物已不在素材库里'), { code: 'NOT_FOUND' })
      const pictures = figurePackPictures(found.pack, found.figure)
      if (id !== pictures.identity && !Object.values(pictures.outfits).some(row => row.hash === id)) throw Object.assign(new Error('这张图不是这个人物的设定图或立绘'), { code: 'NOT_FOUND' })
      const { bytes, descriptor: media } = await library().readMedia({ packId, expectedRevision: found.pack.revision, hash: id })
      return { data: new Uint8Array(bytes), mediaType: media.mime }
    },
  }
}
