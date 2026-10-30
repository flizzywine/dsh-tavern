// each figure registers its own immutable, pack-scoped portable preset.
import { effectiveCardStage, effectiveNarrator } from './card-stage-settings.js'
import { assetPackDigest } from './stage-asset-pack-catalogue.js'
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
        if (['disposed','providerChanged','providerRemoved','serviceDefaultsChanged','cacheInvalidated'].includes(event.type)) clear()
      }) : undefined
    }
    if (current?.apiVersion !== 1) throw failure('TTS_UNAVAILABLE')
    return current
  }
  // The figure's declared voice, or null when she has none here (voice off on this card, unknown name, figure off, no voice).
  async function declared(alias) {
    const engine = getEngine?.(), stage = effectiveCardStage(presentation.extension, engine)
    if (!stage.voice) return null
    // The narrator speaks the Chinese narration with the chosen figure's voice (or a browser system voice), whatever her 配音语言.
    if (alias === NARRATOR_VOICE) {
      const narrator = effectiveNarrator(presentation.extension, engine), voice = narrator.enabled ? narrator.voice : null
      if (!voice) return null
      if (voice.browser) return {browser:voice.browser}
      const resolved = await presentation.resolveFigure(voice)
      return resolved.value?.voice ? {ref:voice, resolved, language:'zh'} : null
    }
    const resolvedName = await presentation.resolveName(alias), ref = resolvedName.ref
    if (resolvedName.status !== 'resolved' || !ref) return null
    const resolved = await presentation.resolveFigure(ref)
    return resolved.value?.enabled && resolved.value.voice ? {ref, resolved} : null
  }
  async function prepare(alias, service, generation, readOnly) {
    const unbound = () => {
      const old = entries.get(alias)
      if (old) { old.grant.dispose(); old.source.dispose(); entries.delete(alias) }
      return {available:false,diagnostics:['voice-unbound']}
    }
    const found = await declared(alias)
    if (!found) return unbound()
    if (disposed || epoch !== generation || getTts() !== service) throw failure('TTS_STALE')
    if (found.browser) {
      const old = entries.get(alias)
      if (old) { old.grant.dispose(); old.source.dispose(); entries.delete(alias) }
      return {available:true,browser:{voice:found.browser},voiceId:'browser',language:'zh',scope,diagnostics:[]}
    }
    const {ref, resolved} = found, figure = resolved.value, spokenBinding = found.language ? {...figure.voice, language:found.language} : figure.voice
    const voice = figureTtsVoice(spokenBinding, resolved.voiceSpec, `${ref.packId}:${ref.figureId}`, figure.emotions)
    // Browser speech: the browser speaks with the named system voice; nothing is bound or registered. Not picked yet = silent.
    const spoken = browserSpeechSource(resolved.voiceSpec, figure.voice)
    if (spoken) {
      const old = entries.get(alias)
      if (old) { old.grant.dispose(); old.source.dispose(); entries.delete(alias) }
      return spoken.voiceName === undefined ? {available:false,diagnostics:['VOICE_NOT_FOUND']}
        : {available:true,browser:{voice:spoken.voiceName},voiceId:figure.voice.voice,language:voice.languages[0],scope,diagnostics:[]}
    }
    const declaration = {voice:resolved.voiceSpec,binding:figure.voice}
    const binding = getBinding ? await getBinding(ref, declaration, {readOnly}) : await assetVoiceBinding(service, {}, declaration, {readOnly})
    if (!binding) throw failure('SERVICE_REQUIRED')
    // readings are the global active preset, applied (and part of the line
    // identity) inside dsh-tts. The empty `readings` keeps every figure's source id — and so its cached audio — unchanged.
    const revision = assetPackDigest({voice,readings:[],binding,id:figure.voice.voice,language:voice.languages[0]})
    const sourceId = `figure:${ref.packId}:${ref.figureId}:${revision}`
    if (disposed || epoch !== generation || getTts() !== service) throw failure('TTS_STALE')
    const previous = entries.get(alias)
    if (previous?.voice.source === sourceId) return previous.public
    if (previous) { previous.grant.dispose(); previous.source.dispose(); entries.delete(alias) }
    const source = service.registerVoiceSource({owner:'dsh-tavern', sourceId, revision, voices:[voice],
      bindings:{voice:binding.serviceId},
      readReference:async hash => presentation.readReference(ref, (await presentation.resolveFigure(ref)).revision, hash)})
    let grant
    try {
      grant = service.grantConsumer({principal, source:sourceId, scope})
      if (disposed || epoch !== generation || getTts() !== service) throw failure('TTS_STALE')
      const entry = {source, grant, voice:{source:sourceId,id:'voice'}, public:{available:true,voice:{source:sourceId,id:'voice'},voiceId:figure.voice.voice,language:voice.languages[0],scope,diagnostics:[]}}
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
