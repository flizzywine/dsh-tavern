import {fishModel, isFishCloud} from './providers/fish-models.js'
import z from '@deepseek-ai/schemastery'
import { providerConfig, providerKind, credentialRef, PROVIDER_ID, PROVIDER_KINDS } from './providers/params.js'
import { createOpenAICompatibleAdapter } from './providers/openai-compatible.js'
import { createFishDiscovery } from './providers/fish-discovery.js'
import recommendedFishVoices from './shared/fish-recommended.json' with {type:'json'}
import { createAzureAdapter, azureVoices } from './providers/azure.js'
import { createQwenAdapter, qwenModelInstructions, qwenVoices, QWEN_MODELS } from './providers/qwen.js'
import { createFishAudioAdapter } from './providers/fish-audio.js'
import { createVolcengineAdapter } from './providers/volcengine.js'
import { createMinimaxAdapter } from './providers/minimax.js'
import { hash, canonical, fail, voicePreset, describeTtsError } from './core.js'
import { boundedFetch } from './providers/fetch.js'
import { createModelValidation } from './model-validation.js'

// 台词朗读: the voice for per-reply 🔊 (null = the browser's system default) and the narration voice (off by default).
// A voice is the figure picker's binding: {browser:name} or {serviceId, voice}. Schemastery drops null defaults, so readingOf fills them.
const Reading = z.object({ dialogueVoice: z.any(), narrator: z.object({ enabled: z.boolean().default(false), voice: z.any() }) })
export const Settings = z.object({ enabled: z.boolean().default(true), providers: z.array(z.any()).default([]), voices: z.array(z.any()).default([]),
  reading: Reading,
  cacheMaxGB: z.number().min(0.1).max(100).default(1).description('\u7f13\u5b58\u4e0a\u9650\uff08GB\uff09'),
  cacheMaxAgeDays: z.natural().min(1).max(3650).default(30).description('\u7f13\u5b58\u4fdd\u7559\u5929\u6570'),
})
export function validateSettings(value) {
  if (typeof value.enabled !== 'boolean') fail('INVALID_INPUT')
  if (!Number.isFinite(value.cacheMaxGB) || value.cacheMaxGB < 0.1 || value.cacheMaxGB > 100 || !Number.isInteger(value.cacheMaxAgeDays) || value.cacheMaxAgeDays < 1 || value.cacheMaxAgeDays > 3650) fail('INVALID_INPUT')
  const seen = new Set()
  for (const p of value.providers) {
    if (!PROVIDER_ID.test(p.id) || seen.has(p.id)) fail('INVALID_INPUT')
    seen.add(p.id); providerKind(p.kind); providerConfig(p.kind, p.config)
    if (Object.keys(p).some(k => !['id','kind','label','config'].includes(k))) fail('INVALID_INPUT')
    const normalized = providerConfig(p.kind, p.config)
    if (canonical(normalized) !== canonical(p.config)) fail('INVALID_INPUT')
  }
  const voices = value.voices || []
  if (!Array.isArray(voices) || voices.length > 256 || new Set(voices.map(v => voicePreset(v).id)).size !== voices.length) fail('INVALID_INPUT')
  // the dictionary lives in reading presets (readings.json), not settings.
  if (Object.hasOwn(value,'readings') || Object.hasOwn(value,'dictionaryPath')) fail('UNKNOWN_FIELD')
  return value
}
export function readingOf(settings) {
  const r = settings.reading || {}
  return { dialogueVoice: r.dialogueVoice ?? null, narrator: { enabled: r.narrator?.enabled === true, voice: r.narrator?.voice ?? null } }
}
const plainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const voiceName = v => typeof v === 'string' && v.trim() !== '' && v.length <= 200 && !/[\u0000-\u001f]/.test(v)
function readingVoice(v) {
  if (v === null) return null
  const keys = plainObject(v) ? Object.keys(v).sort().join() : ''
  if (keys === 'browser' && voiceName(v.browser)) return { browser: v.browser }
  if (keys === 'serviceId,voice' && PROVIDER_ID.test(v.serviceId) && voiceName(v.voice)) return { serviceId: v.serviceId, voice: v.voice }
  fail('INVALID_READING_VOICE')
}
// Validated once here, on write; a bad patch is a repairable INVALID_READING_VOICE.
export function patchReading(current, patch) {
  const next = readingOf({ reading: current })
  if (!plainObject(patch) || Object.keys(patch).some(k => !['dialogueVoice','narrator'].includes(k))) fail('INVALID_READING_VOICE')
  if (Object.hasOwn(patch,'dialogueVoice')) next.dialogueVoice = readingVoice(patch.dialogueVoice)
  if (patch.narrator !== undefined) {
    const n = patch.narrator
    if (!plainObject(n) || Object.keys(n).some(k => !['enabled','voice'].includes(k))) fail('INVALID_READING_VOICE')
    if (n.enabled !== undefined) { if (typeof n.enabled !== 'boolean') fail('INVALID_READING_VOICE'); next.narrator.enabled = n.enabled }
    if (Object.hasOwn(n,'voice')) next.narrator.voice = readingVoice(n.voice)
  }
  return next
}
// Pure migration primitive. No files, credentials, or automatic startup writes.
// 浏览器朗读 is always in the voice services catalog: the device's own voices, free, nothing to set up.
export const BROWSER_VOICE_SERVICE = Object.freeze({id:'browser', kind:'browser', label:'浏览器朗读', state:'ready', billing:'free', sources:Object.freeze(['preset']), voiceList:'browser'})
export function importProviders(document) {
  if (document?.version !== 1 || !Array.isArray(document.providers)) fail('API_INCOMPATIBLE')
  return validateSettings({ enabled:true, providers: document.providers.map(p => ({ id:p.id, kind:p.kind, label:String(p.label || p.id).slice(0,160), config:providerConfig(p.kind,p.config) })), cacheMaxGB:1, cacheMaxAgeDays:30 })
}

// provider failures in plain words; adapters never put bodies, URLs or keys in messages.
const PLAIN_ERRORS = {FISH_AUTH_FAILED:'服务要求鉴权，请填写或检查 API Key 与访问权限',FISH_BILLING_REQUIRED:'Fish Audio 额度或余额不足',FISH_RATE_LIMITED:'Fish Audio 请求太频繁，稍后再试',FISH_REQUEST_FAILED:'Fish Audio 请求失败',
  CREDENTIALS_REQUIRED:'还没有填写密钥',SERVICE_OFFLINE:'连不上服务',TIMEOUT:'请求超时',ABORTED:'已取消'}
export function plainError(error) {
  const message = String(error?.message || '')
  if (error?.code === 'PROVIDER_AUTH_FAILED') return describeTtsError(error.code)
  if (PLAIN_ERRORS[error?.code]) return PLAIN_ERRORS[error.code]
  if (/[\u3400-\u9fff]/.test(message)) return message.slice(0,300)
  return PLAIN_ERRORS[message] || '请求失败'
}
// \changed\: called when the voice services catalog changes (a service saved, removed or checked).
export function createServiceSettings({ tts, get, replace, credentials, fetch, warn, samples, changed = () => {} }) {
  // Fish owns its free-only retry policy; do not wrap it in generic retries.
  const fish = createFishAudioAdapter({fetch}), discovery = createFishDiscovery({fetch})
  fetch = boundedFetch(fetch)
  const adapters = { 'fish-audio':fish, 'openai-compatible':createOpenAICompatibleAdapter({fetch}), qwen:createQwenAdapter({fetch,warn}), azure:createAzureAdapter({fetch}), volcengine:createVolcengineAdapter({fetch}), minimax:createMinimaxAdapter({fetch}) }
  const registrations = new Map(), validation = createModelValidation(), credentialEpochs = new Map()
  const modelIdentity = (p, model, voiceName) => ({serviceId:p.id,revision:hash([p,credentialEpochs.get(p.id) || 0]),model:model || (p.kind === 'qwen' ? 'qwen3-tts-flash' : ''),voiceName})
  let chain = Promise.resolve(), voiceSource, voiceRevision
  const serial = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p }
  // a saved service credential takes precedence over the optional Fish env key.
  const envKey = p => p?.kind === 'fish-audio' && isFishCloud(p.config) ? process.env.FISH_AUDIO_API_KEY : undefined
  async function secrets(p) {
    const result = {}, c = credentials()
    for (const f of providerKind(p.kind).fields.filter(f => f.secret)) {
      result[f.key] = (await c?.resolve(credentialRef(p.id,f.key)))?.value || envKey(p)
    }
    return result
  }
  async function describeSecret(p, f) {
    const state = await credentials()?.describe(credentialRef(p.id,f.key)) || {configured:false,writable:false}
    return !state.configured && envKey(p) ? {...state,configured:true,source:'env'} : state
  }
  const record = id => { const p = get().providers.find(p => p.id === id); if (!p) fail('SERVICE_OFFLINE'); return p }
  // service setup flow.
  // Last connection check per saved service, kept in memory for this activation only.
  const checks = new Map(), onlineLists = new Map()
  // Opening a picker never waits for credentials or a remote catalogue.
  function onlineList(provider, p) {
    const builtin = provider === 'azure' ? {voices:azureVoices(),models:[],source:'builtin'} : {voices:qwenVoices(),models:structuredClone(QWEN_MODELS),source:'builtin'}
    if (!p) return {provider,status:'ok',...builtin}
    const key = hash([p,credentialEpochs.get(p.id) || 0])
    let entry = onlineLists.get(p.id)
    if (!entry || entry.key !== key) { entry = {key,value:builtin,at:0,refreshing:false}; onlineLists.set(p.id,entry) }
    if (!entry.refreshing && Date.now() - entry.at > 300000) {
      entry.refreshing = true
      void (async () => {
        // Azure and Qwen catalogues are cloud APIs: without a key the builtin list stands and nothing is requested.
        try { const secret = await draftSecrets(provider,p.id); if (secret.key) entry.value = await baseVoices(p,secret); entry.message = undefined }
        catch (error) { entry.message = plainError(error) + '；已保留可选声音，请在配音设置中检查连接后重试。' }
        finally { entry.at = Date.now(); entry.refreshing = false }
      })()
    }
    return {provider,status:'ok',...structuredClone(entry.value),refreshing:entry.refreshing,...(entry.message ? {message:entry.message} : {})}
  }
  const remember = (p, result) => { checks.set(p.id, { revision:hash(p), status:result.status, ...(result.message ? {message:result.message} : {}), voiceCount:result.voices.length, at:Date.now() }); changed() }
  // Typed secrets win; otherwise reuse the stored credential of the same saved service. Never returned.
  async function draftSecrets(kind, id, given = {}, config) {
    const result = {}, c = credentials()
    for (const f of providerKind(kind).fields.filter(f => f.secret)) {
      const typed = given?.[f.key]
      if (typed !== undefined && (typeof typed !== 'string' || typed.length > 4096 || /[\r\n]/.test(typed))) fail('INVALID_INPUT')
      const saved = get().providers.find(p => p.id === id && p.kind === kind)
      // A changed endpoint must never inherit another server's stored or environment key.
      const sameEndpoint = saved && (!config || (saved.config.url || '') === (config.url || ''))
      const value = typed !== undefined ? typed : (sameEndpoint ? (await c?.resolve(credentialRef(id,f.key)))?.value : undefined) || envKey(config ? {kind,config} : saved)
      result[f.key] = value
    }
    return result
  }
  async function baseVoices(p, secret) {
    const a = adapters[p.kind]
    if (a.voices) return a.voices(p, secret)
    if (p.kind === 'azure') return { voices:(await a.catalog(p, secret)).items, models:[], source:'live' }
    if (p.kind === 'volcengine') return { voices:(await a.catalog(p, secret)).items, models:[], source:'builtin' }
    return { voices:[], models:[], source:'manual' }
  }
  // an explicit 测试连接 makes one real, minimal request. Free where the provider has
  // one (Azure voices/list, Qwen and Fish model listings, OpenAI-compatible list or /v1/models);
  // Volcengine, and OpenAI-compatible endpoints without any list route, synthesize a single character.
  async function check(p, secret) {
    const a = adapters[p.kind]
    if (!secret) {
      let listed = { voices:[], models:[], source:'none' }
      if (p.kind !== 'azure') try { listed = await baseVoices(p, {}) } catch {}
      return { status:'credentials-required', message:'还没有填写密钥', ...listed }
    }
    try {
      if (p.kind === 'qwen' && !secret.key) await a.probe(p, secret)
      if (['azure','qwen'].includes(p.kind)) return { status:'connected', ...await baseVoices(p, secret) }
      if (p.kind === 'openai-compatible') {
        const listed = await baseVoices(p, secret)
        return listed.source === 'manual' ? { ...await a.verify(p, secret), ...listed } : { status:'connected', ...listed }
      }
      if (p.kind === 'volcengine') return { ...await a.verify(p, secret), ...await baseVoices(p, secret) }
      if (a.probe) await a.probe(p, secret); else await a.catalog(p, secret)
      return { status:'connected', ...await baseVoices(p, secret) }
    } catch (error) {
      return { status:'error', message:plainError(error), voices:[], models:[], source:'none', error }
    }
  }
  const fishLists = new Map(), fishKnown = new Map()
  function knownFishVoices(p) {
    const key = hash([p,credentialEpochs.get(p?.id) || 0])
    if (!fishKnown.has(key)) fishKnown.set(key,new Map())
    return fishKnown.get(key)
  }
  function fishCatalogue({language,serviceId,selectedVoiceId} = {}) {
    const lang = ['zh','ja'].includes(language) ? language : ''
    const p = get().providers.find(p => p.kind === 'fish-audio' && (!serviceId || p.id === serviceId))
    const fallback = p && !isFishCloud(p.config) ? [] : recommendedFishVoices.filter(v => !lang || v.languages.includes(lang))
    const key = p ? hash([p,credentialEpochs.get(p.id) || 0,lang]) : lang
    let entry = fishLists.get(key)
    if (!entry) { entry = {voices:fallback,known:knownFishVoices(p),at:0,refreshing:false}; fishLists.set(key,entry) }
    if (p && isFishCloud(p.config) && !entry.refreshing && Date.now() - entry.at > 300000) {
      entry.refreshing = true
      void (async () => {
        try {
          const secret = await draftSecrets('fish-audio',p.id)
          if (!secret) { entry.voices = fallback; return }
          try {
            const voices = await discovery.catalogue(p,secret,{language:lang})
            if (!voices.length) fail('VOICE_NOT_FOUND')
            entry.voices = voices
          } catch {
            // Metadata lookups are free; a failed catalogue must not trigger synthesis.
            entry.voices = await Promise.all(fallback.map(async v => {
              try { return await discovery.validate(p,secret,{voiceId:v.voiceId}) } catch { return v }
            }))
          }
          for (const v of entry.voices) entry.known.set(v.voiceId,v)
          if (selectedVoiceId && !entry.known.has(selectedVoiceId)) {
            try { entry.known.set(selectedVoiceId,await discovery.validate(p,secret,{voiceId:selectedVoiceId})) } catch {}
          }
        } finally { entry.at = Date.now(); entry.refreshing = false }
      })().catch(() => { entry.voices = fallback })
    }
    const voices = [...entry.voices]
    if (selectedVoiceId && !voices.some(v => v.voiceId === selectedVoiceId)) {
      voices.unshift(entry.known.get(selectedVoiceId) || fallback.find(v => v.voiceId === selectedVoiceId) || {voiceId:selectedVoiceId,name:selectedVoiceId,languages:[]})
    }
    return {voices:structuredClone(voices),refreshing:entry.refreshing}
  }
  const api = {
    kinds() { return structuredClone(PROVIDER_KINDS) },
    listRecommendedFishVoices:fishCatalogue,
    async validateFishVoice(input) {
      const p = record(input.serviceId); if (p.kind !== 'fish-audio') fail('INVALID_INPUT')
      const voice = await discovery.validate(p,await secrets(p),input)
      knownFishVoices(p).set(voice.voiceId,voice)
      return voice
    },
    async searchFishVoices(input) {
      const p = record(input.serviceId); if (p.kind !== 'fish-audio') fail('INVALID_INPUT')
      const result = await discovery.search(p,await secrets(p),input)
      for (const voice of result.voices) knownFishVoices(p).set(voice.voiceId,voice)
      return result
    },
    // only a sample this service's discovery listed (catalogue, search, ID lookup)
    // is fetched into the same-origin sample cache → {url, loudness} for the preview bus.
    async fishSample({serviceId,voiceId}) {
      const p = record(serviceId), voice = p.kind === 'fish-audio' && knownFishVoices(p).get(voiceId)
      if (!voice?.sampleUrl) fail('SAMPLE_UNAVAILABLE')
      const clip = await samples.clip({provider:'fish-audio',voiceId,url:voice.sampleUrl})
      return {url:'/api/dsh-tts/v1/sample?key=' + clip.key,loudness:clip.loudness}
    },
    async listOnlinePresetVoices({provider,serviceId}) {
      if (!['qwen','azure','volcengine','minimax'].includes(provider)) fail('INVALID_INPUT')
      const configured = get().providers.filter(p => p.kind === provider)
      if (!serviceId && configured.length > 1) fail('SERVICE_REQUIRED')
      const p = serviceId ? record(serviceId) : configured[0]
      if (p && p.kind !== provider) fail('INVALID_INPUT')
      if (['volcengine','minimax'].includes(provider)) return {provider,status:'ok',voices:(await adapters[provider].catalog()).items,models:[],source:'builtin'}
      return onlineList(provider,p)
    },
    async probe(input = {}) {
      let p
      try {
        p = { id:input.id || 'draft', kind:input.kind, config:providerConfig(input.kind, input.config) }
      } catch (e) { return { status:'invalid', message:e.message, voices:[], models:[], source:'none' } }
      const typed = Object.values(input.secrets || {}).some(Boolean)
      const { error, ...result } = await check(p, await draftSecrets(p.kind, input.id, input.secrets || {}, p.config))
      const saved = get().providers.find(s => s.id === input.id)
      if (saved && saved.kind === p.kind && canonical(saved.config) === canonical(p.config) && !typed) remember(saved, result)
      return result
    },
    async voices({ id }) {
      const p = record(id), secret = await draftSecrets(p.kind, p.id)
      if (!secret && p.kind === 'azure') return { status:'credentials-required', voices:[], models:[], source:'none' }
      try { return { status:'ok', ...await baseVoices(p, secret || {}) } }
      catch (e) { return { status:'error', message:String(e?.message || e).slice(0,300), voices:[], models:[], source:'none' } }
    },
    voiceModelStatus(input = {}) {
      const p = get().providers.find(p => p.id === input.serviceId)
      const kind = p?.kind || input.provider
      const modelInstructions = kind === 'qwen' ? qwenModelInstructions(input.model || 'qwen3-tts-flash') : null
      return {...api.validateVoiceModel(input), modelInstructions}
    },
    validateVoiceModel({serviceId,provider,model,voiceName} = {}) {
      const candidates = get().providers.filter(p => serviceId ? p.id === serviceId : p.kind === provider)
      if (candidates.length !== 1 || provider && candidates[0].kind !== provider) return {issues:[]}
      return validation.get(modelIdentity(candidates[0], model, voiceName))
    },
    listVoicePresets() { return structuredClone(get().voices || []) },
    saveVoicePreset({preset, expectedRevision}) { return serial(async () => {
      const next = voicePreset(preset), voices = api.listVoicePresets(), old = voices.find(v => v.id === next.id)
      if (!old && (await tts.listServiceVoices()).some(v => v.id === next.id)) fail('REVISION_CONFLICT')
      if (old ? expectedRevision !== hash(old) : expectedRevision != null) fail('REVISION_CONFLICT')
      await replace(validateSettings({...get(), voices:[...voices.filter(v => v.id !== next.id), next]})); api.sync()
      const {issues} = api.validateVoiceModel({serviceId:next.providerId,provider:next.kind,model:next.params?.model,voiceName:next.params?.voice})
      return {preset:next, revision:hash(next), ...(issues.length ? {issues} : {})}
    }) },
    deleteVoicePreset({id, expectedRevision}) { return serial(async () => {
      const voices = api.listVoicePresets(), old = voices.find(v => v.id === id)
      if (!old || hash(old) !== expectedRevision) fail('REVISION_CONFLICT')
      await replace({...get(), voices:voices.filter(v => v.id !== id)}); api.sync(); return {deleted:true}
    }) },
    importVoicePresets({presets}) { return serial(async () => {
      if (!Array.isArray(presets) || presets.length > 256) fail('INVALID_INPUT')
      const incoming = presets.map(voicePreset), voices = api.listVoicePresets(), result = {added:[], unchanged:[], conflicts:[]}
      if (new Set(incoming.map(v => v.id)).size !== incoming.length) fail('INVALID_INPUT')
      const existing = await tts.exportVoicePresets(incoming.map(v => v.id))
      for (const next of incoming) {
        const old = existing.find(v => v.id === next.id)
        if (old) result[canonical(old) === canonical(next) ? 'unchanged' : 'conflicts'].push(next.id)
        else { voices.push(next); result.added.push(next.id) }
      }
      if (result.added.length) { await replace(validateSettings({...get(), voices})); api.sync() }
      return result
    }) },
    sync() {
      const voices = (get().voices || []).map(voicePreset), revision = hash(voices)
      if (revision !== voiceRevision) {
        const input = {owner:'dsh-tavern-tts',sourceId:'voice-presets',revision,voices,bindings:{}}
        if (voiceSource) voiceSource.replace(input,voiceRevision); else voiceSource = tts.registerVoiceSource(input)
        voiceRevision = revision
      }
      // each provider's revision is hashed once per sync and reused for registration.
      const wanted = new Map(get().providers.map(p => [p.id,{p,revision:hash(p)}]))
      for (const [id, e] of registrations) if (e.revision !== wanted.get(id)?.revision) { e.dispose(); registrations.delete(id) }
      for (const {p, revision} of wanted.values()) {
        if (registrations.has(p.id) || !adapters[p.kind]) continue
        const adapter = adapters[p.kind]
        // do not reuse audio rendered with Volcengine's old language filter.
        const audioRevision = p.kind === 'volcengine' ? hash([revision, 'v3-api-key-json-additions-v2']) : revision
        const customFish = p.kind === 'fish-audio' && !isFishCloud(p.config)
        const model = customFish ? {label:p.config.model,billing:'unknown'} : fishModel(p.config.model)
        const port = { id:p.id, kind:p.kind, revision:audioRevision, model:p.config.model ?? null, endpoint:p.config.url || p.kind + ':' + (p.config.region || p.config.appId), capabilities:{ referenceInput:p.kind === 'fish-audio' ? ['bytes-v1','bytes-list-v1'] : [], paid:p.kind === 'fish-audio' ? model.billing !== 'free' : providerKind(p.kind).paid, ...(p.kind === 'fish-audio' ? {voiceKinds:['fish-audio','reference'],referenceLimits:{count:null,totalBytes:null,formats:['wav','mp3']},model:p.config.model,modelLabel:model.label,billing:model.billing,voiceDirections:model.voiceDirections === true,prepareVoice:false,stream:{sampleRate:44100}} : {}), ...(p.kind === 'qwen' ? {serviceVoiceEngines:['qwen']} : {}), ...(p.kind === 'minimax' ? {billing:'paid'} : {}) },
          validateModel: (model, voiceName) => api.validateVoiceModel({serviceId:p.id,model,voiceName}),
          // A custom Fish server takes the server's own `/v1/hold` lease when it advertises one.
          ...(customFish ? {hold:async () => adapter.hold(p, await secrets(p))} : {}),
          ...(customFish ? {info:async () => adapter.info(p, await secrets(p), true)} : {}),
          ...(customFish ? {
            discover: async () => {
              const info = await adapter.info(p, await secrets(p)), selected = p.config.model ? info.models.find(m => m.id === p.config.model) : info.models[0]
              Object.assign(port.capabilities, {prepareVoice:info.capabilities.prepareVoice,voiceDirections:selected?.voiceDirections ?? info.capabilities.voiceDirections,
                paid:selected?.billing !== 'free',billing:selected?.billing || 'unknown',modelLabel:selected?.label || p.config.model,
                ...(info.capabilities.concurrency ? {concurrency:info.capabilities.concurrency} : {}),...(info.capabilities.loadTimeoutMs !== undefined ? {loadTimeoutMs:info.capabilities.loadTimeoutMs} : {})})
            },
            prewarm: async (spec, options) => adapter.prewarm(p, await secrets(p), {...spec, signal:options.signal}),
          } : {}),
          health: async () => { try { await secrets(p) } catch { return {state:'credentials-required'} }; return {state:'configured', probed:false} },
          catalog: async () => (await adapter.catalog(p, await secrets(p))).items,
          synthesize: async (spec, options) => {
            const identity = modelIdentity(p, spec.params?.model, spec.params?.voice)
            try {
              const audio = await adapter.synthesize(p, await secrets(p), { ...spec, signal:options.signal, ...(options.onPcm ? {onPcm:options.onPcm} : {}) })
              if (!options.signal?.aborted) validation.record(identity, null)
              return audio
            } catch (error) {
              if (!options.signal?.aborted) validation.record(identity, error)
              throw error
            }
          },
        }
        const dispose = tts.registerProvider('dsh-tavern-tts', port)
        registrations.set(p.id, {revision,dispose})
      }
    },
    // The configured voice services catalog (ttsControl `voiceServices`, Tts.listVoiceServices): every saved service and
    // 浏览器朗读, without keys, URLs or config. It reads no network; `state` is the last connection check of this activation.
    async voiceServices() {
      const services = await Promise.all(get().providers.map(async p => {
        const kind = providerKind(p.kind), revision = hash(p), check = checks.get(p.id)?.revision === revision ? checks.get(p.id) : null
        const fish = p.kind === 'fish-audio', custom = fish && !isFishCloud(p.config) || p.kind === 'openai-compatible'
        const keyless = !custom && (await Promise.all(kind.fields.filter(f => f.secret).map(f => describeSecret(p,f)))).some(s => !s.configured)
        const state = keyless || check?.status === 'credentials-required' ? 'needs-key' : !check ? 'configured' : ['connected','reachable'].includes(check.status) ? 'ready' : 'offline'
        return {id:p.id, kind:p.kind, label:p.label || kind.label, state, billing:fish ? custom ? 'unknown' : fishModel(p.config.model).billing : kind.paid ? 'paid' : 'free',
          sources:fish ? ['reference-list','voice-id'] : ['preset'], voiceList:custom ? 'provider' : fish ? 'fish-recommended' : 'preset'}
      }))
      return {services:[...services, structuredClone(BROWSER_VOICE_SERVICE)], kinds:Object.fromEntries([...PROVIDER_KINDS.map(k => [k.kind,k.label]), ['browser',BROWSER_VOICE_SERVICE.label]])}
    },
    async list() { return Promise.all(get().providers.map(async p => { const revision = hash(p); return { ...structuredClone(p), category:p.kind === 'fish-audio' && !isFishCloud(p.config) || p.kind === 'openai-compatible' ? 'custom' : 'builtin', revision, ...(checks.get(p.id)?.revision === revision ? {check:{...checks.get(p.id)}} : {}), secrets:Object.fromEntries(await Promise.all(providerKind(p.kind).fields.filter(f => f.secret).map(async f => [f.key, await describeSecret(p,f)])))} })) },
    save(input) { return serial(async () => {
      const before = get(), old = before.providers.find(p => p.id === input.id)
      if (old && (input.expectedRevision !== hash(old) || old.kind !== input.kind)) fail('REVISION_CONFLICT')
      if (!PROVIDER_ID.test(input.id)) fail('INVALID_INPUT')
      const next = { id:input.id, kind:input.kind, label:String(input.label || input.id).slice(0,160), config:providerConfig(input.kind,input.config) }
      const fields = providerKind(next.kind).fields.filter(f => f.secret), writes = [], c = credentials()
      if (old && old.config.url !== next.config.url && fields.some(f => !Object.hasOwn(input.secrets || {},f.key))) fail('INVALID_INPUT')
      if (Object.keys(input.secrets || {}).some(k => !fields.some(f => f.key === k))) fail('INVALID_INPUT')
      for (const f of fields) if (input.secrets?.[f.key] !== undefined) {
        const value = input.secrets[f.key], ref = credentialRef(next.id,f.key)
        if (!c && value === '') continue
        if (!c || typeof value !== 'string' || value.length > 4096 || /[\r\n]/.test(value)) fail('CREDENTIALS_REQUIRED')
        if ((await c.describe(ref)).writable === false) fail('CREDENTIALS_READ_ONLY')
        writes.push({ref,value,previous:(await c.resolve(ref))?.value})
      }
      const applied = []
      try {
        for (const w of writes) { applied.push(w); if (w.value) await c.set(w.ref,w.value); else await c.unset(w.ref) }
        await replace({ ...before, providers:[...before.providers.filter(p => p.id !== next.id), next] })
      } catch {
        let failed = false
        for (const w of applied.reverse()) try { if (w.previous) await c.set(w.ref,w.previous); else await c.unset(w.ref) } catch { failed = true }
        fail(failed ? 'ROLLBACK_FAILED' : 'SETTINGS_WRITE_FAILED')
      }
      if (writes.length) { checks.delete(next.id); credentialEpochs.set(next.id,(credentialEpochs.get(next.id) || 0) + 1) }
      api.sync(); changed(); return (await api.list()).find(p => p.id === next.id)
    }) },
    delete({ id, expectedRevision, force }) { return serial(async () => {
      const p = record(id); if (expectedRevision !== hash(p)) fail('REVISION_CONFLICT')
      if (!force && (await tts.inspectUsage(id)).some(u => u.unknown || u.count > 0)) fail('SERVICE_IN_USE')
      await replace({ ...get(), providers:get().providers.filter(p => p.id !== id) }); checks.delete(id); credentialEpochs.set(id,(credentialEpochs.get(id) || 0) + 1); api.sync(); changed()
      // Existing shared credential refs may still serve Tavern; phase 5 decides removal.
      return { deleted:true, credentialsRetained:true }
    }) },
    // the outcome is data, never a thrown error, so the provider's problem reaches the
    // form in plain words instead of the control route's generic REQUEST_FAILED.
    async test({id}) {
      const p = record(id), a = adapters[p.kind]; if (!a) fail('SERVICE_OFFLINE')
      const secret = await draftSecrets(p.kind, p.id), { error, ...result } = await check(p, secret)
      remember(p, result)
      const ok = ['connected','reachable'].includes(result.status)
      return {ok, status:result.status, ...(result.message ? {message:result.message} : {}), voiceCount:result.voices.length, reachable:ok,
        synthesisTested:result.synthesisTested === true, credentialScope:p.kind === 'qwen' ? 'models' : ['volcengine','openai-compatible'].includes(p.kind) && result.synthesisTested ? 'synthesis' : 'catalog'}
    },
    dispose() { validation.clear(); credentialEpochs.clear(); onlineLists.clear(); voiceSource?.dispose(); voiceSource = undefined; voiceRevision = undefined; for (const e of registrations.values()) e.dispose(); registrations.clear() },
  }
  return api
}
