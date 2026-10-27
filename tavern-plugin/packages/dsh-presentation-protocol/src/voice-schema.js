// Portable voice data only. No provider implementations, filesystem or credentials.
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
  return Object.values(voice.sources).flatMap(s => s.kind === 'reference-list' ? s.references : s.kind === 'emotion-references' ? [...s.fallback,...Object.values(s.emotions).flat()] : [])
}
export function validateVoiceSpec(v, path = '$.voice') {
  shape(v,['name','language','defaultSource','sources','variants','emotions','fallbackSources'],['name','language','defaultSource','sources'],path)
  text(v.name,path+'.name'); language(v.language,path+'.language'); id(v.defaultSource,path+'.defaultSource')
  record(v.sources,path+'.sources',(s,p) => {
    const fields = {'voice-id':['voiceId'],preset:['voiceName','model'],'reference-list':['references'],'emotion-references':['engine','model','fallback','emotions','selection']}[s?.kind]
    check(fields,p+'.kind'); shape(s,['kind','provider',...fields],['kind','provider'],p); id(s.provider,p+'.provider')
    // every source may be chosen before it is set up — a clone without clips,
    // a library voice or online preset without its voice, a local source without its model. Resolving it reports what is
    // missing (dsh-tts voice-resolver sourceUnsetIssue) instead of the pack refusing the choice.
    if (s.kind === 'voice-id') { check(s.provider === 'fish-audio',p+'.provider'); if (s.voiceId !== undefined) check(typeof s.voiceId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(s.voiceId),p+'.voiceId') }
    if (s.kind === 'preset') { check(s.provider !== 'local',p+'.provider'); if (s.voiceName !== undefined) text(s.voiceName,p+'.voiceName'); if (s.model !== undefined) text(s.model,p+'.model') }
    if (s.kind === 'reference-list') { check(s.provider === 'fish-audio',p+'.provider'); refs(s.references,p+'.references') }
    if (s.kind === 'emotion-references') {
      check(s.provider === 'local',p+'.provider'); check((s.engine === undefined) === (s.model === undefined),p+'.model')
      if (s.model !== undefined) {
        id(s.engine,p+'.engine'); object(s.model,p+'.model')
        check(s.model.engine === s.engine,p+'.model.engine'); text(s.model.modelVersion,p+'.model.modelVersion')
        for (const key of ['gpt','sovits',...(s.model.sv ? ['sv'] : []),...(s.model.lora ? ['lora'] : [])]) check(typeof s.model[key]?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(s.model[key].sha256),p+'.model.'+key)
      }
      refs(s.fallback,p+'.fallback'); record(s.emotions,p+'.emotions',(r,q) => refs(r,q))
      check(s.selection === undefined || s.selection === 'stable-random',p+'.selection')
    }
    if (s.model !== undefined) safeData(s.model,p+'.model')
  })
  check(own(v.sources,v.defaultSource),path+'.defaultSource','Unknown source')
  if (v.fallbackSources !== undefined) {
    check(Array.isArray(v.fallbackSources) && new Set(v.fallbackSources).size === v.fallbackSources.length,path+'.fallbackSources')
    v.fallbackSources.forEach(s => check(own(v.sources,s) && v.sources[s].provider !== 'local',path+'.fallbackSources','Fallback must be an exported non-local source'))
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
      safeData(params,q)
    })
  })
  return v
}
export function validateVoiceBinding(v, library, path = '$.voice') {
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
// Only import may change a local selection. Availability is supplied by TTS, never inferred from URLs.
export async function planVoiceImport(library, figures, available) {
  const bindings = {}, changes = []
  for (const figure of Object.values(figures)) {
    const binding = figure.voice
    if (!binding || binding.source === null) continue
    const voice = library.voices[binding.voice], source = binding.source ?? voice.defaultSource
    if (voice.sources[source].provider !== 'local' || await available(voice.sources[source],voice)) continue
    let next = null
    for (const candidate of voice.fallbackSources || []) if (await available(voice.sources[candidate],voice)) { next = candidate; break }
    bindings[figure.id] = {...binding,source:next}
    changes.push({figureId:figure.id,from:source,to:next,code:next === null ? 'LOCAL_UNAVAILABLE_MUTED' : 'LOCAL_FALLBACK'})
  }
  return {bindings,changes}
}
