import { appearanceMove, findFigureImageCharacter, identityPatchFromFigure, imageCharacterFromFigure, IMAGE_CHARACTER_EXTENSION, packReferenceName, putPackReference, referencePatch } from './domain/image-character-appearance.js'

// 方案甲: a figure's name and 触发词 live in its pack; its linked 配图 人物库 record shows them. After every pack write the
// records of that pack's figures are brought along;
// a figure the write created gets its record (the only one: installs and copies never reuse a record by name); a figure
// the write removed (deleted, or its pack uninstalled) leaves its record as an ordinary one: the link ends, the 外貌 stays
// (「一起删除」 deletes the record before the figure goes). 外貌 a written pack carries (an exported or copied
// figure's dsh.image-character extension, older single texts) moves into the record and out of the pack (appearanceMove):
// the record is its one home. An update never overwrites the local 外貌 unless its preview chose 「用导入的外貌」 for the
// figure: the asset library says so (adopt) before writing, and that figure's carried 外貌 then replaces the record's.
export function followImageCharacters({ library, api, log = () => {} }) {
  const seen = new Map() // packId → {ids} at the last follow
  const adopting = new Map() // packId → figure ids whose next carried 外貌 replaces their record's
  const remember = (packId, figures) => seen.set(packId, { ids: new Set(figures.map(f => f.id)) })
  const listed = () => library.listPacks()
  const figuresOf = packs => packs.filter(pack => pack.manifest)
    .flatMap(pack => Object.values(pack.figures).map(figure => ({ packId: pack.manifest.id, figure })))
  let queue = listed().then(async packs => {
    const groups = Map.groupBy(figuresOf(packs), item => item.packId)
    for (const [packId, items] of groups) remember(packId, items.map(item => item.figure))
    // a pack with a 人设图 or 服装设定图 that may not be its record's 参考图 yet (drawn or installed before this follow set them) is followed once
    for (const [packId, items] of groups) if (items.some(item => item.figure.identitySettei?.board || item.figure.outfits?.some(outfit => outfit.settei))) await follow(packId)
  }).catch(error => log('配图人物库跟随素材包失败：' + (error?.message || error)))
  async function release(packId, figureId) {
    const state = await findFigureImageCharacter(api, { packId, figureId })
    if (state.status === 'linked') await api.imageCharacters('patchCharacter', { providerId: state.providerId, characterId: state.character.id, expected: state.character, patch: { figureId: null, figurePackId: null } })
  }
  async function follow(packId) {
    const packs = await listed(), current = figuresOf(packs).filter(item => item.packId === packId), before = seen.get(packId)
    // an unreadable pack is not an empty one: its figures are not gone
    if (packs.some(pack => !pack.manifest && pack.packId === packId)) return
    if (current.length) remember(packId, current.map(item => item.figure)); else seen.delete(packId)
    for (const figureId of before?.ids || []) if (!current.some(item => item.figure.id === figureId)) await release(packId, figureId)
    const moves = []
    for (const item of current) {
      let state = await findFigureImageCharacter(api, { packId: item.packId, figureId: item.figure.id })
      if (state.status === 'unavailable') return
      if (state.status === 'unlinked') {
        if (before?.ids.has(item.figure.id) || state.libraries.length !== 1) continue
        state = await api.imageCharacters('createCharacter', { providerId: state.libraries[0].providerId, character: imageCharacterFromFigure(item.figure, item.packId) })
      } else {
        const patch = identityPatchFromFigure(state.character, item.figure)
        if (patch) state = await api.imageCharacters('patchCharacter', { providerId: state.providerId, characterId: state.character.id, expected: state.character, patch })
      }
      // Any figure with a 人设图 (自动素材's, the owner's, an installed pack's alike) has it as its record's 参考图, and each
      // outfit with a 服装设定图 has it as that outfit's (as 「设定图→参考图」 would), so 场景配图 draws the person of its 立绘
      // in the clothes of its 立绘. A record, or an outfit, that has one keeps it.
      const revision = packs.find(pack => pack.manifest?.id === packId).revision
      const sheets = [...(item.figure.identitySettei?.board && !state.character.referenceImage ? [{ outfit: null, hash: item.figure.identitySettei.board }] : []),
        ...(item.figure.outfits || []).filter(outfit => outfit.settei && !state.character.outfits?.some(row => row.id === outfit.key && row.characterOutfitImage)).map(outfit => ({ outfit, hash: outfit.settei }))]
      for (const { outfit, hash } of sheets) {
        const referenceImage = await putPackReference(api, library, { providerId: state.providerId, packId, revision, hash, name: packReferenceName(item.figure, outfit) })
        state = await api.imageCharacters('patchCharacter', { providerId: state.providerId, characterId: state.character.id, expected: state.character, patch: referencePatch(state.character, outfit, referenceImage) })
      }
      const replace = !!item.figure.extensions?.[IMAGE_CHARACTER_EXTENSION] && !!adopting.get(packId)?.delete(item.figure.id)
      const move = appearanceMove(state.character, item.figure, { replace })
      if (!move) continue
      if (move.record) await api.imageCharacters('patchCharacter', { providerId: state.providerId, characterId: state.character.id, expected: state.character, patch: move.record })
      if (move.dropped.length) log('「' + item.figure.name + '」素材包里的外貌文字与配图人物库不同，以人物库为准：' + move.dropped.map(row => row.text).join(' / ').slice(0, 200))
      moves.push({ figureId: item.figure.id, patch: move.figure })
    }
    if (!moves.length) return
    let revision = packs.find(pack => pack.manifest?.id === packId).revision
    for (const { figureId, patch } of moves) revision = (await library.patchFigure({ packId, expectedRevision: revision, figureId, patch })).snapshot.revision
  }
  const off = library.subscribe(event => {
    queue = queue.then(() => follow(event.packId)).catch(error => log('配图人物库跟随素材包失败：' + (error?.message || error)))
  })
  return { dispose: off, settled: () => queue,
    adopt({ packId, figureIds }) { if (figureIds.length) adopting.set(packId, new Set(figureIds)); else adopting.delete(packId) } }
}
