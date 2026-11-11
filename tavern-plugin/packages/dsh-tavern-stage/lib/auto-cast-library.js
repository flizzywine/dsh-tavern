import {cardFigureRows} from './card-stage.js'
import {selectPackFigure} from './domain/asset-pack-presentation.js'
import {figureDefaultEmotion} from '../../dsh-asset-library/lib/asset-packs/figure-emotions.js'
import {serviceVoiceSpec} from './figure-voice-authoring.js'

// 自动选角's one port to the asset library and the shared figure records: the library's
// automatic writer `auto-cast` for context, whole-library search and writes; the
// 配音后端's offered voices (read only). A library without that writer leaves writable() false: nothing runs.
export function createAutoCastLibrary({getLibrary, getTts = () => null}) {
  let owner, writer = null
  function port() {
    const library = getLibrary()
    if (!library) return null
    if (owner !== library) {
      writer?.dispose(); owner = library
      try { writer = library.registerAutomaticWriter({writerId:'auto-cast', plan:({context}) => context.changes}) } catch { writer = null }
    }
    return writer && {library, writer}
  }
  // A figure's own 立绘 are the emotions the stage shows with their own picture (not a stand-in).
  const figuresOf = pack => Object.entries(pack?.figures || {}).map(([figureId, figure]) => {
    const ref = {packId:pack.manifest.id, figureId}
    const sprites = (figure.emotions || []).map(row => row.id).filter(emotion => selectPackFigure(figure, pack.sprites || {}, {emotion, appearance:'sprite'}).spriteResolution?.resolvedEmotion === emotion)
    return {ref, name:figure.name, aliases:figure.aliases || [], emotions:figure.emotions || [], defaultEmotion:figureDefaultEmotion(figure, figure.outfits?.find(outfit => outfit.enabled)) ?? null, settei:!!figure.identitySettei?.board, setteiHash:figure.identitySettei?.board ?? null, sprites}
  })
  // What a cast figure speaks with, as provider:voiceName of its source (a 配音后端 voice is checked against it).
  const spokenSources = (rows, packs) => new Set(rows.flatMap(row => {
    const binding = row.figure?.voice, voice = binding && packs.find(pack => pack.manifest.id === row.ref.packId)?.manifest.voiceLibrary?.voices?.[binding.voice]
    const source = voice && binding.source !== null && voice.sources[binding.source ?? voice.defaultSource]
    return source?.voiceName ? [voiceSourceKey(source)] : []
  }))
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
      return {cardId:context.card.cardId, packId:pack?.manifest.id ?? null, revision:pack?.revision ?? null, raw:context.card.raw, rows, figures:figuresOf(pack), spoken:spokenSources(rows, context.packs)}
    },
    search:query => port().writer.searchLibrary({query, limit:8}),
    // The 配音后端's voices ready to speak now ([] without the service), and one as a pack voice spec.
    async backendVoices() {
      const tts = getTts()
      return tts ? (await tts.listServiceVoices()).filter(voice => voice.state === 'ready').map(voice => ({voiceId:voice.id, name:voice.label || voice.id, languages:voice.languages || []})) : []
    },
    async backendVoiceSpec(voiceId, language) { return (await serviceVoiceSpec(getTts(), voiceId, language)).voice },
    async readMedia({packId, expectedRevision, hash}) {
      return Buffer.from((await port().library.readMedia({packId, expectedRevision, hash})).bytes)
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

export const voiceSourceKey = source => source.provider + ':' + source.voiceName
