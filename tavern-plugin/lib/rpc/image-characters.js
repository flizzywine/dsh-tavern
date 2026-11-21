import { isDeepStrictEqual } from 'node:util'
import { figureOutfitReference } from '../domain/figure-sprite-reference.js'
import { imageCharacterFromFigure, linkPatchFromFigure, findFigureImageCharacter, putPackReference, packReferenceName, referencePatch } from '../domain/image-character-appearance.js'

// The image plugin owns these records. Asset-pack edits never store a second copy.
export function createImageCharacterHandlers({ ctx, pluginApi }) {
  const records = (op, input) => pluginApi.imageCharacters(op, input)
  const fail = (code, message) => Object.assign(new Error(message), { code })
  const links = new Map()
  async function figureOf(packId, figureId) {
    if (typeof packId !== 'string' || !packId || typeof figureId !== 'string' || !figureId) throw fail('INVALID_ARGUMENT', '请选择素材包和人物')
    const library = ctx.get('assetLibrary')
    if (!library) throw fail('ASSET_UNAVAILABLE', '素材库未启用')
    const pack = await library.getPackSnapshot({ packId })
    const figure = pack?.figures[figureId]
    if (!figure) throw fail('NOT_FOUND', '人物已删除，请重新载入')
    return { library, pack, figure }
  }
  async function linkedRecord(args) {
    const context = await figureOf(args?.packId, args?.figureId)
    if (typeof args.providerId !== 'string' || !args.providerId) throw fail('INVALID_ARGUMENT', '请选择人物库来源')
    const record = await records('getCharacter', { providerId: args.providerId, characterId: args.characterId })
    if (record.character.figureId !== args.figureId || record.character.figurePackId !== args.packId || args.expected?.id !== record.character.id) throw fail('INVALID_ARGUMENT', '人物关联已改变，请重新载入')
    if (!isDeepStrictEqual(record.character, args.expected)) throw fail('REVISION_CONFLICT', '人物已在别处修改，请重新载入后再改')
    return { ...context, ...record }
  }
  // A figure just linked keeps its identity in the record from now on (when the records hold identities).
  async function storeLinked(packId) {
    if (await ctx.get('tavernFigureRecords')?.mode() === 'registry') await ctx.get('assetLibrary').rewriteFigureDocuments({ packIds: [packId] })
  }
  return {
    // Where figures keep their name, 触发词 and outfit names: 'registry' (the 配图 人物库 record) or 'pack' (the way back).
    // Every installed figure is written again as the mode stores it; the figures readers see do not change.
    async switchFigureRecords(args) {
      const records = ctx.get('tavernFigureRecords'), library = ctx.get('assetLibrary')
      if (!records || !library) throw fail('ASSET_UNAVAILABLE', '素材库未启用')
      if (args?.mode === 'registry' && !(await pluginApi.imageCharacterLibraries()).length) throw fail('NOT_CONFIGURED', '配图人物库不可用，不能把人物资料交给它')
      await records.setMode(args?.mode)
      const packIds = (await library.listPackSummaries()).filter(row => !row.error && row.counts?.figures).map(row => row.packId)
      const rewritten = []
      for (const packId of packIds) rewritten.push(...(await library.rewriteFigureDocuments({ packIds: [packId] })).rewritten)
      return { mode: await records.mode(), rewritten }
    },
    // Read-only: the mode and how each installed figure is stored (whole, or without its identity).
    async figureRecordsMode() {
      const library = ctx.get('assetLibrary')
      if (!library) throw fail('ASSET_UNAVAILABLE', '素材库未启用')
      return { mode: await ctx.get('tavernFigureRecords')?.mode() ?? 'pack', packs: await library.figureDocumentForms() }
    },
    async getFigureImageCharacter(args) {
      await figureOf(args?.packId, args?.figureId)
      const value = await findFigureImageCharacter(pluginApi, args)
      if (value.status !== 'unlinked') return value
      const lists = await Promise.all(value.libraries.map(({ providerId }) => pluginApi.listImageLibrary('characters', { providerId, limit: 200 })))
      return { ...value, candidates: lists.flatMap(list => list.items).slice(0, 200)
        .map(item => ({ providerId: item.providerId, providerLabel: item.providerLabel, id: item.id, name: item.name })) }
    },
    // Serialize association creation per figure, including the check across different providers.
    linkFigureImageCharacter(args) {
      const key = JSON.stringify([args?.packId, args?.figureId])
      const run = (links.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
        const { figure } = await figureOf(args?.packId, args?.figureId)
        const linked = await findFigureImageCharacter(pluginApi, args)
        if (linked.status === 'linked') {
          if (args.characterId && (args.characterId !== linked.character.id || args.providerId !== linked.providerId)) throw fail('INVALID_ARGUMENT', '人物已关联其他记录，请重新载入')
          return linked
        }
        if (!args.characterId) await records('createCharacter', { providerId: args.providerId, character: imageCharacterFromFigure(figure, args.packId) })
        else {
          if (!args.providerId) throw fail('INVALID_ARGUMENT', '关联已有记录时必须指定人物库来源')
          const { character } = await records('getCharacter', { providerId: args.providerId, characterId: args.characterId })
          if (character.figureId && (character.figureId !== args.figureId || character.figurePackId !== args.packId)) throw fail('INVALID_ARGUMENT', '该人物库记录已关联其他素材库人物')
          await records('patchCharacter', { providerId: args.providerId, characterId: character.id, expected: character, patch: linkPatchFromFigure(character, figure, args.packId) })
        }
        await storeLinked(args.packId)
        return findFigureImageCharacter(pluginApi, args)
      })
      links.set(key, run)
      run.finally(() => { if (links.get(key) === run) links.delete(key) }).catch(() => {})
      return run
    },
    // 删除人物时「一起删除」生图外貌: the linked record goes first, then the client removes the figure.
    async deleteFigureImageCharacter(args) {
      await linkedRecord(args)
      return records('deleteCharacter', { providerId: args.providerId, characterId: args.characterId, expected: args.expected })
    },
    async patchImageCharacter(args) {
      await linkedRecord(args)
      if (args.patch && (Object.hasOwn(args.patch, 'figureId') || Object.hasOwn(args.patch, 'figurePackId'))) throw fail('INVALID_ARGUMENT', '请通过关联操作选择人物')
      return records('patchCharacter', { providerId: args.providerId, characterId: args.characterId, expected: args.expected, patch: args.patch })
    },
    async copyFigureSetteiToImageCharacter(args) {
      const { library, pack, figure, character } = await linkedRecord(args)
      const outfit = args.outfitKey ? figure.outfits.find(item => item.key === args.outfitKey) : null
      if (args.outfitKey && !outfit) throw fail('NOT_FOUND', '服装已删除，请重新载入')
      const spriteFallback = args.spriteFallback === true
      if (spriteFallback && (!outfit || outfit.settei || character.outfits.some(item => item.id === outfit.key && item.characterOutfitImage))) throw fail('INVALID_ARGUMENT', '已有参考图或设定图，不可覆盖')
      const fallback = spriteFallback ? figureOutfitReference(pack, figure, outfit) : null
      const hash = spriteFallback ? fallback?.hash : outfit ? outfit.settei : figure.identitySettei?.board
      if (!hash) throw fail('INVALID_ARGUMENT', '还没有设定图')
      const referenceImage = await putPackReference(pluginApi, library, { providerId: args.providerId, packId: args.packId, revision: pack.revision, hash,
        name: packReferenceName(figure, outfit, spriteFallback ? {sprite:' 立绘参考', emotion:' 差分参考', avatar:' 头像参考'}[fallback.kind] : undefined) })
      return records('patchCharacter', { providerId: args.providerId, characterId: args.characterId, expected: args.expected, patch: referencePatch(character, outfit, referenceImage) })
    },
  }
}
