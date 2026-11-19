import {FISH_CLOUD_CONCURRENCY, FISH_DEFAULT_MODEL, FISH_MODELS, fishModel, isFishCloud} from './providers/fish-models.js'
import z from '@deepseek-ai/schemastery'
import { providerConfig, providerKind, credentialRef, PROVIDER_ID, PROVIDER_KINDS } from './providers/params.js'
import { createOpenAICompatibleAdapter } from './providers/openai-compatible.js'
import { createFishDiscovery } from './providers/fish-discovery.js'
import recommendedFishVoices from './shared/fish-recommended.json' with {type:'json'}
import { createAzureAdapter, azureVoices } from './providers/azure.js'
import { createQwenAdapter, qwenModelInstructions, qwenVoices, QWEN_MODELS } from './providers/qwen.js'
import { createFishAudioAdapter } from './providers/fish-audio.js'
import { createVoicePilot } from './providers/fish-voice-design.js'
import { createVolcengineAdapter } from './providers/volcengine.js'
import { createMinimaxAdapter, MINIMAX_MODELS } from './providers/minimax.js'
import { hash, canonical, fail, voicePreset, describeTtsError, wav, durationMs } from './core.js'
import { boundedFetch } from './providers/fetch.js'
import { createModelValidation } from './model-validation.js'
import { endpointHistory } from './endpoint-history.js'

// 台词朗读: 通用声音 and 旁白 each point at one figure of the asset library ({packId, figureId}: they speak with that figure's
// voice; null = the browser's default voice) and 旁白配音's global switch (off by default). Schemastery drops null defaults, so
// readingOf fills them.
const Reading = z.object({ general: z.object({ figure: z.any() }), narrator: z.object({ enabled: z.boolean().default(false), figure: z.any() }) })
export const Settings = z.object({ enabled: z.boolean().default(true), providers: z.array(z.any()).default([]), voices: z.array(z.any()).default([]),
  reading: Reading,
  fishVoiceIdService: z.string().default(''),
  cacheMaxGB: z.number().min(0.1).max(100).default(1).description('\u7f13\u5b58\u4e0a\u9650\uff08GB\uff09'),
  cacheMaxAgeDays: z.natural().min(1).max(3650).default(30).description('\u7f13\u5b58\u4fdd\u7559\u5929\u6570'),
})
// The service kinds whose model is each figure's choice (its voice source's `model`) since 语音后端 keeps only the connection.
const MODEL_MOVED = ['fish-audio', 'minimax']
// The one place a service's default model is chosen: a figure's source that names no model speaks with it. The service's
// 默认模型 (config.defaultModel) while the service lists it, else the first listed (`models` lists the adapter's own
// fallback first: the Fish cloud's free model, a server's first, Qwen's and MiniMax's default). An empty list (a server not
// asked yet) takes the named default as is, or none (the adapter decides). Being part of a line's identity, it keeps lines
// cached under an explicitly named model reachable once the source follows the default instead.
export function serviceDefaultModel(p, models) {
  const id = p.config?.defaultModel
  return id && (!models.length || models.some(m => m.id === id)) ? id : models[0]?.id
}
export function validateSettings(value) {
  if (typeof value.enabled !== 'boolean' || (value.fishVoiceIdService && !PROVIDER_ID.test(value.fishVoiceIdService))) fail('INVALID_INPUT')
  if (!Number.isFinite(value.cacheMaxGB) || value.cacheMaxGB < 0.1 || value.cacheMaxGB > 100 || !Number.isInteger(value.cacheMaxAgeDays) || value.cacheMaxAgeDays < 1 || value.cacheMaxAgeDays > 3650) fail('INVALID_INPUT')
  const seen = new Set()
  for (const p of value.providers) {
    if (!PROVIDER_ID.test(p.id) || seen.has(p.id)) fail('INVALID_INPUT')
    seen.add(p.id); providerKind(p.kind); providerConfig(p.kind, p.config)
    if (Object.keys(p).some(k => !['id','kind','label','config'].includes(k))) fail('INVALID_INPUT')
    const normalized = providerConfig(p.kind, p.config)
    // A Fish or MiniMax service saved before the model moved to the figure still carries config.model until the one-time
    // migration (legacyServiceModels → dropLegacyServiceModels) runs; the plugin must load that config to run it.
    const legacy = MODEL_MOVED.includes(p.kind) && typeof p.config?.model === 'string'
    const saved = legacy ? Object.fromEntries(Object.entries(p.config).filter(([key]) => key !== 'model')) : p.config
    // An OpenAI-compatible service saved before 自定义语音服务 ({url, speechPath, modelsPath, voicesPath}) reads as the
    // OpenAI preset until the one-time upgradeHttpServices writes it out in full.
    if (p.kind === 'openai-compatible' && p.config?.preset === undefined) continue
    if (canonical(normalized) !== canonical(saved)) fail('INVALID_INPUT')
  }
  const voices = value.voices || []
  if (!Array.isArray(voices) || voices.length > 256 || new Set(voices.map(v => voicePreset(v).id)).size !== voices.length) fail('INVALID_INPUT')
  // the dictionary lives in reading presets (readings.json), not settings.
  if (Object.hasOwn(value,'readings') || Object.hasOwn(value,'dictionaryPath')) fail('UNKNOWN_FIELD')
  return value
}
export function readingOf(settings) {
  const r = settings.reading || {}
  return { general: { figure: r.general?.figure ?? null }, narrator: { enabled: r.narrator?.enabled === true, figure: r.narrator?.figure ?? null } }
}
const plainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v)
// 通用声音 / 旁白's figure: null, or a figure of an installed pack (whether it exists is the speaker's to find out).
function figureRef(v) {
  if (v === null) return null
  const uuid = s => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s)
  if (plainObject(v) && Object.keys(v).sort().join() === 'figureId,packId' && uuid(v.packId) && typeof v.figureId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v.figureId)) return {packId:v.packId, figureId:v.figureId}
  fail('INVALID_READING_VOICE')
}
// Validated once here, on write; a bad patch is a repairable INVALID_READING_VOICE.
export function patchReading(current, patch) {
  const next = readingOf({ reading: current })
  if (!plainObject(patch) || Object.keys(patch).some(k => !['general','narrator'].includes(k))) fail('INVALID_READING_VOICE')
  if (patch.general !== undefined) {
    if (!plainObject(patch.general) || Object.keys(patch.general).some(k => k !== 'figure')) fail('INVALID_READING_VOICE')
    if (Object.hasOwn(patch.general,'figure')) next.general.figure = figureRef(patch.general.figure)
  }
  if (patch.narrator !== undefined) {
    const n = patch.narrator
    if (!plainObject(n) || Object.keys(n).some(k => !['enabled','figure'].includes(k))) fail('INVALID_READING_VOICE')
    if (n.enabled !== undefined) { if (typeof n.enabled !== 'boolean') fail('INVALID_READING_VOICE'); next.narrator.enabled = n.enabled }
    if (Object.hasOwn(n,'figure')) next.narrator.figure = figureRef(n.figure)
  }
  return next
}
// Pure migration primitive. No files, credentials, or automatic startup writes.
// 浏览器朗读 is always in the voice services catalog: the device's own voices, free, nothing to set up.
export const BROWSER_VOICE_SERVICE = Object.freeze({id:'browser', kind:'browser', label:'浏览器朗读', state:'ready', billing:'free', sources:Object.freeze(['preset']), voiceList:'browser', voice:Object.freeze(['voice']), models:Object.freeze([])})
export function importProviders(document) {
  if (document?.version !== 1 || !Array.isArray(document.providers)) fail('API_INCOMPATIBLE')
  return validateSettings({ enabled:true, providers: document.providers.map(p => ({ id:p.id, kind:p.kind, label:String(p.label || p.id).slice(0,160), config:providerConfig(p.kind,p.config) })), cacheMaxGB:1, cacheMaxAgeDays:30 })
}

// provider failures in plain words; adapters never put bodies, URLs or keys in messages.
const PLAIN_ERRORS = {FISH_AUTH_FAILED:'服务要求鉴权，请填写或检查 API Key 与访问权限',FISH_BILLING_REQUIRED:'Fish Audio 额度或余额不足',FISH_RATE_LIMITED:'Fish Audio 请求太频繁，稍后再试',FISH_REQUEST_FAILED:'Fish Audio 请求失败',
  CREDENTIALS_REQUIRED:'缺少 API Key',SERVICE_OFFLINE:'连不上服务',TIMEOUT:'请求超时',ABORTED:'已取消'}
export function plainError(error) {
  const message = String(error?.message || '')
  if (error?.code?.startsWith('MINIMAX_')) return message
  if (error?.code === 'PROVIDER_AUTH_FAILED') return describeTtsError(error.code)
  if (PLAIN_ERRORS[error?.code]) return PLAIN_ERRORS[error.code]
  if (/[\u3400-\u9fff]/.test(message)) return message.slice(0,300)
  return PLAIN_ERRORS[message] || '请求失败'
}
// \changed\: called when the voice services catalog changes (a service saved, removed or checked).
export function createServiceSettings({ tts, get, replace, credentials, fetch, warn, samples, pilotBudgetRoot, changed = () => {} }) {
  const voicePilot = createVoicePilot({fetch, budgetRoot:pilotBudgetRoot})
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
  // A cloud service with an unset secret cannot speak; a self-hosted Fish or OpenAI-compatible server may run keyless.
  async function missingKey(p) {
    if (p.kind === 'openai-compatible' || p.kind === 'fish-audio' && !isFishCloud(p.config)) return false
    return (await Promise.all(providerKind(p.kind).fields.filter(f => f.secret).map(f => describeSecret(p,f)))).some(s => !s.configured)
  }
  const record = id => { const p = get().providers.find(p => p.id === id); if (!p) fail('SERVICE_OFFLINE'); return p }
  // 最近用过的连接 (endpoint-history.js): a service with a Base URL keeps the {网址, API Key} pairs it connected with.
  const urlKind = kind => providerKind(kind).fields.some(f => f.key === 'url')
  const recent = p => endpointHistory(credentials, credentialRef(p.id, 'recent'))
  // a successful check of a saved service records the pair it used (written only when it is not already the latest).
  const noteWorking = (p, result, secret) => { if (urlKind(p.kind) && ['connected','reachable'].includes(result.status)) return serial(() => recent(p).remember({url:p.config.url, key:secret?.key || ''})).catch(error => warn?.('dsh-tavern-tts: recent connection not recorded (' + (error?.code || 'error') + ')')) }
  // service setup flow.
  // Last connection check per saved service, kept in memory for this activation only.
  const checks = new Map(), onlineLists = new Map(), FAILED_READ_RETRY_MS = 3000
  // Opening a picker never waits for credentials or a remote catalogue.
  function onlineList(provider, p) {
    // MiniMax has no voice list of its own here: its voices are the account's (/v1/get_voice), read in the background.
    const builtin = provider === 'azure' ? {voices:azureVoices(),models:[],source:'builtin'} : provider === 'minimax' ? {voices:[],models:structuredClone(MINIMAX_MODELS),source:'none'} : {voices:qwenVoices(),models:structuredClone(QWEN_MODELS),source:'builtin'}
    if (!p) return {provider,status:'ok',...builtin}
    const key = hash([p,credentialEpochs.get(p.id) || 0])
    let entry = onlineLists.get(p.id)
    if (!entry || entry.key !== key) { entry = {key,value:builtin,at:0,refreshing:false}; onlineLists.set(p.id,entry) }
    if (!entry.refreshing && Date.now() - entry.at > 300000) {
      entry.refreshing = true
      void (async () => {
        // Azure, Qwen and MiniMax catalogues are cloud APIs: without a key the builtin list stands and nothing is requested.
        let failed = false
        try {
          const secret = await draftSecrets(provider,p.id)
          if (secret.key) { entry.value = await baseVoices(p,secret); entry.message = undefined }
          else if (provider === 'minimax') { failed = true; entry.message = 'MiniMax 缺少 API Key，没有读到账号下的音色；请到语音后端填写后重试。' }
        } catch (error) { failed = true; entry.message = plainError(error) + (entry.value.voices.length ? '；已保留可选声音，请在语音后端检查连接后重试。' : '；没有读到音色，请在语音后端检查连接后重试。') }
        // a failed read is asked again a few seconds later (an open or 重试), not kept for five minutes
        finally { entry.at = Date.now() - (failed ? 300000 - FAILED_READ_RETRY_MS : 0); entry.refreshing = false }
      })()
    }
    return {provider,status:'ok',...structuredClone(entry.value),refreshing:entry.refreshing,...(entry.message ? {message:entry.message} : {})}
  }
  const authFailed = error => [error?.code, error?.category, error?.message].some(c => typeof c === 'string' && /_AUTH_FAILED$|^(CREDENTIALS_INVALID|UNAUTHORIZED)$/.test(c))
  // A self-hosted Fish server (a local worker) is not a cloud account. It has no key to get wrong: if it answers 401 its own
  // token differs from the one saved on this row, and if it does not answer at all it is not running.
  const selfHosted = p => p.kind === 'fish-audio' && !isFishCloud(p.config)
  const SELF_HOSTED_WORDS = {rejected:'服务拒绝了这次访问：它设置了访问令牌，这一行保存的与它不符', offline:'没有连上服务，它可能还没有启动'}
  // The one place a failed check becomes a status: invalid-key (a cloud service refused the key) · rejected (a self-hosted
  // server refused) · offline (nothing answered) · error (anything else). The words of a self-hosted row never mention a key.
  function checkOutcome(p, result) {
    if (result.status !== 'error') return {status:result.status, message:result.message}
    const status = authFailed(result.error) ? selfHosted(p) ? 'rejected' : 'invalid-key' : result.error?.code === 'SERVICE_OFFLINE' ? 'offline' : 'error'
    return {status, message:selfHosted(p) && SELF_HOSTED_WORDS[status] || result.message}
  }
  // A failed connection is a moment's observation, not a property of the service: the backend may have been loading (or
  // restarted by DSH itself) when it was made. A self-hosted server starts and stops by itself, so every check of it expires
  // (the open page asks again); a cloud service's failure expires, its success and refused key stay until its config changes.
  const OFFLINE_CHECK_MS = 15000, SELF_HOSTED_CHECK_MS = 60000
  const checkExpiry = (p, c) => selfHosted(p) ? SELF_HOSTED_CHECK_MS : ['error','offline'].includes(c.status) ? OFFLINE_CHECK_MS : Infinity
  const checkOf = (p, revision) => { const c = checks.get(p.id); return c?.revision === revision && Date.now() - c.at <= checkExpiry(p, c) ? c : null }
  const remember = (p, result) => { const {status, message} = checkOutcome(p, result); checks.set(p.id, { revision:hash(p), status, ...(message ? {message} : {}), voiceCount:result.voices.length, at:Date.now() }); changed() }
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
      if (!['azure','minimax'].includes(p.kind)) try { listed = await baseVoices(p, {}) } catch {}
      return { status:'credentials-required', message:'缺少 API Key', ...listed }
    }
    try {
      if (p.kind === 'qwen' && !secret.key) await a.probe(p, secret)
      if (['azure','qwen','minimax'].includes(p.kind)) return { status:'connected', ...await baseVoices(p, secret) }
      if (p.kind === 'openai-compatible') {
        const listed = await baseVoices(p, secret)
        return listed.source === 'live' ? { status:'connected', ...listed } : { ...await a.verify(p, secret), ...listed }
      }
      if (p.kind === 'volcengine') return { ...await a.verify(p, secret), ...await baseVoices(p, secret) }
      if (selfHosted(p)) {
        const listed = await baseVoices(p, secret)
        const {state, loaded, resourceBlocked, capabilities} = listed
        const message = state === 'paused' ? '语音模型已暂停，暂时不能合成' :
          state === 'error' ? '语音模型报告故障，暂时不能合成' :
          resourceBlocked ? '系统资源不足，暂时不能合成' :
          state === 'loading' ? '语音模型正在加载，稍后再试' :
          loaded === false && state !== 'sleeping' && !capabilities.idleUnloadMs ? '服务已启动，但语音模型尚未加载，暂时不能合成' : null
        return { ...listed, status:message ? 'not-ready' : 'connected', ...(message ? {message} : {}) }
      }
      if (a.probe) await a.probe(p, secret); else await a.catalog(p, secret)
      return { status:'connected', ...await baseVoices(p, secret) }
    } catch (error) {
      return { status:'error', message:plainError(error), voices:[], models:[], source:'none', error }
    }
  }
  // What a figure picks for a source of this service (its kind's `voice` declaration) and the models it picks from, the
  // adapter's fallback first; a server that does not answer its model list lists none (a figure keeps its own pick).
  // `defaultModel`: the one a source naming none speaks with; `defaultModelMissing`: the service's 默认模型 is not listed.
  async function serviceModels(p) {
    const kind = providerKind(p.kind), custom = p.kind === 'fish-audio' && !isFishCloud(p.config)
    const models = !kind.voice.includes('model') ? [] : p.kind === 'qwen' ? QWEN_MODELS.map(m => ({id:m.id,label:m.label})) : p.kind === 'minimax' ? MINIMAX_MODELS.map(m => ({id:m.id,label:m.label}))
      : p.kind !== 'fish-audio' ? []
      : custom ? await secrets(p).then(secret => adapters[p.kind].info(p, secret)).then(i => i.models.map(m => ({id:m.id,label:m.label})), () => [])
      : [...FISH_MODELS].sort((a,b) => (b.id === FISH_DEFAULT_MODEL) - (a.id === FISH_DEFAULT_MODEL)).map(m => ({id:m.id,label:m.label}))
    const defaultModel = serviceDefaultModel(p, models)
    return {models, ...(defaultModel ? {defaultModel} : {}), ...(p.config?.defaultModel && defaultModel !== p.config.defaultModel ? {defaultModelMissing:true} : {})}
  }
  // the models a service is known to list without asking it (a Fish server's own list is asked: none known here).
  const listedModels = p => p.kind === 'fish-audio' ? isFishCloud(p.config) ? FISH_MODELS : [] : p.kind === 'qwen' ? QWEN_MODELS : p.kind === 'minimax' ? MINIMAX_MODELS : []
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
    voicePilot(args) {
      const p = record(args.serviceId)
      return voicePilot(args, p, async () => (await secrets(p)).key)
    },
    // One short line through the service's own adapter (the path a figure's line takes), to check a voice speaks. The audio is
    // measured here and not returned; nothing is cached or played.
    async voiceSynth({serviceId, params, text}) {
      const p = record(serviceId), a = adapters[p.kind]
      if (!a || typeof text !== 'string' || !text.trim() || text.length > 200 || !params || typeof params !== 'object') fail('INVALID_INPUT')
      const model = params.model ?? serviceDefaultModel(p, listedModels(p))
      const started = Date.now(), audio = wav(await a.synthesize(p, await secrets(p), {text, params:{...params, ...(model ? {model} : {})}, signal:AbortSignal.timeout(120000)}))
      let peak = 0
      for (let at = audio.length - (audio.length % 2) - 2; at >= 44; at -= 2) peak = Math.max(peak, Math.abs(audio.readInt16LE(at)))
      return {serviceId, kind:p.kind, ...(model ? {model} : {}), durationMs:durationMs(audio), bytes:audio.length, peak:+(peak / 32768).toFixed(4), elapsedMs:Date.now() - started}
    },
    // Read-only names for the CLI. Host records are listed by key only; each saved Fish service is asked by its canonical
    // credential ref through describe alone. `present` is the host's configured flag, never a value or a successful lookup.
    async credentialNames() {
      const c = credentials()
      if (typeof c?.listRecords !== 'function' || typeof c?.describe !== 'function') fail('CREDENTIALS_UNAVAILABLE')
      try {
        const records = (await c.listRecords()).map(r => { const i = r.key.indexOf('/'); return {serviceId:null, scope:r.key.slice(0,i), key:r.key.slice(i+1), present:true} })
        const fish = []
        for (const p of get().providers.filter(p => p.kind === 'fish-audio')) for (const f of providerKind(p.kind).fields.filter(f => f.secret)) {
          const ref = credentialRef(p.id,f.key)
          fish.push({serviceId:p.id, scope:null, key:ref, present:(await c.describe(ref))?.configured === true})
        }
        return {records, fish}
      } catch { fail('CREDENTIALS_UNAVAILABLE') }
    },
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
      if (provider === 'volcengine') return {provider,status:'ok',voices:(await adapters[provider].catalog()).items,models:[],source:'builtin'}
      return onlineList(provider,p)
    },
    async probe(input = {}) {
      let p
      try {
        p = { id:input.id || 'draft', kind:input.kind, config:providerConfig(input.kind, input.config) }
      } catch (e) { return { status:'invalid', message:e.message, voices:[], models:[], source:'none' } }
      const typed = Object.values(input.secrets || {}).some(Boolean)
      const secret = await draftSecrets(p.kind, input.id, input.secrets || {}, p.config), { error, ...result } = await check(p, secret)
      const saved = get().providers.find(s => s.id === input.id)
      if (saved && saved.kind === p.kind && canonical(saved.config) === canonical(p.config) && !typed) { remember(saved, {...result, error}); await noteWorking(saved, result, secret) }
      return result
    },
    async voices({ id }) {
      const p = record(id), secret = await draftSecrets(p.kind, p.id)
      if (!secret?.key && ['azure','minimax'].includes(p.kind)) return { status:'credentials-required', voices:[], models:[], source:'none' }
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
    // One-time move of the Fish / MiniMax model to the figure (语音后端 keeps only the connection): the services whose saved
    // config still names a model, read once by the stage's migration (it writes the model into the figure sources that
    // speak through them), then dropped from the saved config. Nothing reads a service model otherwise.
    legacyServiceModels() { return get().providers.filter(p => MODEL_MOVED.includes(p.kind) && typeof p.config?.model === 'string' && p.config.model).map(p => ({serviceId:p.id, kind:p.kind, model:p.config.model})) },
    dropLegacyServiceModels() { return serial(async () => {
      const value = get(), providers = value.providers.map(p => MODEL_MOVED.includes(p.kind) && p.config && 'model' in p.config ? {...p, config:Object.fromEntries(Object.entries(p.config).filter(([key]) => key !== 'model'))} : p)
      if (canonical(providers) === canonical(value.providers)) return {dropped:0}
      await replace(validateSettings({...value, providers})); api.sync()
      return {dropped:providers.filter((p, i) => p !== value.providers[i]).length}
    }) },
    // One-time: services saved before 自定义语音服务 are written out as their full connection (the OpenAI preset's values
    // with their own address and paths); nothing else changes.
    upgradeHttpServices() { return serial(async () => {
      const value = get(), providers = value.providers.map(p => p.kind === 'openai-compatible' && p.config?.preset === undefined ? {...p, config:providerConfig(p.kind, p.config)} : p)
      const upgraded = providers.filter((p, i) => p !== value.providers[i]).length
      if (upgraded) { await replace(validateSettings({...value, providers})); api.sync() }
      return {upgraded}
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
        // A Fish service's models (the cloud's known list, a server's discovered one): each figure picks its own (its
        // source's `model`); `speaking` is what one of them costs and can do, the first listed when none is picked.
        let fishModels = customFish ? [] : structuredClone(FISH_MODELS)
        const speaking = model => {
          const found = model ? fishModels.find(m => m.id === model) : fishModels.find(m => m.id === FISH_DEFAULT_MODEL) || fishModels[0]
          // Until a server has answered, a named model takes directions as the known model does: the spoken text (and the
          // cached line it names) must not depend on whether the server was asked yet.
          const m = found || (model ? {id:model,label:model,billing:customFish ? 'unknown' : fishModel(model).billing,voiceDirections:fishModel(model).voiceDirections} : null)
          return m ? {model:m.id,modelLabel:m.label,billing:m.billing || 'unknown',paid:m.billing !== 'free',voiceDirections:m.voiceDirections === true} : {billing:'unknown',paid:true,voiceDirections:false}
        }
        // 配音来源 (Provider.capabilities.voiceSources): what the protocol always serves (its kind's declaration); a Fish
        // service adds voice IDs in discover, once its own server answers that it serves a voice library.
        const voiceSources = [...providerKind(p.kind).voiceSources]
        const voiceList = p.kind === 'fish-audio' ? customFish ? 'provider' : 'fish-recommended' : p.kind === 'openai-compatible' ? 'provider' : 'preset'
        const port = { id:p.id, kind:p.kind, label:p.label || providerKind(p.kind).label, revision:audioRevision, endpoint:p.config.url || p.kind + ':' + (p.config.region || p.config.appId), capabilities:{ voiceSources, voiceList, referenceInput:p.kind === 'fish-audio' ? ['bytes-v1','bytes-list-v1'] : [], paid:providerKind(p.kind).paid, ...(p.kind === 'fish-audio' ? {voiceKinds:['fish-audio','reference'],referenceLimits:{count:null,totalBytes:null,formats:['wav','mp3']},billing:customFish ? 'unknown' : 'paid',prepareVoice:false,stream:{sampleRate:44100},...(customFish ? {} : {concurrency:FISH_CLOUD_CONCURRENCY})} : {}), ...(p.kind === 'qwen' ? {serviceVoiceEngines:['qwen']} : {}), ...(p.kind === 'minimax' ? {billing:'paid'} : {}) },
          ...(p.kind === 'fish-audio' ? {speaking} : {}),
          // the model a source that names none speaks with (undefined: the adapter's own fallback); Fish asks its current list.
          defaultModel: () => serviceDefaultModel(p, p.kind === 'fish-audio' ? fishModels : listedModels(p)),
          validateModel: (model, voiceName) => api.validateVoiceModel({serviceId:p.id,model,voiceName}),
          // A custom Fish server takes the server's own `/v1/hold` lease when it advertises one.
          ...(customFish ? {hold:async () => adapter.hold(p, await secrets(p))} : {}),
          ...(customFish ? {info:async () => adapter.info(p, await secrets(p), true)} : {}),
          ...(p.kind === 'fish-audio' ? {
            discover: async () => {
              // the server's answer (asked once per URL and key); unanswered keeps the last one and fails no request that asked.
              const library = await secrets(p).then(secret => adapter.voiceLibrary(p, secret)).catch(() => null)
              if (library !== null) port.capabilities.voiceSources = [...providerKind(p.kind).voiceSources, ...(library ? ['voice-id'] : [])]
              if (!customFish) return
              const info = await adapter.info(p, await secrets(p))
              fishModels = info.models.map(m => ({...m,voiceDirections:m.voiceDirections ?? info.capabilities.voiceDirections}))
              // the service as a whole: free when every model it serves is (a figure's own model still decides per line).
              const billings = new Set(fishModels.map(m => m.billing || 'unknown'))
              Object.assign(port.capabilities, {prepareVoice:info.capabilities.prepareVoice, billing:billings.size === 1 ? [...billings][0] : billings.has('paid') ? 'paid' : 'unknown',
                ...(info.capabilities.concurrency ? {concurrency:info.capabilities.concurrency} : {}),...(info.capabilities.loadTimeoutMs !== undefined ? {loadTimeoutMs:info.capabilities.loadTimeoutMs} : {})})
            },
          } : {}),
          ...(customFish ? {
            prewarm: async (spec, options) => adapter.prewarm(p, await secrets(p), {...spec, signal:options.signal}),
          } : {}),
          health: async () => await missingKey(p) ? {state:'credentials-required'} : {state:'configured', probed:false},
          catalog: async () => (await adapter.catalog(p, await secrets(p))).items,
          synthesize: async (spec, options) => {
            const identity = modelIdentity(p, spec.params?.model, spec.params?.voice)
            try {
              const secret = await secrets(p), audio = await adapter.synthesize(p, secret, { ...spec, signal:options.signal, ...(options.onPcm ? {onPcm:options.onPcm} : {}) })
              if (!options.signal?.aborted) validation.record(identity, null)
              // a line spoken is a working connection too (a local server that starts on demand is rarely up for a check)
              void noteWorking(p, {status:'connected'}, secret)
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
    // The configured voice services catalog (ttsControl `voiceServices`, Tts.listVoiceServices): every saved service,
    // every other plugin's provider that reports its 配音来源, and 浏览器朗读, without keys, URLs or config. Each service's
    // `sources` / `voiceList` are its registered provider's answer (Provider.capabilities.voiceSources / voiceList, see
    // tts.d.ts): the provider is asked (discover) and caches it per service config. `state` is the last connection check.
    async voiceServices() {
      const reported = new Map((await tts.providerVoiceSources()).map(r => [r.id,r]))
      const services = await Promise.all(get().providers.map(async p => {
        const kind = providerKind(p.kind), revision = hash(p), check = checkOf(p, revision)
        const fish = p.kind === 'fish-audio', custom = fish && !isFishCloud(p.config) || p.kind === 'openai-compatible'
        const keyless = await missingKey(p)
        const state = keyless || check?.status === 'credentials-required' ? 'needs-key' : !check ? 'configured' : ['connected','reachable'].includes(check.status) ? 'ready' : check.status === 'invalid-key' ? 'invalid-key' : check.status === 'rejected' ? 'rejected' : check.status === 'offline' && selfHosted(p) ? 'stopped' : 'offline'
        const own = reported.get(p.id); reported.delete(p.id)
        return {id:p.id, kind:p.kind, label:p.label || kind.label, state, billing:custom ? 'unknown' : kind.paid ? 'paid' : 'free',
          sources:own?.sources || [], voiceList:own?.voiceList || 'provider', voice:[...kind.voice], ...await serviceModels(p)}
      }))
      // Another plugin's provider: listed with what it reports; one that reports no 配音来源 is not a voice service here.
      const plugins = [...reported.values()].filter(r => r.owner !== 'dsh-tavern-tts' && r.sources.length).map(r => ({id:r.id, kind:r.kind, label:r.label,
        state:'configured', billing:r.billing, sources:r.sources, voiceList:r.voiceList || 'provider', voice:[], models:[]}))
      return {services:[...services, ...plugins, structuredClone(BROWSER_VOICE_SERVICE)], kinds:Object.fromEntries([...PROVIDER_KINDS.map(k => [k.kind,k.label]), ['browser',BROWSER_VOICE_SERVICE.label]])}
    },
    async list() { return Promise.all(get().providers.map(async p => { const revision = hash(p); return { ...structuredClone(p), ...await serviceModels(p), category:selfHosted(p) || p.kind === 'openai-compatible' ? 'custom' : 'builtin', selfHosted:selfHosted(p), revision, ...(checkOf(p, revision) ? {check:{...checkOf(p, revision)}} : {}), secrets:Object.fromEntries(await Promise.all(providerKind(p.kind).fields.filter(f => f.secret).map(async f => [f.key, await describeSecret(p,f)]))),
      ...(urlKind(p.kind) ? {recent:await recent(p).list({url:p.config.url, key:(await secrets(p)).key})} : {})} })) },
    // 最近用过的连接: picking a recorded pair saves it as the service's Base URL and API Key together (the one save path), then
    // it is the latest. Every other field stays. Answers the saved row, like save.
    async useEndpoint({ id, entry, expectedRevision }) {
      const p = record(id); if (!urlKind(p.kind)) fail('INVALID_INPUT')
      const pair = await recent(p).take(entry)
      await api.save({id:p.id, kind:p.kind, label:p.label, config:{...p.config, url:pair.url}, secrets:{key:pair.key}, expectedRevision})
      await serial(() => recent(p).remember(pair)); changed()
      return (await api.list()).find(s => s.id === id)
    },
    async renameEndpoint({ id, entry, label }) { const p = record(id); await serial(() => recent(p).rename(entry, label)); changed(); return {recent:await recent(p).list()} },
    async forgetEndpoint({ id, entry }) { const p = record(id); await serial(() => recent(p).forget(entry)); changed(); return {recent:await recent(p).list()} },
    async clearEndpoints({ id }) { const p = record(id); await serial(() => recent(p).clear()); changed(); return {recent:[]} },
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
      remember(p, {...result, error}); await noteWorking(p, result, secret)
      const ok = ['connected','reachable'].includes(result.status)
      return {ok, status:result.status, ...(result.message ? {message:result.message} : {}), voiceCount:result.voices.length, reachable:ok || result.status === 'not-ready',
        synthesisTested:result.synthesisTested === true, credentialScope:p.kind === 'qwen' ? 'models' : ['volcengine','openai-compatible'].includes(p.kind) && result.synthesisTested ? 'synthesis' : 'catalog'}
    },
    dispose() { validation.clear(); credentialEpochs.clear(); onlineLists.clear(); voiceSource?.dispose(); voiceSource = undefined; voiceRevision = undefined; for (const e of registrations.values()) e.dispose(); registrations.clear() },
  }
  return api
}
