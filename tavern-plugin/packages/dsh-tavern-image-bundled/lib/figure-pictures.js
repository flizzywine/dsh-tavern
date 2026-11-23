// A record linked to a figure of the host's asset library (figurePackId, figureId) does not store that figure's 设定图:
// the pack is their one store, and the host lends them for each picture (tavern.figurePictures). A 设定图 the pack drops
// or replaces is therefore gone from the next picture without any copy to clean up. The record keeps only pictures a
// user uploaded to it.

/** The figures whose pictures the host lends: every record in `definitions` linked to one. */
export function linkedFigures(definitions) {
  return (definitions?.characters ?? []).filter(item => item?.figurePackId && item?.figureId)
    .map(item => ({ packId: item.figurePackId, figureId: item.figureId }))
}

const LEGACY_COPY_SUFFIX = /^ (?:设定图|立绘参考|差分参考|头像参考)$/

/** Hide references named by the old automatic copy operations, while retaining uploaded files. */
export function withoutCopiedFigurePictures(definitions) {
  const isCopy = (image, name) => typeof image?.name === 'string'
    && image.name.startsWith(name) && LEGACY_COPY_SUFFIX.test(image.name.slice(name.length))
  return { ...definitions, characters: (definitions.characters ?? []).map(item => {
    if (!item?.figurePackId || !item.figureId) return item
    const clean = { ...item, outfits: (item.outfits ?? []).map(outfit => {
      if (!isCopy(outfit.characterOutfitImage, item.name + '／' + outfit.name)) return outfit
      const { characterOutfitImage, ...remaining } = outfit
      return remaining
    }) }
    if (isCopy(clean.referenceImage, item.name)) delete clean.referenceImage
    return clean
  }) }
}

/** `definitions` as one picture reads them (never saved): a linked person's 人设图 is their 参考图, and each outfit's
 *  服装设定图 its 角色×服装设定图. An outfit with no 设定图 borrows the host's 立绘 only while the record has no picture of
 *  its own for it; a person with no 人设图 keeps the uploaded one. `rows` is the host's answer. */
export function withFigurePictures(definitions, rows) {
  if (!rows?.length) return definitions
  const rowOf = item => rows.find(row => row.packId === item.figurePackId && row.figureId === item.figureId)
  return { ...definitions, characters: definitions.characters.map(item => {
    const row = item?.figurePackId && item.figureId ? rowOf(item) : null
    if (!row) return item
    return { ...item, ...(row.identity ? { referenceImage: row.identity } : {}),
      outfits: (item.outfits ?? []).map(outfit => {
        const lent = row.outfits?.[outfit.id]
        return lent && !(lent.borrowed && outfit.characterOutfitImage) ? { ...outfit, characterOutfitImage: lent.picture } : outfit
      }) }
  }) }
}

/** The host's pictures by sha256 → the figure that lends it, to fetch the bytes (tavern.readFigurePicture). */
export function figurePictureSources(rows) {
  const sources = new Map()
  for (const row of rows ?? []) {
    const at = { packId: row.packId, figureId: row.figureId }
    if (row.identity) sources.set(row.identity.id, at)
    for (const { picture } of Object.values(row.outfits ?? {})) sources.set(picture.id, at)
  }
  return sources
}
