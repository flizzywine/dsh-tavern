// figure authoring owns pack publication and scoped, billing-confirmed previews.
import {migrateVoice} from '../../dsh-asset-library/lib/asset-packs/voice-migration.js'
import {randomUUID,createHash} from 'node:crypto'
import {canonicalJson} from '../../dsh-asset-library/lib/asset-packs/common.js'
import {validateVoiceSpec,validateVoiceBinding} from '../../dsh-asset-library/lib/shared/voice-schema.js'
import {figureTtsVoice, assetVoiceBinding, browserSpeechSource} from '../../../lib/domain/figure-voice.js'
import {effectiveVoiceLanguage} from '../../../src/client/bubble-line.cjs'
const canonical = value => canonicalJson(JSON.parse(JSON.stringify(value)))
const hash = value => createHash('sha256').update(canonical(value)).digest('hex')
// deep equality compares canonical JSON directly; hashing both sides first adds nothing.
const same = (a, b) => canonical(a) === canonical(b)
const fail = code => { throw Object.assign(new Error(code), {code}) }

// 配音后端 asks before deleting a service how many figures speak with it (Tts.registerUsageSource): every figure of the
// installed packs whose 配音来源 that service speaks, by the same choice synthesis makes (tts.chooseService).
export async function countServiceUsers({library, tts, serviceId}) {
  const services = await tts.listServices()
  let count = 0
  for (const pack of await library.listPacks()) for (const figure of Object.values(pack.figures || {})) {
    const binding = figure.voice, voice = binding && pack.manifest.voiceLibrary?.voices?.[binding.voice]
    if (!voice || binding.source === null) continue
    const source = voice.sources[binding.source ?? voice.defaultSource]
    if (source && tts.chooseService(source, services)?.id === serviceId) count++
  }
  return {serviceId, count}
}
// A voice the 配音后端 offers (Tts.listServiceVoices) as a pack voice: its portable data, converted once (the figure voice
// picker and 自动选角 both write this). language: the figure's 配音语言, else the voice's first. → {voice, emotionVariants}
export async function serviceVoiceSpec(tts, voiceId, language) {
  const {voice} = await tts.exportPortableVoice({voiceId})
  const {schemaVersion,id,enabled,modelDigest,providerId,...preset} = voice
  return migrateVoice(preset, language || preset.languages[0])
}
export function createFigureVoiceAuthoring({getLibrary,getTts}) {
  const previews = new Map(), confirmations = new Map()
  let disposed = false, epoch = 0
  function services() {
    const library = getLibrary(), tts = getTts()
    if (disposed || library?.apiVersion !== 2) fail('PLUGIN_UNAVAILABLE')
    return {library,tts}
  }
  async function current(library, input, standalone = false) {
    const snapshot = await library.getPackSnapshot({packId:input.packId})
    if (!snapshot?.figures[input.figureId]) fail('ASSET_UNAVAILABLE')
    if (!standalone && snapshot.revision !== input.expectedRevision) fail('REVISION_CONFLICT')
    return snapshot
  }
  // What a preview speaks: a pack figure's voice.
  // `revision` is the CAS the page sent; `spec` / `binding` the saved voice; `readReference(hash)` its clips; `watch` closes
  // the preview when the owner of the voice changes.
  async function subject(library, input, standalone = false, origin) {
    const pack = await current(library,input,standalone), figure = pack.figures[input.figureId]
    return {key:input.packId + ':' + figure.id, revision:pack.revision, spec:figure.voice && pack.manifest.voiceLibrary?.voices[figure.voice.voice], binding:figure.voice, emotions:figure.emotions,
      readReference:async hash => {
        const lease = await library.leaseMedia({packId:input.packId,hash,scope:'dsh-browser',origin})
        try {
          if (lease.revision !== pack.revision) fail('REVISION_CONFLICT')
          const response = await library.respondLease({ticket:lease.ticket,resource:'media',request:new Request(new URL(lease.url,origin),{headers:{Origin:origin}})})
          if (!response.ok) fail('MISSING_REFERENCE')
          return new Uint8Array(await response.arrayBuffer())
        } finally { library.releaseLease(lease.ticket) }
      },
      watch:fn => library.subscribe(event => { if (event.packId === input.packId) fn() })}
  }
  function close(scope) {
    const entry = previews.get(scope)
    if (!entry) return {closed:false}
    previews.delete(scope); clearTimeout(entry.timer)
    entry.grant.dispose(); entry.source.dispose(); entry.offLibrary(); entry.offTts()
    return {closed:true}
  }
  const api = {
    async editor(input) {
      const {library,tts} = services(), pack = await library.getPackSnapshot({packId:input.packId})
      const figure = pack?.figures[input.figureId]
      if (!figure) fail('ASSET_UNAVAILABLE')
      const voice = figure.voice && pack.manifest.voiceLibrary?.voices[figure.voice.voice]
      // Browser speech needs no service and no voice name (none = the system default): it has no issues.
      const status = browserSpeechSource(voice, figure.voice) ? {effective:null,issues:[]} : voice && tts ? await tts.resolveVoiceService({voice,binding:figure.voice}) : {effective:null,issues:voice ? [{code:'SERVICE_REQUIRED'}] : []}
      return {packRevision:pack.revision,binding:figure.voice || null,voiceLibrary:pack.manifest.voiceLibrary || {version:1,voices:{}},...status,recommended:tts?.listRecommendedFishVoices?.().voices || []}
    },
    async choices() {
      const {tts} = services()
      return {recommended:tts?.listRecommendedFishVoices?.().voices || [],voices:(tts ? await tts.listServiceVoices() : []).map(v => ({id:v.id,serviceId:v.serviceId,label:v.label,languages:v.languages,state:v.state}))}
    },
    async assign(input) {
      const {library,tts} = services(), before = await current(library,input)
      if (input.binding !== undefined) return library.saveFigureVoiceBinding({...input,binding:input.binding})
      if (input.voiceSpec) return library.createAndAssignPackVoice(input)
      const figure = structuredClone(before.figures[input.figureId]), blobs = {...before.manifest.blobs}, files = new Map(), voiceLibrary = structuredClone(before.manifest.voiceLibrary || {version:1,voices:{}})
      if (input.voiceId === null) delete figure.voice
      else {
        if (!tts) fail('PLUGIN_UNAVAILABLE')
        const voiceId = 'v-' + randomUUID(), converted = await serviceVoiceSpec(tts, input.voiceId, input.language)
        voiceLibrary.voices[voiceId] = converted.voice
        figure.voice = {voice:voiceId,...(Object.keys(converted.emotionVariants).length ? {emotionVariants:converted.emotionVariants} : {})}
      }
      if (disposed || getLibrary() !== library || getTts() !== tts) fail('PLUGIN_UNAVAILABLE')
      files.set('figures/' + figure.id + '.json',Buffer.from(JSON.stringify(figure,null,2) + '\n'))
      return library.patchPack({packId:input.packId,expectedRevision:input.expectedRevision,patch:{blobs,voiceLibrary},fileUpdates:files})
    },
    async preview(input,origin) {
      if (!origin) fail('FORBIDDEN')
      // A complete external candidate without figure moods reads no saved voice or pack media.
      const standalone = !!input.voiceSpec && input.mood === undefined && Object.values(input.voiceSpec.sources || {}).every(source => ['voice-id','preset'].includes(source?.kind))
      const started = epoch, {library,tts} = services(), owner = await subject(library,input,standalone,origin)
      if (!tts) fail('SERVICE_REQUIRED')
      const spec = structuredClone(input.voiceSpec ?? owner.spec)
      if (!spec) fail('VOICE_NOT_FOUND')
      validateVoiceSpec(spec)
      const voiceBinding = structuredClone(input.binding ?? (input.voiceSpec ? {voice:'preview'} : owner.binding))
      validateVoiceBinding(voiceBinding,{version:1,voices:{[voiceBinding?.voice]:spec}})
      const language = effectiveVoiceLanguage(voiceBinding.language, spec.language)
      // The voice page omits text when its displayed language sample is unchanged.
      const samples = {ja:'\u3053\u3093\u306b\u3061\u306f\u3002\u4eca\u65e5\u3082\u3088\u308d\u3057\u304f\u304a\u9858\u3044\u3057\u307e\u3059\u3002',zh:'\u4f60\u597d\uff0c\u4eca\u5929\u4e5f\u8bf7\u591a\u5173\u7167\u3002',en:'Hello. It is good to see you today.',ko:'\uc548\ub155\ud558\uc138\uc694. \uc624\ub298\ub3c4 \uc798 \ubd80\ud0c1\ud574\uc694.',yue:'\u4f60\u597d\uff0c\u4eca\u65e5\u90fd\u8acb\u591a\u591a\u6307\u6559\u3002'}
      const text = input.text ?? samples[language.toLowerCase().split('-')[0]] ?? samples.en
      if (typeof text !== 'string' || !text.trim() || text.length > 200 || text.includes('\0') || (input.mood !== undefined && (typeof input.mood !== 'string' || input.mood.length > 80 || input.mood.includes('\0')))) fail('INVALID_INPUT')
      const resolution = await tts.resolveVoiceService({voice:spec,binding:voiceBinding}), binding = resolution.effective
      if (!binding) fail(resolution.issues[0]?.code || 'SERVICE_REQUIRED')
      if (disposed || epoch !== started || getLibrary() !== library || getTts() !== tts) fail('PLUGIN_UNAVAILABLE')
      const request = {text,language,...(input.mood === undefined ? {} : {mood:input.mood})}
      const fingerprint = hash({origin,owner:owner.key,revision:owner.revision,spec,voiceBinding,request,binding,epoch})
      for (const [token,entry] of confirmations) if (entry.expiresAt <= Date.now()) confirmations.delete(token)
      if (binding.capabilities?.paid !== false) {
        if (input.confirmToken !== undefined) {
          const entry = confirmations.get(input.confirmToken); confirmations.delete(input.confirmToken)
          if (!entry || entry.fingerprint !== fingerprint) fail('PREVIEW_CONFIRMATION_REQUIRED')
        } else {
          if (confirmations.size >= 16) fail('QUEUE_FULL')
          const confirmToken = randomUUID(), expiresAt = Date.now() + 60000
          confirmations.set(confirmToken,{fingerprint,expiresAt})
          // the model this source speaks with (a Fish figure's own choice), named in the dialog.
          return {status:'confirmation-required',confirmToken,expiresAt,billing:{serviceId:binding.serviceId,paid:true,...(binding.capabilities?.modelLabel ? {modelLabel:binding.capabilities.modelLabel} : {})}}
        }
      }
      let used = false
      const opened = await api.open(input,origin,{spec,voiceBinding,binding,standalone,authorize:(actual,provider) => {
        if (used || !same(provider, {serviceId:binding.serviceId,serviceRevision:binding.serviceRevision}) || !same({...actual,voice:undefined}, {...request,voice:undefined})) fail('PREVIEW_CONFIRMATION_REQUIRED')
        used = true
      }})
      try { return {status:'submitted',...opened,...tts.jobs.submit({...request,voice:opened.voice},{principal:'dsh-browser',scope:opened.scope})} }
      catch (error) { close(opened.scope); throw error }
    },
    async open(input,origin,policy) {
      if (!origin) fail('FORBIDDEN')
      const started = epoch, {library,tts} = services(), owner = await subject(library,input,policy?.standalone,origin)
      const voiceBinding = policy?.voiceBinding || owner.binding
      // The figure lamp is the stage's: a figure switched off (or the new-figure page's hidden draft) still auditions.
      if (!voiceBinding) fail('VOICE_NOT_FOUND')
      const spec = policy?.spec || owner.spec
      const binding = await assetVoiceBinding(tts,{voice:spec,binding:voiceBinding})
      if (policy && !same(binding, policy.binding)) fail('PREVIEW_CONFIRMATION_REQUIRED')
      if (!binding) fail('SERVICE_REQUIRED')
      // Billing is a generic provider capability; Tavern never distinguishes local/cloud backends.
      if (!policy && binding.capabilities?.paid !== false) fail('PAID_PREVIEW_DISABLED')
      const scope = 'figure-preview:' + randomUUID(), sourceId = policy ? 'figure-preview:' + hash({owner:owner.key,spec,voiceBinding}) : scope
      await subject(library,input,policy?.standalone,origin)
      if (disposed || epoch !== started || getLibrary() !== library || getTts() !== tts) fail('PLUGIN_UNAVAILABLE')
      if (previews.size >= 16) fail('QUEUE_FULL')
      const source = tts.registerVoiceSource({owner:'dsh-tavern',sourceId,revision:owner.revision,voices:[figureTtsVoice(voiceBinding,spec,owner.key,owner.emotions)],bindings:{voice:binding.serviceId},
        readReference:owner.readReference})
      let grant
      try { grant = tts.grantConsumer({principal:'dsh-browser',source:sourceId,scope,...(policy ? {authorize:policy.authorize} : {})}) }
      catch (error) { source.dispose(); throw error }
      const offLibrary = owner.watch(() => close(scope))
      const offTts = tts.subscribe(event => { if (['disposed','providerRemoved','providerChanged','cacheInvalidated'].includes(event.type)) close(scope) })
      const timer = setTimeout(() => close(scope),180000 + (binding.capabilities?.loadTimeoutMs ?? binding.capabilities?.warmupTimeoutMs ?? 0)); timer.unref?.()
      previews.set(scope,{source,grant,offLibrary,offTts,timer})
      return {scope,voice:{source:sourceId,id:'voice'},language:effectiveVoiceLanguage(voiceBinding.language, spec.language)}
    },
    close:input => close(input.scope),
    invalidate() { epoch++; confirmations.clear(); for (const scope of previews.keys()) close(scope) },
    dispose() { epoch++; confirmations.clear(); disposed = true; for (const scope of previews.keys()) close(scope) },
  }
  return api
}
