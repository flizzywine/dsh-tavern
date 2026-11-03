import { imageCharacterFromFigure, linkPatchFromFigure } from '../domain/image-character-appearance.js'

// The asset library edits a figure's 外貌, outfits and reference images in the 配图 人物库 (tavern.registerImageLibrary
// records, schema 4). The 人物库 is the one store: nothing here is cached or copied into the pack.
export function createImageCharacterHandlers(deps) {
  const { ctx, pluginApi } = deps
  const records = (op, input) => pluginApi.imageCharacters(op, input)
  const fail = (code, message) => Object.assign(new Error(message), { code })
  async function figureOf(packId, figureId) {
    const library = ctx.get('assetLibrary')
    if (!library) throw fail('ASSET_UNAVAILABLE', '素材库未启用')
    const pack = await library.getPackSnapshot({ packId })
    const figure = pack?.figures[figureId]
    if (!figure) throw fail('NOT_FOUND', '人物已删除，请重新载入')
    return { library, pack, figure }
  }
  return {
    // { status: 'linked', providerId, version, character } | { status: 'unlinked', candidates } | { status: 'unavailable', reason }
    async getFigureImageCharacter(args) {
      try { return { status: 'linked', ...await records('getCharacter', { figureId: args?.figureId }) } }
      catch (error) {
        if (error.code === 'NOT_CONFIGURED') return { status: 'unavailable', reason: error.message }
        if (error.code !== 'NOT_FOUND') throw error
        const list = await pluginApi.listImageLibrary('characters', { limit: 200 })
        return { status: 'unlinked', candidates: list.items.map(item => ({ providerId: item.providerId, id: item.id, name: item.name })) }
      }
    },
    // characterId links an existing record (filling only what it lacks); without it a new record starts from the figure.
    async linkFigureImageCharacter(args) {
      const { figure } = await figureOf(args?.packId, args?.figureId)
      if (!args.characterId) return { status: 'linked', ...await records('createCharacter', { character: imageCharacterFromFigure(figure) }) }
      const { character } = await records('getCharacter', { characterId: args.characterId })
      return { status: 'linked', ...await records('patchCharacter', { characterId: character.id, expected: character, patch: linkPatchFromFigure(character, figure) }) }
    },
    async patchImageCharacter(args) {
      return records('patchCharacter', { characterId: args?.characterId, expected: args?.expected, patch: args?.patch })
    },
    // The figure's 人物设定图 becomes the record's character sheet; an outfit 设定图 its character×outfit sheet.
    async copyFigureSetteiToImageCharacter(args) {
      const { library, pack, figure } = await figureOf(args?.packId, args?.figureId)
      const outfit = args.outfitKey ? figure.outfits.find(item => item.key === args.outfitKey) : null
      if (args.outfitKey && !outfit) throw fail('NOT_FOUND', '服装已删除，请重新载入')
      const hash = outfit ? outfit.settei : figure.identitySettei?.board
      if (!hash) throw fail('INVALID_ARGUMENT', '还没有设定图')
      const { bytes, descriptor } = await library.readMedia({ packId: args.packId, expectedRevision: pack.revision, hash })
      const { referenceImage } = await records('putReferenceImage', { data: new Uint8Array(bytes), mediaType: descriptor.mime,
        name: figure.name + (outfit ? '／' + outfit.label : '') + ' 设定图' })
      const expected = args.expected
      const patch = !outfit ? { referenceImage } : { outfits: [{ id: outfit.key, characterOutfitImage: referenceImage,
        ...(expected?.outfits?.some(item => item.id === outfit.key) ? {} : { name: outfit.label }) }] }
      return records('patchCharacter', { characterId: args.characterId, expected, patch })
    },
  }
}
