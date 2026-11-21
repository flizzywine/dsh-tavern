import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { appearanceMove, findFigureImageCharacter, imageAliasesFromFigure, imageCharacterFromFigure, IMAGE_CHARACTER_EXTENSION, internalAliasCode, packReferenceName, referencePatch } from './domain/image-character-appearance.js'

// Where a figure's name, 触发词 and outfit names live (ADR 0010). 'registry': in its linked 配图 人物库 record; the asset
// library stores the figure without them and puts them back on every read (asset library pack-v2/figure-records.js).
// 'pack': in the pack (the figure stays whole; image-character-follow.js brings the record along). The mode is the switch
// and its way back: switching rewrites every figure document as the new mode stores it (switchFigureRecords).
export const FIGURE_RECORD_MODES = ['pack', 'registry']

const words = match => String(match ?? '').split(',').map(word => word.trim()).filter(Boolean)
// The record's view of a figure's identity, as the asset library rebuilds the figure from it.
export const recordIdentity = character => ({ name: character.name, aliases: words(character.match),
  outfits: Object.fromEntries((character.outfits || []).filter(outfit => outfit.name?.trim()).map(outfit => [outfit.id, outfit.name.trim()])) })

/** What the stored document keeps of a whole figure whose identity its record holds: everything but its name, 触发词
 *  (an actor key the record does not carry stays) and outfit names. */
export function figureWithoutIdentity(figure) {
  const { name: _, aliases, ...rest } = figure
  const kept = (aliases || []).filter(internalAliasCode)
  return { ...rest, ...(kept.length ? { aliases: kept } : {}), outfits: figure.outfits.map(({ label: __, ...outfit }) => outfit) }
}

/** A record keeps 触发词 as one comma-separated field: a figure with a 触发词 that has a comma stays whole. */
export const recordCanHold = figure => !(figure.aliases || []).some(word => word.includes(','))

/** The record patch that makes it carry the figure's identity; null when it does. A new outfit is added. */
export function recordIdentityPatch(character, figure) {
  const match = imageAliasesFromFigure(figure).join(', ')
  const outfits = figure.outfits.filter(outfit => character.outfits?.find(row => row.id === outfit.key)?.name !== outfit.label).map(outfit => ({ id: outfit.key, name: outfit.label }))
  const patch = { ...(character.name !== figure.name ? { name: figure.name } : {}), ...(character.match !== match ? { match } : {}), ...(outfits.length ? { outfits } : {}) }
  return Object.keys(patch).length ? patch : null
}

/** The record linked to a figure in the 人物库's own file ({characters}), read without the 配图 plugin running. */
export const linkedRecordIn = (definitions, { packId, figureId }) => definitions?.characters?.find(item => item.figureId === figureId && item.figurePackId === packId) || null

/** How a figure is stored when its record can only be read, not written (the 配图 plugin is off, or a local tool):
 *  without its identity when the record already carries it and the figure brings no 外貌 to move; otherwise whole,
 *  and Tavern moves it into the record once the 人物库 is back (foldWhole). */
export function storedBesideRecord(character, figure) {
  const carries = figure.identityAppearance || figure.extensions?.[IMAGE_CHARACTER_EXTENSION] || figure.outfits.some(outfit => outfit.outfitAppearance)
  return character && !carries && recordCanHold(figure) && !recordIdentityPatch(character, figure) ? figureWithoutIdentity(figure) : figure
}

// recordFile: the 人物库's definitions.json. While its plugin is off the records are read from it (read only), so figures
// keep showing, editing and exporting; an identity edited meanwhile is stored whole in the pack until the plugin is back.
export function createFigureRecords({ api, file, recordFile, log = () => {} }) {
  let fileCache = null
  async function fileRecord(ref) {
    if (!recordFile) return null
    const info = await stat(recordFile).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (!info) return null
    const key = info.mtimeMs + ':' + info.size
    if (fileCache?.key !== key) fileCache = { key, definitions: JSON.parse(await readFile(recordFile, 'utf8')) }
    return linkedRecordIn(fileCache.definitions, ref)
  }
  let mode = 'pack'
  const loaded = readFile(file, 'utf8').then(text => {
    const saved = JSON.parse(text)
    if (FIGURE_RECORD_MODES.includes(saved.mode)) mode = saved.mode
  }, error => { if (error.code !== 'ENOENT') log('人物资料存放方式读取失败，按素材包保存：' + error.message) })
  // Record writes made here, during a pack write: the 人物库's linked-figure hook must not write that pack again.
  const own = new AsyncLocalStorage()
  const adopting = new Map() // packId → figure ids whose carried 外貌 replaces their record's on the next write
  const patch = (state, recordPatch) => api.imageCharacters('patchCharacter', { providerId: state.providerId, characterId: state.character.id, expected: state.character, patch: recordPatch })
  const reference = async (state, name, { bytes, mime }) => (await api.imageCharacters('putReferenceImage', { providerId: state.providerId, data: new Uint8Array(bytes), mediaType: mime, name })).referenceImage

  // The record takes the figure's identity, then (as the follower did after a write) the 外貌 and 参考图 the figure carries
  // and the 设定图 it has where the record has no 参考图. Returns the figure without what moved into the record.
  async function keep(state, packId, figure, media) {
    const replace = !!figure.extensions?.[IMAGE_CHARACTER_EXTENSION] && !!adopting.get(packId)?.delete(figure.id)
    const move = appearanceMove(state.character, figure, { replace })
    for (const row of move?.references || []) {
      const outfit = row.outfit ? figure.outfits.find(item => item.key === row.outfit) : null
      if (row.outfit && !outfit) continue
      const referenceImage = await reference(state, row.name || packReferenceName(figure, outfit, ' 参考图'), await media(row.media))
      state = await patch(state, referencePatch(state.character, outfit, referenceImage))
    }
    const sheets = [...(figure.identitySettei?.board && !state.character.referenceImage ? [{ outfit: null, hash: figure.identitySettei.board }] : []),
      ...figure.outfits.filter(outfit => outfit.settei && !state.character.outfits?.some(row => row.id === outfit.key && row.characterOutfitImage)).map(outfit => ({ outfit, hash: outfit.settei }))]
    for (const { outfit, hash } of sheets) state = await patch(state, referencePatch(state.character, outfit, await reference(state, packReferenceName(figure, outfit), await media(hash))))
    if (move?.record) state = await patch(state, move.record)
    if (move?.dropped.length) log('「' + figure.name + '」素材包里的外貌文字与配图人物库不同，以人物库为准：' + move.dropped.map(row => row.text).join(' / ').slice(0, 200))
    const rest = move ? { ...figure, ...move.figure } : figure
    for (const key of ['identityAppearance', 'extensions']) if (rest[key] === null) delete rest[key]
    return figureWithoutIdentity(rest)
  }

  return {
    async mode() { await loaded; return mode },
    async setMode(next) {
      if (!FIGURE_RECORD_MODES.includes(next)) throw Object.assign(new Error('人物资料存放方式只能是 pack 或 registry'), { code: 'INVALID_ARGUMENT' })
      await loaded
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file + '.tmp', JSON.stringify({ version: 1, mode: next, switchedAt: new Date().toISOString() }) + '\n')
      await rename(file + '.tmp', file)
      mode = next
    },
    /** A record write this module is making right now (a pack write in progress). */
    writing: () => own.getStore() === true,
    adopt({ packId, figureIds }) { if (figureIds.length) adopting.set(packId, new Set(figureIds)); else adopting.delete(packId) },
    // The asset library's figureRecords (storage.js): read, write, release.
    async read({ packId, figureId }) {
      const state = await findFigureImageCharacter(api, { packId, figureId })
      if (state.status === 'unavailable') { const character = await fileRecord({ packId, figureId }); return character && recordIdentity(character) }
      return state.status === 'linked' ? recordIdentity(state.character) : null
    },
    async write({ packId, figureId, figure, intent, media }) {
      await loaded
      if (mode !== 'registry' || intent === 'released' || !recordCanHold(figure)) return figure
      if (intent === 'held') return figureWithoutIdentity(figure)
      let state = await findFigureImageCharacter(api, { packId, figureId })
      if (state.status === 'unavailable') return storedBesideRecord(await fileRecord({ packId, figureId }), figure)
      if (state.status === 'unlinked' && state.libraries.length !== 1) return figure
      return own.run(true, async () => {
        if (state.status === 'unlinked') state = await api.imageCharacters('createCharacter', { providerId: state.libraries[0].providerId, character: imageCharacterFromFigure(figure, packId) })
        else {
          const identity = recordIdentityPatch(state.character, figure)
          if (identity) state = await patch(state, identity)
        }
        return keep(state, packId, figure, media)
      })
    },
    // The 人物库 is back: figures stored whole meanwhile (an identity edited while it was off, a figure made then) move into
    // their records, the pack's value winning as on any write. Only packs holding such a figure are written.
    async foldWhole(library) {
      await loaded
      if (mode !== 'registry' || !(await api.imageCharacterLibraries()).length) return []
      const packIds = []
      for (const row of await library.figureDocumentForms()) {
        if (!row.whole.length) continue
        const pack = await library.getPackSnapshot({ packId: row.packId })
        for (const figureId of row.whole) {
          const figure = pack.figures[figureId]
          if (!figure || !recordCanHold(figure)) continue
          const state = await findFigureImageCharacter(api, { packId: row.packId, figureId })
          if (state.status === 'linked' || state.status === 'unlinked' && state.libraries.length === 1) { packIds.push(row.packId); break }
        }
      }
      if (packIds.length) await library.rewriteFigureDocuments({ packIds })
      return packIds
    },    // A figure a write removed (deleted, or its pack uninstalled) leaves its record as an ordinary one: the link ends,
    // the record keeps the name and 外貌 (「一起删除」 deletes the record before the figure goes).
    async release({ packId, figureIds }) {
      await loaded
      if (mode !== 'registry') return
      await own.run(true, async () => {
        for (const figureId of figureIds) {
          const state = await findFigureImageCharacter(api, { packId, figureId })
          if (state.status === 'linked') await patch(state, { figureId: null, figurePackId: null })
        }
      })
    },
  }
}
