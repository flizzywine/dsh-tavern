// each figure registers its own immutable, pack-scoped portable preset.
import { effectiveCardStage, effectiveNarrator } from './card-stage-settings.js'
import { assetPackDigest } from '../../packages/dsh-tavern-stage/lib/domain/stage-asset-pack-catalogue.js'
import { figureTtsVoice, assetVoiceBinding, browserSpeechSource } from './figure-voice.js'
const failure = code => Object.assign(new Error(code), {code})
// The key the narrator's voice opens under (旁白配音); never a figure name, so it cannot resolve to a cast member.
export const NARRATOR_VOICE = '\u0000narrator'

export function createAssetPackSpeech({presentation, getEngine, getTts, getBinding, scope, principal = 'dsh-browser', readOnly: onlyCached = false}) {
  if (!presentation) return null
  const entries = new Map(), pending = new Map(), listeners = new Set()
  let current, offTts, disposed = false, epoch = 0
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
        if (['disposed','providerChanged','providerRemoved','serviceDefaultsChanged','cacheInvalidated','readingChanged'].includes(event.type)) clear()
      }) : undefined
    }
    if (current?.apiVersion !== 1) throw failure('TTS_UNAVAILABLE')
    return current
  }
  // The figure's declared voice, or null when she has none here (voice off on this card, unknown name, figure off, no voice).
  async function declared(alias) {
    const engine = getEngine?.(), stage = effectiveCardStage(presentation.extension, engine)
    if (!stage.voice) return null
    // The narrator speaks the Chinese narration with the chosen figure's voice (or a browser system voice, or a voice of a
    // configured service), whatever her 配音语言. Its global layer is tts.reading().narrator.
    if (alias === NARRATOR_VOICE) {
      const tts = getTts(), global = tts?.apiVersion === 1 ? tts.reading().narrator : null
      const narrator = effectiveNarrator(presentation.extension, global), voice = narrator.enabled ? narrator.voice : null
      if (!voice) return null
      if (voice.browser) return {browser:voice.browser}
      if (voice.serviceId) return {service:voice}
      const resolved = await presentation.resolveFigure(voice)
      return resolved.value?.voice ? {ref:voice, resolved, language:'zh'} : null
    }
    const resolvedName = await presentation.resolveName(alias), ref = resolvedName.ref
    if (resolvedName.status !== 'resolved' || !ref) return null
    const resolved = await presentation.resolveFigure(ref)
    return resolved.value?.enabled && resolved.value.voice ? {ref, resolved} : null
  }
  async function prepare(alias, service, generation, readOnly) {
    const drop = () => {
      const old = entries.get(alias)
      if (old) { old.grant.dispose(); old.source.dispose(); entries.delete(alias) }
    }
    const found = await declared(alias)
    if (!found) { drop(); return {available:false,diagnostics:['voice-unbound']} }
    if (disposed || epoch !== generation || getTts() !== service) throw failure('TTS_STALE')
    if (found.browser) {
      drop()
      return {available:true,browser:{voice:found.browser},voiceId:'browser',language:'zh',scope,diagnostics:[]}
    }
    // A service voice ({serviceId, voice}, the voice picker's binding): that service speaks it as a one-source voice, the
    // voice name in the slot its provider reads (fish-audio: a voice id). A service that is gone leaves the narration silent.
    if (found.service) {
      const {serviceId, voice:name} = found.service, kind = (await service.listServices()).find(row => row.id === serviceId)?.kind
      if (!kind) { drop(); return {available:false,diagnostics:['SERVICE_OFFLINE']} }
      const spec = {name:'旁白', language:'zh', defaultSource:'narrator',
        sources:{narrator:kind === 'fish-audio' ? {kind:'voice-id', provider:kind, voiceId:name} : {kind:'preset', provider:kind, voiceName:name}}}
      const voice = figureTtsVoice({voice:'narrator'}, spec, 'narrator'), binding = {serviceId}
      const revision = assetPackDigest({voice, readings:[], binding, id:name, language:'zh'})
      return register(alias, service, generation, {voice, binding, revision, sourceId:`narrator:${revision}`, voiceId:name,
        readReference:async () => { throw failure('MISSING_REFERENCE') }})
    }
    const {ref, resolved} = found, figure = resolved.value, spokenBinding = found.language ? {...figure.voice, language:found.language} : figure.voice
    const voice = figureTtsVoice(spokenBinding, resolved.voiceSpec, `${ref.packId}:${ref.figureId}`, figure.emotions)
    // Browser speech: the browser speaks with the named system voice; nothing is bound or registered. Not picked yet = silent.
    const spoken = browserSpeechSource(resolved.voiceSpec, figure.voice)
    if (spoken) {
      drop()
      return spoken.voiceName === undefined ? {available:false,diagnostics:['VOICE_NOT_FOUND']}
        : {available:true,browser:{voice:spoken.voiceName},voiceId:figure.voice.voice,language:voice.languages[0],scope,diagnostics:[]}
    }
    const declaration = {voice:resolved.voiceSpec,binding:figure.voice}
    const binding = getBinding ? await getBinding(ref, declaration, {readOnly}) : await assetVoiceBinding(service, {}, declaration, {readOnly})
    if (!binding) throw failure('SERVICE_REQUIRED')
    // No service can speak her (zero-config): the TTS service hands back the browser, which speaks her line itself.
    if (binding.browser) {
      drop()
      return {available:true,browser:structuredClone(binding.browser),voiceId:figure.voice.voice,language:voice.languages[0],scope,diagnostics:[]}
    }
    // readings are the global active preset, applied (and part of the line
    // identity) inside dsh-tts. The empty `readings` keeps every figure's source id — and so its cached audio — unchanged.
    const revision = assetPackDigest({voice,readings:[],binding,id:figure.voice.voice,language:voice.languages[0]})
    return register(alias, service, generation, {voice, binding, revision, sourceId:`figure:${ref.packId}:${ref.figureId}:${revision}`, voiceId:figure.voice.voice,
      readReference:async hash => presentation.readReference(ref, (await presentation.resolveFigure(ref)).revision, hash)})
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
        // the first live open of a stage character's voice (the stage
        // prefetching the turn it opens on) warms it on a local worker in the background; never awaited by a line.
        if (!readOnly && descriptor.available && entry && !entry.prewarmed) {
          entry.prewarmed = true
          void service.prewarm?.({voice:entry.voice,language:descriptor.language}, {scope,grant:entry.grant.grant}).catch(() => {})
        }
        return structuredClone(descriptor)
      } catch (error) { return {available:false,diagnostics:[error.code || 'TTS_UNAVAILABLE']} }
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
  return api
}
