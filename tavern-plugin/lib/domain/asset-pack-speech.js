// each figure registers its own immutable, pack-scoped portable preset.
import { effectiveCardStage, effectiveNarrator } from './card-stage-settings.js'
import { assetPackDigest } from '../../packages/dsh-tavern-stage/lib/domain/stage-asset-pack-catalogue.js'
import { figureTtsVoice, assetVoiceBinding, browserSpeechSource } from './figure-voice.js'
const failure = code => Object.assign(new Error(code), {code})
// The key the narrator's voice opens under (旁白配音); never a figure name, so it cannot resolve to a cast member.
export const NARRATOR_VOICE = '\u0000narrator'
// The key the 通用声音 (tts.reading().general.figure) opens under: one shared entry for every temporary NPC and
// every enabled figure without a voice binding, and the reader of 全文朗读.
export const GENERAL_VOICE = '\u0000general'

export function createAssetPackSpeech({presentation, getEngine, getTts, getBinding, getLibrary, scope, principal = 'dsh-browser', readOnly: onlyCached = false}) {
  if (!presentation) return null
  const entries = new Map(), pending = new Map(), listeners = new Set()
  // Prewarms go out one at a time (each reads a voice's reference audio); the local worker queues them behind lines.
  let current, offTts, disposed = false, epoch = 0, warming = Promise.resolve(), casting = Promise.resolve()
  const emit = event => { for (const listener of listeners) listener(event) }
  function clear() {
    epoch++; pending.clear()
    for (const entry of entries.values()) { entry.grant.dispose(); entry.source.dispose() }
    entries.clear(); emit({type:'invalidated'})
  }
  // Recheck author data on open; visual-only publications must not abort playing speech.
  const offPresentation = presentation.subscribe(event => {
    if (!event || event.scope?.authority || event.reason === 'bindings-changed' || event.kind === 'revoked' && presentation.extension.assetBindings.boundPackIds.includes(event.scope?.packId)) clear()
    else {
      epoch++; pending.clear(); emit({type:'invalidated'})
      // Revalidate existing grants after author edits, even before the next browser request.
      for (const alias of entries.keys()) queueMicrotask(() => { if (!disposed) void api.open(alias) })
    }
  })
  function tts() {
    if (disposed) throw failure('TTS_UNAVAILABLE')
    const next = getTts()
    if (next !== current) {
      offTts?.(); clear(); current = next
      offTts = current?.apiVersion === 1 ? current.subscribe(event => {
        if (['disposed','providerChanged','providerRemoved','cacheInvalidated','readingChanged'].includes(event.type)) clear()
      }) : undefined
    }
    if (current?.apiVersion !== 1) throw failure('TTS_UNAVAILABLE')
    return current
  }
  // The figure's declared voice, or null when she has none here (voice off on this card, unknown name, figure off, no voice).
  async function declared(alias) {
    const engine = getEngine?.(), stage = effectiveCardStage(presentation.extension, engine)
    // 通用声音 / 旁白 speak with the figure tts.reading() points at (any installed pack, enabled or not), exactly as that
    // figure speaks on a card; none chosen = the browser's default voice. 旁白's switch: the card layer over tts.reading().narrator.
    if (alias === GENERAL_VOICE || alias === NARRATOR_VOICE) {
      if (!stage.voice) return null
      const tts = getTts(), reading = tts?.apiVersion === 1 ? tts.reading() : null
      if (alias === NARRATOR_VOICE && !effectiveNarrator(presentation.extension, reading?.narrator).enabled) return null
      return pointed(alias === GENERAL_VOICE ? reading?.general.figure : reading?.narrator.figure)
    }
    if (!stage.voice) return null
    const resolvedName = await presentation.resolveName(alias), ref = resolvedName.ref
    if (resolvedName.status !== 'resolved' || !ref) return null
    const resolved = await presentation.resolveFigure(ref)
    return resolved.value?.enabled && resolved.value.voice ? {ref, resolved} : null
  }
  async function pointed(ref) {
    if (!ref) return {browserDefault:true}
    const pack = await getLibrary().getPackSnapshot({packId:ref.packId}), figure = pack?.figures[ref.figureId]
    const voiceSpec = figure?.voice && pack.manifest.voiceLibrary?.voices[figure.voice.voice]
    return voiceSpec ? {ref, resolved:{value:figure, voiceSpec}, pack} : null
  }
  async function prepare(alias, service, generation, readOnly) {
    const drop = () => {
      const old = entries.get(alias)
      if (old) { old.grant.dispose(); old.source.dispose(); entries.delete(alias) }
    }
    const found = await declared(alias)
    if (!found) { drop(); return {available:false,diagnostics:['voice-unbound']} }
    if (disposed || epoch !== generation || getTts() !== service) throw failure('TTS_STALE')
    if (found.browserDefault) { drop(); return {available:true,browser:{voice:''},voiceId:'browser',language:'zh',scope,diagnostics:[]} }
    const {ref, resolved} = found, figure = resolved.value
    const voice = figureTtsVoice(figure.voice, resolved.voiceSpec, `${ref.packId}:${ref.figureId}`, figure.emotions)
    // Browser speech: the browser speaks with the named system voice (none named = the system default); nothing is bound or registered.
    const spoken = browserSpeechSource(resolved.voiceSpec, figure.voice)
    if (spoken) {
      drop()
      return {available:true,browser:{voice:spoken.voiceName ?? ''},voiceId:figure.voice.voice,language:voice.languages[0],scope,diagnostics:[]}
    }
    const declaration = {voice:resolved.voiceSpec,binding:figure.voice}
    const binding = getBinding ? await getBinding(ref, declaration, {readOnly}) : await assetVoiceBinding(service, declaration, {readOnly})
    if (!binding) throw failure('SERVICE_REQUIRED')
    // readings are the global active preset, applied (and part of the line
    // identity) inside dsh-tts. The empty `readings` keeps every figure's source id — and so its cached audio — unchanged.
    const revision = assetPackDigest({voice,readings:[],binding,id:figure.voice.voice,language:voice.languages[0]})
    return register(alias, service, generation, {voice, binding, revision, sourceId:`figure:${ref.packId}:${ref.figureId}:${revision}`, voiceId:figure.voice.voice,
      // a pointed figure (通用声音 / 旁白) may be in a pack this card does not use: its clips come from the library.
      readReference:found.pack ? async hash => (await getLibrary().readMedia({packId:ref.packId, expectedRevision:found.pack.revision, hash})).bytes :
        async hash => presentation.readReference(ref, (await presentation.resolveFigure(ref)).revision, hash)})
  }
  // Registers the voice as this alias's source and grant (kept while its source id is unchanged).
  function register(alias, service, generation, {voice, binding, revision, sourceId, voiceId, readReference}) {
    if (disposed || epoch !== generation || getTts() !== service) throw failure('TTS_STALE')
    const previous = entries.get(alias)
    if (previous?.voice.source === sourceId) return previous.public
    if (previous) { previous.grant.dispose(); previous.source.dispose(); entries.delete(alias) }
    const source = service.registerVoiceSource({owner:'dsh-tavern', sourceId, revision, voices:[voice],
      bindings:{voice:binding.serviceId}, readReference})
    let grant
    try {
      grant = service.grantConsumer({principal, source:sourceId, scope})
      if (disposed || epoch !== generation || getTts() !== service) throw failure('TTS_STALE')
      const entry = {source, grant, voice:{source:sourceId,id:'voice'}, public:{available:true,voice:{source:sourceId,id:'voice'},voiceId,language:voice.languages[0],scope,diagnostics:[]}}
      entries.set(alias,entry)
      return entry.public
    } catch (error) { grant?.dispose(); source.dispose(); throw error }
  }
  const api = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    // Whether she has a voice to open here (the 'voice-unbound' answer of open, without binding or registering anything).
    async voiced(alias) { return Boolean(await declared(alias)) },
    async open(alias, {readOnly = onlyCached} = {}) {
      try {
        const service = tts(), generation = epoch, pendingKey = JSON.stringify([alias,readOnly])
        if (!pending.has(pendingKey)) {
          const promise = prepare(alias,service,generation,readOnly).catch(error => {
            // an unavailable replacement must revoke the browser's old scoped ref.
            // A superseded request cannot revoke a newer generation's successful registration.
            if (epoch === generation) {
              const old = entries.get(alias)
              if (old) { old.grant.dispose(); old.source.dispose(); entries.delete(alias) }
            }
            throw error
          })
          pending.set(pendingKey,promise)
          promise.finally(() => { if (pending.get(pendingKey) === promise) pending.delete(pendingKey) }).catch(() => {})
        }
        const descriptor = await pending.get(pendingKey), entry = entries.get(alias)
        // The first live open of a voice (prewarmCast at session start, or the stage prefetching a line) warms it on a
        // local worker in the background; never awaited by a line.
        if (!readOnly && descriptor.available && entry && !entry.prewarmed && service.prewarm) {
          entry.prewarmed = true
          warming = warming.then(() => service.prewarm({voice:entry.voice,language:descriptor.language}, {scope,grant:entry.grant.grant})).catch(() => {})
        }
        return structuredClone(descriptor)
      } catch (error) { return {available:false,diagnostics:[error.code || 'TTS_UNAVAILABLE']} }
    },
    // Opens (and so warms) every enabled reference-voice figure of the card's bound packs when the session's speech
    // starts, so a changed or new voice is encoded before its first line rather than while that line waits. Only
    // reference voices can be warmed, so no other service is probed. Resolves when every prewarm has been sent.
    prewarmCast() {
      casting = casting.then(async () => {
        if (disposed || !presentation.figureRows) return
        const bound = new Set(presentation.extension.assetBindings?.boundPackIds || [])
        for (const row of await presentation.figureRows()) {
          if (disposed) return
          if (!bound.has(row.ref.packId) || row.enabled === false || !row.figure?.voice) continue
          const spec = (await presentation.resolveFigure(row.ref)).voiceSpec
          if (spec?.sources?.[row.figure.voice.source ?? spec.defaultSource]?.kind === 'reference-list') await api.open(row.actorKey)
        }
      }).catch(() => {})
      return casting.then(() => warming)
    },
    async serviceState(alias) {
      const selected = await api.open(alias, {readOnly:true})
      const entry = entries.get(alias)
      if (!selected.available || !entry) return {state:'unavailable'}
      return tts().serviceState({voice:entry.voice,language:selected.language}, {scope,grant:entry.grant.grant})
    },
    // An open call's residency lease on her voice's provider (released on hang-up); null when she has no voice here.
    async hold(alias) {
      const selected = await api.open(alias, {readOnly:true})
      const entry = entries.get(alias)
      if (!selected.available || !entry) return null
      return tts().hold({voice:entry.voice,language:selected.language}, {scope,grant:entry.grant.grant})
    },
    async cacheIdentity(alias, {text,mood = 'default',selectionKey}) {
      const selected = await api.open(alias,{readOnly:true})
      if (!selected.available) throw failure(selected.diagnostics[0])
      const entry = entries.get(alias)
      if (!entry) throw failure('TTS_STALE')
      return tts().cacheIdentity({voice:entry.voice,text,mood,selectionKey,language:selected.language}, {scope,grant:entry.grant.grant})
    },
    async readCached(alias, {text,mood = 'default',selectionKey}, {signal,onLookup} = {}) {
      const selected = await api.open(alias,{readOnly:true})
      if (!selected.available) throw failure(selected.diagnostics[0])
      // Browser speech leaves no audio behind (a clip export has no voice for her).
      if (selected.browser) return null
      const entry = entries.get(alias)
      if (!entry) throw failure('TTS_STALE')
      return tts().readCached({voice:entry.voice,text,mood,selectionKey,language:selected.language}, {scope,grant:entry.grant.grant,signal,onLookup})
    },
    async synthesize(alias, {text,mood = 'default',selectionKey}, {signal} = {}) {
      const selected = await api.open(alias)
      if (!selected.available) throw failure(selected.diagnostics[0])
      const entry = entries.get(alias)
      if (!entry) throw failure('TTS_STALE')
      return tts().synthesize({voice:entry.voice,text,mood,selectionKey,language:selected.language}, {scope,grant:entry.grant.grant,signal})
    },
    refresh:clear,
    dispose() { if (disposed) return; disposed = true; offPresentation(); offTts?.(); clear(); listeners.clear() }
  }
  // A session's speech is created when the session starts (and again after a TTS change): its cast is known then.
  if (!onlyCached) queueMicrotask(() => void api.prewarmCast())
  return api
}
