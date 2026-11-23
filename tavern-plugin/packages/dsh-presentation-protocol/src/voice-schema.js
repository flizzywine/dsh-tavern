// Portable voice data only. No provider implementations, filesystem or credentials.
// Canonical in dsh-presentation-protocol; the tts and asset-library build.mjs vendor byte-identical copies.
const own = (v, k) => Object.hasOwn(v, k)
function check(ok, path, message = 'Invalid voice data') {
  if (!ok) throw Object.assign(new Error(message), {code:'INVALID_INPUT', path})
}
function object(v, path) { check(v && typeof v === 'object' && !Array.isArray(v), path) }
function shape(v, allowed, required, path) {
  object(v, path)
  check(Object.keys(v).every(k => allowed.includes(k)) && required.every(k => own(v,k)), path)
}
function id(v, path) { check(typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(v) && !['constructor','prototype','__proto__'].includes(v), path) }
function text(v, path, empty = false) { check(typeof v === 'string' && (empty || v.length > 0) && !v.includes('\0'), path) }
function language(v, path) { check(typeof v === 'string' && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(v), path) }
function record(v, path, fn) { object(v,path); for (const [k,x] of Object.entries(v)) { id(k,path+'.'+k); fn(x,path+'.'+k,k) } }
function safeData(v, path) {
  if (typeof v === 'string') check(!/^(?:[A-Za-z]:[\\/]|\/|\\\\|https?:\/\/)/i.test(v),path,'Machine paths and URLs are not portable')
  else if (typeof v === 'number') check(Number.isFinite(v),path)
  else if (v !== null && typeof v === 'object') for (const [k,x] of Object.entries(v)) {
    check(!/^(?:__proto__|constructor|prototype|path|url|endpoint|key|api[_-]?key|.*(?:secret|token|password|credential).*)$/i.test(k),path+'.'+k,'Machine configuration is not portable')
    safeData(x,path+'.'+k)
  }
}
function refs(v, path) {
  check(Array.isArray(v),path)
  v.forEach((r,i) => {
    const p = path+'['+i+']'
    shape(r,['media','text','language'],['media','text','language'],p)
    check(typeof r.media === 'string' && /^[a-f0-9]{64}$/.test(r.media),p+'.media')
    text(r.text,p+'.text',true); language(r.language,p+'.language')
  })
}
export function voiceReferences(voice) {
  return Object.values(voice.sources).flatMap(s => s.kind === 'reference-list' ? s.references : [])
}
export const usesOfficialFish = source => source.kind === 'voice-id' && source.provider === 'fish-audio' && !source.serviceId

export function normalizeVoiceServices(library) {
  const changes = []
  for (const [voiceId, voice] of Object.entries(library?.voices || {})) {
    for (const [sourceId, source] of Object.entries(voice?.sources || {})) {
      if (!source || !usesOfficialFish(source) || source.serviceType !== undefined) continue
      delete source.serviceId
      source.serviceType = 'fish-official'
      changes.push({voiceId,sourceId})
    }
  }
  return changes
}

export function validateVoiceSpec(v, path = '$.voice') {
  shape(v,['name','guidance','autoCast','language','defaultSource','sources','variants','emotions','fallbackSources'],['name','language','defaultSource','sources'],path)
  text(v.name,path+'.name'); language(v.language,path+'.language'); id(v.defaultSource,path+'.defaultSource')
  // 使用情景: one optional line saying whom the voice suits (「适合中年男性」); the casting assistant reads it and it puts the
  // voice in 自动素材's 「默认」 可选声音 (voice-auto-cast.cjs). `autoCast`: the old per-voice switch, still accepted, no longer read.
  if (v.autoCast !== undefined) check(typeof v.autoCast === 'boolean',path+'.autoCast')
  if (v.guidance !== undefined) check(typeof v.guidance === 'string' && [...v.guidance].length <= 60 && !/[\u0000-\u001f\u007f]/.test(v.guidance),path+'.guidance')
  record(v.sources,path+'.sources',(s,p) => {
    // `model`: the provider's synthesis model this source speaks with (a figure's choice, never the service's); absent = the
    // service's default model.
    const fields = {'voice-id':['voiceId','model'],preset:['voiceName','model'],'reference-list':['references','model','private']}[s?.kind]
    check(fields,p+'.kind'); shape(s,['kind','provider','serviceId','serviceType',...fields],['kind','provider'],p); id(s.provider,p+'.provider')
    // the service instance this source speaks through (one of several of its provider); the same name as a reading voice's.
    if (s.serviceType !== undefined) check(s.serviceType === 'fish-official' && usesOfficialFish(s) && s.serviceId === undefined,p+'.serviceType')
    if (s.serviceId !== undefined) id(s.serviceId,p+'.serviceId')
    // every source may be chosen before it is set up — a clone without clips,
    // a library voice or online preset without its voice. Resolving it reports what is
    // missing (dsh-tts voice-resolver sourceUnsetIssue) instead of the pack refusing the choice.
    if (s.kind === 'voice-id') { check(s.provider === 'fish-audio',p+'.provider'); if (s.voiceId !== undefined) check(typeof s.voiceId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(s.voiceId),p+'.voiceId') }
    if (s.kind === 'preset' && s.voiceName !== undefined) text(s.voiceName,p+'.voiceName')
    if (s.model !== undefined) text(s.model,p+'.model')
    if (s.kind === 'reference-list') {
      check(s.provider === 'fish-audio',p+'.provider'); refs(s.references,p+'.references')
      if (s.private !== undefined) check(typeof s.private === 'boolean',p+'.private')
    }
    if (s.model !== undefined) safeData(s.model,p+'.model')
  })
  check(own(v.sources,v.defaultSource),path+'.defaultSource','Unknown source')
  if (v.fallbackSources !== undefined) {
    check(Array.isArray(v.fallbackSources) && new Set(v.fallbackSources).size === v.fallbackSources.length,path+'.fallbackSources')
    v.fallbackSources.forEach(s => check(own(v.sources,s),path+'.fallbackSources','Unknown source'))
  }
  if(v.emotions!==undefined)record(v.emotions,path+'.emotions',(e,p)=>{
    shape(e,['label','tuning','referenceEmotion'],['label'],p);text(e.label,p+'.label');
    if(e.referenceEmotion!==undefined)id(e.referenceEmotion,p+'.referenceEmotion');
    if(e.tuning!==undefined){object(e.tuning,p+'.tuning');safeData(e.tuning,p+'.tuning')}
  })
  if (v.variants !== undefined) record(v.variants,path+'.variants',(variant,p) => {
    shape(variant,['name','tuning'],[],p); if (variant.name !== undefined) text(variant.name,p+'.name')
    if (variant.tuning !== undefined) record(variant.tuning,p+'.tuning',(params,q,source) => {
      check(own(v.sources,source),q,'Unknown source'); object(params,q)
      check(Object.keys(params).every(k => !['provider','voiceId','voiceName','voice','speaker','referenceId','model','references','engine','moods','moodStyles'].includes(k)),q,'Tuning cannot change identity or define a second emotion map')
      for (const [key,item] of Object.entries(params)) check(item === null || ['boolean','string'].includes(typeof item) || typeof item === 'number' && Number.isFinite(item),q+'.'+key)
      // a browser source's only tuning is its 语速 (rate, the system voice's pace); a service's parameters are checked by its adapter.
      if (v.sources[source].provider === 'browser') for (const [key,item] of Object.entries(params)) check(key === 'rate' && typeof item === 'number' && item >= 0.5 && item <= 2,q+'.'+key)
      safeData(params,q)
    })
  })
  return v
}
// {source:null} alone: a figure without a voice of its own that is still not voiced (配音 off while it would use 通用声音).
export function validateVoiceBinding(v, library, path = '$.voice') {
  if (v?.source === null && !own(v,'voice')) { shape(v,['source'],['source'],path); return v }
  shape(v,['voice','source','variant','language','emotionVariants'],['voice'],path); id(v.voice,path+'.voice')
  if (v.source !== undefined && v.source !== null) id(v.source,path+'.source')
  if (v.variant !== undefined) id(v.variant,path+'.variant')
  if (v.language !== undefined) language(v.language,path+'.language')
  if (v.emotionVariants !== undefined) record(v.emotionVariants,path+'.emotionVariants',(x,p) => id(x,p))
  if (library !== undefined) {
    const voice = library?.voices?.[v.voice]; check(voice,path+'.voice','Unknown pack voice')
    if (v.source !== undefined && v.source !== null) check(own(voice.sources,v.source),path+'.source','Unknown source')
    for (const variant of [v.variant,...Object.values(v.emotionVariants || {})]) if (variant !== undefined && variant !== 'normal') check(own(voice.variants || {},variant),path+'.variant','Unknown variant')
  }
  return v
}
export function validateVoiceLibrary(v, path = '$.voiceLibrary') {
  shape(v,['version','voices'],['version','voices'],path); check(v.version === 1,path+'.version')
  record(v.voices,path+'.voices',(voice,p) => validateVoiceSpec(voice,p)); return v
}
