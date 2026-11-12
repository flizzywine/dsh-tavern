import {createRequestObservers} from './request-observers.js'
import {resolveVoiceSpec, chooseService, describeVoiceCapabilities, sourceUnsetIssue} from './voice-resolver.js'
import { randomBytes } from 'node:crypto'
import { createCache } from './cache.js'
import { createJobs } from './jobs.js'
import { createLiveAudio } from './live-audio.js'
import { BUILTIN_PRESETS } from './providers/presets.js'
import { qwenMood } from './providers/qwen.js'
import { azureMood } from './providers/azure.js'
import { volcengineMood } from './providers/volcengine.js'
import { minimaxMood } from './providers/minimax.js'
import {voiceLoudnessGain} from './loudness.js'
import { createVoiceLoudness } from './voice-loudness.js'
import { serviceVoiceId, fail, hash, canonical, id, language, lexicon, portableVoice, voicePreset, wav, durationMs, TtsError } from './core.js'
import { normalizeDashes } from './pronunciation.js'
import voiceCues from './shared/voice-cues.cjs'
import { fishSpeechText } from './providers/fish-audio.js'

export const ttsCacheKey = identity => hash(identity)

const moodResolvers = { qwen: qwenMood, azure: azureMood, volcengine: volcengineMood, minimax: minimaxMood }
// A service that declares how long its model may take to load (GET /v1/info loadTimeoutMs) is waited for that much longer.
const loadWait = p => p?.capabilities?.loadTimeoutMs ?? 0
// A self-hosted service's voice list changes with the service, so it is read afresh, not kept for a day.
const selfHosted = p => p?.capabilities?.loadTimeoutMs !== undefined

export function createTts({ profileId = '', dataDir, cache = createCache({ dataDir }), voiceLoudness = createVoiceLoudness({ dataDir }), globalReadings = () => [], reading = () => ({narrator:{enabled:false},readAloud:{voice:null,auto:false}}), now = Date.now } = {}) {
  const providers = new Map(), sources = new Map(), grants = new Map(), tickets = new Map(), flights = new Map(), lanes = new Map(), catalogs = new Map(), listeners = new Set(), usage = new Map()
  let disposed = false, enabled = true, epoch = 0, waiters = 0, activeSyntheses = 0
  const requests = createRequestObservers()
  let activeProviders = 0, lastSynthesisAt = null
  async function providerWork(work, synthesis = true) {
    activeProviders++
    try {
      const result = await work()
      if (synthesis) lastSynthesisAt = now()
      return result
    } finally {activeProviders--}
  }
  const requestFor = requests.forProvider
  const emit = e => { for (const fn of listeners) fn(e) }
  const alive = () => { if (disposed) fail('PLUGIN_UNAVAILABLE') }
  function grantFor(grant, source, scope) {
    alive(); const g = grants.get(grant)
    if (!g || source && g.source !== source || scope && g.scope !== scope) fail('FORBIDDEN')
    return g
  }
  function revoke(source) {
    for (const [grant,g] of grants) if (g.source === source) { g.abort.abort(); grants.delete(grant) }
    for (const [ticket,t] of tickets) if (!grants.has(t.grant)) tickets.delete(ticket)
  }
  function snapshot(input) {
    id(input.sourceId); id(input.owner)
    if (typeof input.revision !== 'string' || !input.revision || !Array.isArray(input.voices) || input.voices.length > 256) fail('INVALID_INPUT')
    const voices = input.voices.map(v => v.kind === 'pack' ? structuredClone(v) : portableVoice(v))
    if (new Set(voices.map(v => v.id)).size !== voices.length) fail('REVISION_CONFLICT')
    // readings are global presets only; a source cannot carry its own.
    if (Object.hasOwn(input, 'readings')) fail('UNKNOWN_FIELD')
    const data = structuredClone({ owner: input.owner, sourceId: input.sourceId, revision: input.revision, voices, bindings: input.bindings || {} })
    // shared sources keep each consumer's live reference reader. Disposing
    // the first card must not strand another card on its revoked presentation lease.
    return { ...data, readers:new Set(), refs: 1,
      readReference(hash) { const reader = [...this.readers].at(-1); if (!reader?.read) fail('MISSING_REFERENCE'); return reader.read(hash) } }
  }
  const sourceDefinition = s => canonical({ owner: s.owner, sourceId: s.sourceId, revision: s.revision, voices: s.voices, bindings: s.bindings })
  function voiceFor(ref) {
    alive(); const source = sources.get(ref?.source), voice = source?.voices.find(v => v.id === ref.id)
    if (!voice) fail('VOICE_NOT_FOUND')
    return { source, voice }
  }
  async function resolveUtterance(input, options, readOnly = false) {
      alive(); if (!enabled) fail('TTS_DISABLED')
      const g = grantFor(options?.grant, input.voice?.source, options?.scope)
      if (options.signal?.aborted) fail('ABORTED')
      if (!readOnly && waiters >= 256) fail('QUEUE_FULL')
      let source, voice
      if (input.voiceId !== undefined) {
        if (readOnly) fail('REFERENCE_UNSUPPORTED')
        if (!g.serviceVoices) fail('FORBIDDEN')
        serviceVoiceId(input.voiceId)
        const matches = (await api.listServiceVoices()).filter(v => v.id === input.voiceId)
        if (matches.length !== 1) fail(matches.length ? 'SERVICE_REQUIRED' : 'VOICE_NOT_FOUND')
        const selected = matches[0]
        if (selected.state !== 'ready') fail('SERVICE_OFFLINE')
        const preset = sources.get('voice-presets')?.voices.find(v => v.id === selected.id)
        voice = preset ? portableVoice(preset) : portableVoice({schemaVersion:1,id:selected.id,voiceId:selected.id,label:selected.label || selected.id,enabled:true,kind:'service',engine:selected.engine,
          revision:selected.revision,languages:selected.languages,params:selected.params || {},
          ...(selected.modelSetId ? {modelSetId:selected.modelSetId} : {}),...(selected.modelVersion ? {modelVersion:selected.modelVersion} : {})})
        if (Object.hasOwn(input, 'readings')) fail('UNKNOWN_FIELD')
        source = {sourceId:'service-voices',bindings:{[voice.id]:selected.serviceId}}
      } else {
        if (g.serviceVoices) fail('FORBIDDEN')
        ;({ source, voice } = voiceFor(input.voice))
      }
      grantFor(options.grant)
      if (input.selectionKey !== undefined && (typeof input.selectionKey !== 'string' || input.selectionKey.length > 512)) fail('INVALID_INPUT')
      if (voice.kind === 'pack') {
        const resolved = resolveVoiceSpec({...voice.pack,mood:input.mood})
        if (!resolved.effective) fail(resolved.issues[0]?.code || 'VOICE_DISABLED')
        voice = resolved.effective.voice
      }
      if (!voice.enabled) fail('VOICE_DISABLED')
      if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 1500) fail('INVALID_INPUT')
      if (!voice.languages.map(language).includes(language(input.language))) fail('LANGUAGE_UNSUPPORTED')
      const entry = providers.get(source.bindings[voice.id]); if (!entry) fail('SERVICE_OFFLINE')
      const p = entry.provider
      if (!readOnly) await p.discover?.({wake:true,signal:options.signal})
      g.authorize?.(input,{serviceId:p.id,serviceRevision:p.revision})
      if (!readOnly) {
        p.onRequest?.()
        if (voice.kind === 'reference' && p.health) await p.health({signal:options.signal})
      }
      // only the active global preset; its compiled revision is part of the
      // line identity, so switching or editing the preset re-synthesises a cached line the next time it is played.
      const readings = lexicon(await globalReadings())
      grantFor(options.grant)
      if (voice.kind === 'reference' ? !p.capabilities?.voiceKinds?.includes('reference') : voice.kind === 'service' ? !p.capabilities?.serviceVoiceEngines?.includes(voice.engine) : p.kind !== voice.kind) fail('REFERENCE_UNSUPPORTED')
      const ref = voice.references?.[0]
      const params = structuredClone(voice.params)
      const resolveMood = Object.hasOwn(moodResolvers, p.kind) ? moodResolvers[p.kind] : undefined
      const spoken = text => normalizeDashes(readings.apply(text, input.language))
      const text = p.kind === 'fish-audio' ? fishSpeechText(input.text, params, p.speaking ? p.speaking(params.model).voiceDirections : p.capabilities?.voiceDirections, spoken) : voiceCues.projectVoiceCues(input.text, {spoken})
      // A line's identity is what its audio is made of: the service that speaks it, the voice's references and parameters,
      // the mood, language, readings and text. Never a display name (of the service or the voice), the service's connection
      // settings or the rest of the figure (renaming the local service, moving a figure's model
      // or editing its expressions re-keyed lines whose audio stayed byte for byte the same).
      const {label:_label, enabled:_enabled, languages:_languages, ...sound} = voice
      const identity = { version: 4, profileId, provider: p.id, voice: sound, mood: input.mood || 'default', ...(resolveMood ? { resolvedMood: resolveMood({ params, mood: input.mood, moodStyles: voice.moodStyles }) } : {}), language: input.language, params, readings: readings.revision, text }
      const key = ttsCacheKey(identity)
      return {g,source,voice,entry,p,ref,params,readings,identity,key}
  }
  // The reference audio a provider receives for a voice, read once per request; synthesis and prewarm send the same.
  async function readReferences({source, voice, p, readings}, signal) {
    if (!p.capabilities?.referenceInput?.some(kind => ['bytes-v1','bytes-list-v1'].includes(kind))) fail('REFERENCE_UNSUPPORTED')
    const multiple = p.capabilities.referenceInput.includes('bytes-list-v1')
    if (!multiple && voice.references.length !== 1) fail('REFERENCE_UNSUPPORTED')
    const resolved = []
    let total = 0
    for (const item of voice.references) {
      // The asset owner validated stored audio at ingress; the reader owns authorization.
      const bytes = Buffer.from(await interrupted(Promise.resolve().then(() => source.readReference(item.sha256)), signal))
      total += bytes.length
      const limits = p.capabilities.referenceLimits
      if (limits?.totalBytes && total > limits.totalBytes || limits?.count && voice.references.length > limits.count || limits?.bytes && bytes.length > limits.bytes) fail('REFERENCE_LIMIT_EXCEEDED')
      resolved.push({sha256:item.sha256,bytes,transcript:item.transcript,promptText:readings.apply(item.transcript,item.language),promptLanguage:item.language})
    }
    return {reference:resolved[0],...(multiple ? {references:resolved} : {})}
  }
  const api = {
    apiVersion: 1,
    resolveVoiceSpec,
    describeVoiceCapabilities,
    // the stage's sync choice among listed services (card voice-direction flag); the same rule resolveVoiceService uses.
    chooseService(source,services) { return chooseService(source,services) },
    async resolveVoiceService({voice,binding}, {readOnly = false} = {}) {
      if (binding.source === null) return {effective:null,issues:[]}
      const source = voice.sources[binding.source ?? voice.defaultSource]
      // a chosen source not set up yet stays chosen and says what it lacks.
      const unset = sourceUnsetIssue(source)
      if (unset) return unset
      // A source whose service is not set up stays silent and says so (SERVICE_REQUIRED); nothing switches to the browser.
      const selected = chooseService(source,await api.listServices())
      if (!selected) return {effective:null,issues:[{code:'SERVICE_REQUIRED'}]}
      const provider = providers.get(selected.id).provider
      if (!readOnly) await provider.discover?.()
      // what this source's own model costs and can do (a Fish figure's model choice), over the service's capabilities.
      const capabilities = () => ({...structuredClone(provider.capabilities),...provider.speaking?.(source.model)})
      if (readOnly) return {effective:{serviceId:selected.id,serviceRevision:provider.revision,capabilities:{...selected.capabilities,...provider.speaking?.(source.model)}},issues:[]}
      const health = provider.health ? await provider.health({}) : {state:'ready'}
      if (health.state === 'credentials-required') return {effective:null,issues:[{code:'CREDENTIALS_REQUIRED'}]}
      const validation = provider.validateModel ? await provider.validateModel(source.model, source.voiceName) : {issues:[]}
      return {effective:{serviceId:selected.id,serviceRevision:provider.revision,capabilities:capabilities()},issues:validation.issues}
    },
    reading: () => structuredClone(reading()),
    readingChanged() { emit({type:'readingChanged'}) },
    // a saved service was added, changed, removed or checked: the voice services catalog changed.
    servicesChanged() { emit({type:'servicesChanged'}) },
    setEnabled(value) {
      alive(); enabled = value
      if (!enabled) {
        epoch++; tickets.clear(); api.jobs.dispose()
        for (const f of flights.values()) f.abort.abort()
      }
    },
    capabilities: () => ({ scopedVoices: true, referenceInput: ['bytes-v1'] }),
    subscribe(fn) { alive(); listeners.add(fn); return () => listeners.delete(fn) },
    registerProvider(owner, provider) {
      alive(); id(owner); id(provider.id)
      if (!provider.revision || typeof provider.synthesize !== 'function') fail('INVALID_INPUT')
      if (providers.has(provider.id)) fail('REVISION_CONFLICT')
      const entry = { owner, provider, abort: new AbortController() }; providers.set(provider.id, entry); emit({ type: 'providerChanged', serviceId: provider.id })
      return () => { if (providers.get(provider.id) !== entry) return; providers.delete(provider.id); entry.abort.abort(); emit({ type: 'providerRemoved', serviceId: provider.id }) }
    },
    registerVoiceSource(input) {
      alive(); let current = snapshot(input), existing = sources.get(current.sourceId)
      // a shared source must be the same definition; compare canonical JSON only on this path.
      if (existing) { if (sourceDefinition(existing) !== sourceDefinition(current)) fail('REVISION_CONFLICT'); existing.refs++; current = existing }
      else sources.set(current.sourceId, current)
      const reader = {read:input.readReference}; current.readers.add(reader)
      let released = false
      emit({ type: 'voicesChanged', source: current.sourceId })
      return {
        source: current.sourceId,
        replace(next, expectedRevision) {
          alive(); if (released || sources.get(current.sourceId) !== current || expectedRevision !== current.revision) fail('REVISION_CONFLICT')
          const replacement = snapshot(next)
          if (replacement.sourceId !== current.sourceId || replacement.owner !== current.owner || current.refs !== 1) fail('REVISION_CONFLICT')
          reader.read = next.readReference; replacement.readers.add(reader)
          revoke(current.sourceId); sources.set(current.sourceId, replacement); current = replacement; emit({ type: 'voicesChanged', source: current.sourceId })
        },
        dispose() { if (released) return; released = true; current.readers.delete(reader); if (--current.refs) return; sources.delete(current.sourceId); revoke(current.sourceId); emit({ type: 'voicesChanged', source: current.sourceId }) },
      }
    },
    grantConsumer({ principal, source, scope, authorize }) {
      alive(); id(principal); id(scope)
      if (!sources.has(source)) fail('VOICE_NOT_FOUND')
      const grant = Object.freeze({}), g = { principal, source, scope, authorize, keys: new Set(), abort: new AbortController() }; grants.set(grant, g)
      return { grant, dispose() { g.abort.abort(); grants.delete(grant); for (const [t,v] of tickets) if (v.grant === grant) tickets.delete(t) } }
    },
    grantServiceConsumer({ principal, scope }) {
      alive(); id(principal); id(scope)
      const grant = Object.freeze({}), g = { principal, scope, keys:new Set(), serviceVoices:true, abort:new AbortController() }; grants.set(grant,g)
      return { grant, dispose() { g.abort.abort(); grants.delete(grant); for (const [t,v] of tickets) if (v.grant === grant) tickets.delete(t) } }
    },
    async listServiceVoices() {
      alive()
      const lists = await Promise.all([...providers.values()].filter(({provider:p}) => p.capabilities?.serviceVoiceEngines?.length).map(async ({provider:p}) => {
        let items
        try { items = await p.catalog({}) } catch { return [] }
        alive()
        return items.filter(v => p.capabilities.serviceVoiceEngines.includes(v.engine)).map(v => ({...structuredClone(v),serviceId:p.id}))
      }))
      const presets = await Promise.all((sources.get('voice-presets')?.voices || []).map(async voice => {
        const candidates = [...providers.values()].map(e => e.provider).filter(p => voice.kind === 'service' ? p.capabilities?.serviceVoiceEngines?.includes(voice.engine) : p.kind === voice.kind)
        const provider = candidates.find(p => p.id === voice.providerId) || (candidates.length === 1 ? candidates[0] : undefined)
        let ready = false
        if (voice.kind === 'service') ready = lists.flat().some(v => v.serviceId === provider?.id && v.id === voice.voiceId && v.state === 'ready')
        else if (provider) { try { ready = ['ready','configured'].includes((await provider.health({})).state) } catch {} }
        return {...structuredClone(voice), engine:voice.engine || voice.kind, revision:hash(voice), serviceId:provider?.id,
          state:!voice.enabled ? 'disabled' : !provider ? 'service-required' : ready ? 'ready' : 'offline', preset:true}
      }))
      const items = [...presets, ...lists.flat().filter(v => !presets.some(p => p.id === v.id))]
      // Keep builtin choices searchable when their provider or credentials are absent.
      return [...items, ...structuredClone(BUILTIN_PRESETS).filter(p => !items.some(v => v.id === p.id)).map(p => ({...p,state:'offline'}))]
    },
    async exportVoicePresets(ids) {
      if (!Array.isArray(ids) || ids.length > 256) fail('INVALID_INPUT')
      const saved = sources.get('voice-presets')?.voices || [], catalogue = await api.listServiceVoices()
      return [...new Set(ids)].flatMap(id => {
        const preset = saved.find(v => v.id === id)
        if (preset) return [voicePreset(preset)]
        const matches = catalogue.filter(v => v.id === id)
        if (!matches.length) return []
        const descriptors = matches.map(v => {
          const descriptor = {schemaVersion:1,id:v.id,label:v.label,enabled:true,kind:'service',voiceId:v.id,engine:v.engine,revision:v.revision,languages:v.languages,params:v.params || {}}
          for (const key of ['modelSetId','modelVersion']) if (v[key] !== undefined) descriptor[key] = v[key]
          return voicePreset(descriptor)
        })
        if (new Set(descriptors.map(hash)).size !== 1) fail('SERVICE_REQUIRED')
        return [descriptors[0]]
      })
    },
    // authoring exports bytes and synthesis data, never provider configuration.
    async exportPortableVoice({voiceId}) {
      alive(); serviceVoiceId(voiceId)
      let saved = sources.get('voice-presets')?.voices.find(v => v.id === voiceId)
      if (!saved) {
        const builtin = BUILTIN_PRESETS.find(v => v.id === voiceId)
        if (builtin) { const {engine,revision,...preset} = builtin; saved = {schemaVersion:1,enabled:true,...preset} }
      }
      if (!saved || !['azure','qwen','fish-audio','volcengine','openai-compatible','minimax'].includes(saved.kind)) fail('REFERENCE_UNSUPPORTED')
      const {providerId, ...voice} = voicePreset(saved)
      return {voice}
    },
    registerUsageSource(input) { alive(); if (usage.has(input.owner)) fail('REVISION_CONFLICT'); usage.set(input.owner, input); return () => usage.delete(input.owner) },
    async inspectUsage(serviceId) { if (!usage.size) fail('USAGE_UNKNOWN'); return Promise.all([...usage.values()].map(u => u.inspect(serviceId))) },
    listVoices({ source }) { alive(); return (sources.get(source)?.voices || []).map(v => api.getVoice({ voice: { source, id: v.id } })) },
    getVoice({ voice: ref }) {
      const { source, voice } = voiceFor(ref), provider = providers.get(source.bindings[voice.id])?.provider
      return { ...structuredClone(voice), state: !voice.enabled ? 'disabled' : !source.bindings[voice.id] ? 'service-required' : provider ? 'ready' : 'offline' }
    },
    async listServices() { alive(); return [...providers.values()].map(({provider:p}) => (
      {id:p.id,kind:p.kind,revision:p.revision,capabilities:structuredClone(p.capabilities || {})}
    )) },
    // What each registered provider reports it serves (the voice services catalog's `sources`): the provider is asked first
    // (discover, no wake; it caches its server's answer per service config), and a failed ask keeps its last answer.
    async providerVoiceSources() {
      alive()
      return Promise.all([...providers.values()].map(async ({owner, provider:p}) => {
        try { await p.discover?.() } catch {}
        const c = p.capabilities || {}
        return {owner, id:p.id, kind:p.kind, label:p.label || p.id, sources:[...(c.voiceSources || [])], ...(c.voiceList ? {voiceList:c.voiceList} : {}),
          billing:c.billing || (c.paid === false ? 'free' : c.paid ? 'paid' : 'unknown')}
      }))
    },
    async listProviderCatalog({ serviceId } = {}) {
      if (!serviceId) return api.listServiceVoices()
      alive(); const p = providers.get(serviceId)?.provider, cached = catalogs.get(serviceId)
      if (!selfHosted(p) && cached && (!p || cached.revision === p.revision && cached.until > now())) return structuredClone(cached.items)
      if (!p) fail('SERVICE_OFFLINE')
      let items
      try { items = await p.catalog({}) } catch { fail('SERVICE_OFFLINE') }
      alive(); if (!Array.isArray(items) || items.length > 10000) fail('INVALID_CATALOG')
      if (!selfHosted(p)) catalogs.set(serviceId,{revision:p.revision,until:now()+86400000,items:structuredClone(items)})
      return structuredClone(items)
    },
    async health({ serviceId, signal } = {}) { alive(); const items = serviceId ? [providers.get(serviceId)].filter(Boolean) : [...providers.values()]; return Promise.all(items.map(async ({provider:p}) => ({ id:p.id, ...await p.health({signal}) }))) },
    // Maintenance/export identity only: no cache hydration, credentials, network or synthesis. source, voice and service are
    // what the identity was derived from (a maintenance tool proving an entry recorded under an earlier identity uses them).
    async cacheIdentity(input, options) {
      const {key,identity,source,voice,p} = await resolveUtterance(input, options, true)
      grantFor(options.grant)
      return {key,identity:structuredClone(identity),source:source.sourceId,voice:structuredClone(voice),service:{id:p.id,revision:p.revision}}
    },
    async readCached(input, options) {
      const {key} = await resolveUtterance(input, options, true)
      const cached = await cache.peek(key,true)
      options.onLookup?.({key,found:!!cached})
      grantFor(options.grant)
      if(!cached)return null
      const {audio}=cached,loudness=cached.loudness || voiceLoudnessGain(null, null)
      grantFor(options.grant)
      return {key,audio,durationMs:durationMs(audio),mime:'audio/wav',loudness}
    },
    async synthesize(input, options) {
      if (options?.priority !== undefined && !['call','story'].includes(options.priority)) fail('INVALID_INPUT')
      const played = async ({g, source, voice, p, key}, cached, started) => {
        const voiceKey = hash([source.sourceId, voice.id, p.id]), loudness = await cache.loudness(key)
        if (!await voiceLoudness.estimate(voiceKey)) await voiceLoudness.record(voiceKey, loudness)
        grantFor(options.grant); if (started !== epoch) fail('CACHE_CLEARED')
        g.keys.add(key); return { key, mime:'audio/wav', durationMs:durationMs(cached), loudness, cacheHit:true }
      }
      // A line already in the cache plays from it without waking or asking its service: a stopped local worker or a
      // service waiting for the card does not hold back audio that exists. A line the service has not answered for yet
      // (its identity may still change with what the service reports) goes the full way below.
      // A grant that authorizes each request once (a paid preview) is spent by the full resolution below only.
      const known = grants.get(options?.grant)?.authorize ? null : await resolveUtterance(input, options, true).catch(() => null)
      if (known) {
        const started = epoch, cached = await cache.get(known.key, known.g.scope)
        grantFor(options.grant); if (started !== epoch) fail('CACHE_CLEARED')
        if (cached) return played(known, cached, started)
      }
      const {g,source,voice,entry,p,ref,params,readings,identity,key} = await resolveUtterance(input, options)
      const voiceKey = hash([source.sourceId, voice.id, p.id])
      const started = epoch
      const lane = p.endpoint || p.id
      waiters++
      try {
        const cached = await cache.get(key, g.scope)
        grantFor(options.grant); if (started !== epoch) fail('CACHE_CLEARED')
        if (cached) return played({g, source, voice, p, key}, cached, started)
        let flight = flights.get(key)
        if (!flight) {
          const abort = new AbortController()
          flight = { abort, users: 0, callUsers: 0, scopes: new Set(), promise: null, live: null, listeners: new Set() }
          // A streaming provider's audio is playable from its first chunk, before the line is complete and cached.
          const live = p.capabilities?.stream ? createLiveAudio(p.capabilities.stream) : null
          const onPcm = live && (chunk => { live.push(chunk); if (!flight.live) { flight.live = live; for (const fn of flight.listeners) fn() } })
          flights.set(key, flight)
          const signal = AbortSignal.any([abort.signal, entry.abort.signal, AbortSignal.timeout(120000 + loadWait(p))])
          // a service that declares its concurrency gets that many lanes; else cloud turns warm two clips at once
          // and other engines retain one lane.
          const queue = lanes.get(lane) || createSynthesisQueue(p.capabilities?.concurrency || (['qwen','azure','volcengine','openai-compatible','minimax'].includes(p.kind) ? 2 : 1), () => { if (lanes.get(lane) === queue) lanes.delete(lane) })
          lanes.set(lane,queue)
          flight.promise = queue.run(async () => {
            signal.throwIfAborted()
            const {reference, references} = ref ? await readReferences({source, voice, p, readings}, signal) : {}
            const audio = wav(await interrupted(providerWork(() => p.synthesize({ request:requestFor(p.id), ...identity, text: identity.text, textPrepared:true, voiceId:voice.voiceId, revision:voice.revision, reference, ...(references ? {references} : {}), readingsRevision: readings.revision, mood:input.mood, moodStyles:voice.moodStyles, identity:key }, { signal, ...(onPcm ? {onPcm} : {}) })), signal))
            live?.end()
            signal.throwIfAborted(); alive(); if (started !== epoch) fail('CACHE_CLEARED')
            flight.durationMs = durationMs(audio)
            // Keep only QA fields, never provider configuration or reference bytes. Cache identity is unchanged.
            await cache.put(key, audio, [...flight.scopes], {
              version: 1, text: identity.text, chars: [...identity.text].length,
              language: input.language, provider: p.id, providerKind: p.kind,
              model: p.speaking ? p.speaking(params.model).model ?? null : params.model ?? null,
              voice: voice.voiceId ?? params.voice ?? params.voiceName ?? params.speaker ?? voice.id ?? null,
              source: source.sourceId, readingsRevision: readings.revision,
              synthesizedAt: new Date().toISOString(),
            })
            if (started !== epoch) { await cache.clear(); fail('CACHE_CLEARED') }
            await voiceLoudness.record(voiceKey, await cache.loudness(key))
          }, signal, () => flight.callUsers > 0).catch(error => { live?.fail(error); if (error instanceof TtsError) throw error; fail(signal.aborted ? 'ABORTED' : /^[A-Z][A-Z_]{0,79}$/.test(error.code || '') ? error.code : 'SERVICE_OFFLINE', error.status) }).finally(() => { if (flights.get(key) === flight) flights.delete(key) })
          flight.promise.catch(() => {})
        }
        flight.users++; if (options.priority === 'call') flight.callUsers++; flight.scopes.add(g.scope)
        const signal = AbortSignal.any([g.abort.signal, ...(options.signal ? [options.signal] : [])])
        let onAbort
        // The streamed first play uses the voice's known level (null: nominal) until the complete line is measured.
        const streaming = options.onStream && (() => { flight.listeners.delete(streaming); void voiceLoudness.estimate(voiceKey).then(loudness => options.onStream({key, ...(loudness ? {loudness} : {})}), () => options.onStream({key})) })
        if (streaming) { if (flight.live) streaming(); else flight.listeners.add(streaming) }
        try {
          await Promise.race([flight.promise, new Promise((_, reject) => { onAbort = () => reject(new TtsError('ABORTED')); if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, {once:true}) })])
          const loudness = await cache.loudness(key)
          grantFor(options.grant); if (started !== epoch) fail('CACHE_CLEARED'); g.keys.add(key)
          return { key, mime: 'audio/wav', durationMs:flight.durationMs, loudness, cacheHit:false }
        } finally { flight.listeners.delete(streaming); signal.removeEventListener('abort', onAbort); if (options.priority === 'call') flight.callUsers--; if (--flight.users === 0) flight.abort.abort() }
      } finally { waiters-- }
    },
    // a voice the stage is about to speak with, warmed ahead by a
    // provider that can (a local Drama 3 worker); every line of a reference-list voice shares its full reference list.
    // Other voices and providers have nothing to warm. Never synthesizes or caches audio.
    // Dev diagnostics: the provider's own fresh state (Fish `/v1/info`), never a cached capability or a worker probe.
    async serviceState(input, options) {
      const {p} = await resolveUtterance({...input, text:'diagnostic'}, options, true)
      if (!p.info) return {serviceId:p.id, state:'unsupported'}
      const info = await p.info()
      return {serviceId:p.id, state:info.state || 'unknown', ...(info.speed ? {speed:info.speed} : {})}
    },
    // A residency lease (an open phone call): while held, a provider that can idle-unload (its port has hold) stays resident.
    // Returns its release; providers with nothing to hold return a no-op.
    async hold(input, options) {
      const {p} = await resolveUtterance({...input, text:'hold'}, options, true)
      return p.hold?.() || (() => {})
    },
    async prewarm(input, options) {
      const {g, source, voice, p, readings, params} = await resolveUtterance({...input, text:'prewarm'}, options, true)
      const pack = voiceFor(input.voice).voice.pack
      if (!p.prewarm || !voice.references || pack?.voice.sources[pack.binding.source ?? pack.voice.defaultSource].kind !== 'reference-list') return {prewarmed:false}
      const signal = AbortSignal.any([g.abort.signal, AbortSignal.timeout(130000)])
      const {references} = await readReferences({source, voice, p, readings}, signal)
      const result = await providerWork(() => p.prewarm({references, ...(params.model ? {model:params.model} : {}), request:requestFor(p.id)}, {signal}), false)
      return {prewarmed:result !== false}
    },
    async readAudio({ key, grant }) {
      if (!enabled) fail('TTS_DISABLED')
      const started = epoch, g = grantFor(grant); if (!g.keys.has(key)) fail('FORBIDDEN')
      const b = await cache.get(key); grantFor(grant)
      if (!b || started !== epoch) fail('AUDIO_GONE')
      return b
    },
    async createAudioTicket({ key, grant, ttlMs = 60000 }) {
      if (!enabled) fail('TTS_DISABLED')
      const g = grantFor(grant); if (!g.keys.has(key)) fail('FORBIDDEN')
      for (const [t,v] of tickets) if (v.expires <= now()) tickets.delete(t)
      if (tickets.size >= 1024) fail('QUEUE_FULL')
      const ticket = randomBytes(32).toString('base64url'); tickets.set(ticket, { key, grant, expires: now() + Math.max(1, Math.min(60000, ttlMs)) }); return ticket
    },
    // A ticket for the audio of a synthesis still in flight; its scope must be one the flight serves.
    async createLiveTicket({ key, grant, ttlMs = 60000 }) {
      if (!enabled) fail('TTS_DISABLED')
      const g = grantFor(grant), live = flights.get(key)?.scopes.has(g.scope) && flights.get(key).live
      if (!live) fail('AUDIO_GONE')
      for (const [t,v] of tickets) if (v.expires <= now()) tickets.delete(t)
      if (tickets.size >= 1024) fail('QUEUE_FULL')
      const ticket = randomBytes(32).toString('base64url'); tickets.set(ticket, { key, grant, live, expires: now() + Math.max(1, Math.min(60000, ttlMs)) }); return ticket
    },
    async redeemAudioTicket(ticket) {
      const t = tickets.get(ticket); if (!t) fail('AUDIO_GONE'); if (t.expires <= now()) { tickets.delete(ticket); fail('AUDIO_GONE') }
      if (t.live) { if (!enabled) fail('TTS_DISABLED'); grantFor(t.grant); return t.live.stream() }
      return api.readAudio(t)
    },
    cacheStats: () => cache.stats(),
    pendingCount: () => activeSyntheses + api.jobs.pendingCount(),
    observeRequests(observer) { alive(); return requests.observe(observer) },
    activity() {
      alive()
      return {synthesisActive:activeProviders + activeSyntheses + api.jobs.pendingCount() > 0,lastSynthesisAt}
    },
    cacheSnapshot: () => cache.snapshot(),
    async deleteCacheEntry({ key } = {}) {
      alive()
      if (flights.has(key)) fail('QUEUE_FULL')
      const result = await cache.deleteEntry(key)
      for (const [ticket, value] of tickets) if (value.key === key) tickets.delete(ticket)
      for (const g of grants.values()) g.keys.delete(key)
      return result
    },
    async clearCache({ scope, all } = {}) { alive(); if (!all && !scope) fail('INVALID_INPUT'); epoch++; for (const f of flights.values()) f.abort.abort(); tickets.clear(); for (const g of grants.values()) g.keys.clear(); const result = await cache.clear(all ? undefined : scope); emit({ type:'cacheInvalidated', epoch }); return { ...result, epoch } },
    async dispose() { if (disposed) return; disposed = true; api.jobs.dispose(); for (const source of sources.keys()) revoke(source); for (const g of grants.values()) g.abort.abort(); grants.clear(); for (const e of providers.values()) e.abort.abort(); for (const f of flights.values()) f.abort.abort(); providers.clear(); sources.clear(); tickets.clear(); emit({ type:'disposed' }); listeners.clear(); await cache.flush(); await voiceLoudness.flush() },
  }
  // Include preparation/cache awaits before a provider flight exists, not only network work.
  const synthesize = api.synthesize
  api.synthesize = (...args) => { activeSyntheses++; return synthesize(...args).finally(() => { activeSyntheses-- }) }
  api.jobs = createJobs({ now, synthesize:api.synthesize, checkGrant:grantFor, ticket:api.createAudioTicket, liveTicket:api.createLiveTicket,
    onError:code => emit({type:'synthesisFailed',code}),
    timeoutMs(input,grant) {
      grantFor(grant,input.voice?.source)
      const source = input.voice && voiceFor(input.voice).source
      const p = source && providers.get(source.bindings[input.voice.id])?.provider
      return 125000 + loadWait(p)
    },
    resolveGrant(principal,source,scope) {
      alive(); if (!enabled) fail('TTS_DISABLED')
      for (const [grant,g] of grants) if (g.principal === principal && g.source === source && g.scope === scope) return grant
      fail('FORBIDDEN')
    },
  })
  return api
}

// One pending queue per endpoint, shared by every voice. Priority changes only at job
// boundaries; a waiting story gets a turn after four calls, and each class stays FIFO.
function createSynthesisQueue(concurrency, onIdle) {
  const pending = []
  let active = 0, calls = 0
  function pump() {
    while (active < concurrency && pending.length) {
      const story = pending.findIndex(job => !job.isCall())
      const call = pending.findIndex(job => job.isCall())
      const index = call >= 0 && (calls < 4 || story < 0) ? call : story
      const [job] = pending.splice(index, 1)
      job.signal.removeEventListener('abort', job.cancel)
      calls = job.isCall() ? calls + 1 : 0
      active++
      Promise.resolve().then(job.work).then(job.resolve, job.reject).finally(() => {
        active--; pump()
      })
    }
    if (!active && !pending.length) onIdle()
  }
  return {run(work, signal, isCall) {
    return new Promise((resolve, reject) => {
      const job = {work, signal, isCall, resolve, reject, cancel:() => {
        const index = pending.indexOf(job)
        if (index < 0) return
        pending.splice(index, 1); reject(new TtsError('ABORTED'))
        if (!active && !pending.length) onIdle()
      }}
      if (signal.aborted) { reject(new TtsError('ABORTED')); return }
      pending.push(job); signal.addEventListener('abort', job.cancel, {once:true})
      // Let the joining consumer register its priority before selecting the next job.
      queueMicrotask(pump)
    })
  }}
}

function interrupted(promise, signal) {
  return new Promise((resolve,reject) => {
    const abort = () => reject(new TtsError(signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED'))
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort',abort,{once:true})
    promise.then(resolve,reject).finally(() => signal.removeEventListener('abort',abort))
  })
}