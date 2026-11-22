import {cardFigureRows} from './card-stage.js'
import {selectPackFigure} from './domain/asset-pack-presentation.js'
import {figureDefaultEmotion, STANDARD_FIGURE_EMOTIONS} from '../../dsh-asset-library/lib/asset-packs/figure-emotions.js'
import {castingVoiceKey} from '../../dsh-asset-library/lib/pack-v2/library-search.js'
import voiceAutoCastRule from '../../dsh-asset-library/lib/shared/voice-auto-cast.cjs'

const {voiceAutoCast, readingPackIds} = voiceAutoCastRule

// 自动选角's one port to the asset library and the shared figure records: the library's
// automatic writer `auto-cast` for context, whole-library search (figures and 通用声音) and writes. A library without that writer leaves writable() false: nothing runs.
// getReading: tts.reading() (null without the TTS plugin); the packs 通用声音 / 旁白 point at hold 通用声音 too.
export function createAutoCastLibrary({getLibrary, getReading = () => null}) {
  let owner, writer = null
  const systemPacks = () => readingPackIds(getReading())
  function port() {
    const library = getLibrary()
    if (!library) return null
    if (owner !== library) {
      writer?.dispose(); owner = library
      try { writer = library.registerAutomaticWriter({writerId:'auto-cast', plan:({context}) => context.changes}) } catch { writer = null }
    }
    return writer && {library, writer}
  }
  // A figure's own 立绘 are the emotions the stage shows with their own picture (not a stand-in). A figure 自动建人物 created
  // before figures came with the standard 差分 has none: the library gives them with its next automatic change (its 人设图), so
  // its lines are counted against those (else they ask for nothing and it is never drawn).
  const figuresOf = pack => Object.entries(pack?.figures || {}).map(([figureId, figure]) => {
    const ref = {packId:pack.manifest.id, figureId}, emotions = figure.emotions?.length ? figure.emotions : STANDARD_FIGURE_EMOTIONS
    const sprites = (figure.emotions || []).map(row => row.id).filter(emotion => selectPackFigure(figure, pack.sprites || {}, {emotion, appearance:'sprite'}).spriteResolution?.resolvedEmotion === emotion)
    return {ref, name:figure.name, aliases:figure.aliases || [], emotions, defaultEmotion:(figure.emotions?.length ? figureDefaultEmotion(figure, figure.outfits?.find(outfit => outfit.enabled)) : emotions[0].id) ?? null, settei:!!figure.identitySettei?.board, setteiHash:figure.identitySettei?.board ?? null, sprites}
  })
  return {
    writable:() => !!port(),
    // The card as the writer reads it: its id, its whole cast (the shared resolver's rows) and its automatic pack's figures
    // (none before the first write). null while the automatic pack is detached from the card.
    async readCast(cardPath) {
      const {library, writer} = port()
      const context = await writer.readContext({path:cardPath})
      if (context.detached) return null
      const pack = context.target ? await library.getPackSnapshot({packId:context.target.packId}) : null
      const rows = cardFigureRows({raw:context.card.raw, snapshots:context.packs, globalEnabledPackIds:context.globalEnabledPackIds})
      const byPack = new Map(context.packs.map(snapshot => [snapshot.manifest.id, snapshot.manifest.voiceLibrary?.voices]))
      const voiceKeys = new Set(rows.map(({ref, figure}) => castingVoiceKey(byPack.get(ref.packId)?.[figure.voice?.voice], figure.voice)).filter(Boolean))
      return {cardId:context.card.cardId, missingPackIds:context.missingPackIds, packId:pack?.manifest.id ?? null, revision:pack?.revision ?? null, raw:context.card.raw, rows, voiceKeys, figures:figuresOf(pack)}
    },
    search:query => port().writer.searchLibrary({query, limit:8, systemPacks:systemPacks()}),
    // The library's 通用人物原型, a new person's 借用形象 is lent from: an enabled figure with a stage form whose own voice is a
    // 通用声音 (the 通用角色 archetypes), in a pack no automatic writer owns (never another card's person).
    async lendable() {
      const rows = [], system = systemPacks()
      for (const pack of await port().library.listPacks()) {
        if (!pack.manifest || pack.automatic) continue
        for (const figureId of pack.manifest.figures) {
          const figure = pack.figures?.[figureId], voice = pack.manifest.voiceLibrary?.voices?.[figure?.voice?.voice]
          if (!figure?.enabled || !voice || !voiceAutoCast(voice, pack.manifest.id, system) || !figure.outfits.some(outfit => outfit.enabled && (outfit.sprite || outfit.live2d || outfit.spine))) continue
          rows.push({packId:pack.manifest.id, figureId, name:figure.name, heightCm:figure.heightCm ?? null})
        }
      }
      return rows
    },
    // every library 通用声音 (the assistant reads them all rather than guess the words of their names).
    libraryVoices:() => port().writer.listLibraryVoices({limit:60, systemPacks:systemPacks()}),
    // A picture by its hash (content-addressed): read at the pack's current revision, so a landing of another picture
    // between the queue's read and this one does not fail the job (11-12 验收: a 立绘 lost to REVISION_CONFLICT).
    async readMedia({packId, hash}) {
      const {library} = port(), {revision} = await library.getPackSnapshot({packId})
      return Buffer.from((await library.readMedia({packId, expectedRevision:revision, hash})).bytes)
    },
    // One automatic write: changes (op create / copy / patch, with voice, settei, sprites), images {key: PNG bytes}; `sources`:
    // the other packs a copy or a voice comes from [{packId, revision}] (from the search). source: the round it serves.
    async write({cardPath, changes, images, sources = [], source, requestId}) {
      const {library, writer} = port()
      for (let attempt = 0; ; attempt++) {
        const context = await writer.readContext({path:cardPath})
        const catalogue = new Map([...context.packs.map(pack => [pack.manifest.id, pack.revision]), ...sources.map(row => [row.packId, row.revision])])
        const input = {path:cardPath, expectedCardRevision:context.card.revision, target:context.target, catalogueRevisions:[...catalogue].map(([packId, revision]) => ({packId, revision})),
          requestId, source:{kind:'auto-cast', occurrenceId:requestId}, changes, ...(images ? {images} : {})}
        try { return await library.writeAutomaticItems(input, writer.authorize(input, source, {changes})) }
        catch (error) { if (error.code !== 'REVISION_CONFLICT' || attempt === 1) throw error }
      }
    },
    dispose() { writer?.dispose(); writer = null; owner = null },
  }
}

