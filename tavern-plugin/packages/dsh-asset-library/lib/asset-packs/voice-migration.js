// Single explicit v3 -> voice-library migration, also used when materializing a personal template.
import {validateVoiceSpec, validateVoiceBinding} from '../shared/voice-schema.js'
const fishKeys = ['speed','volume','latency','normalize','emotionTags']
const fail = message => { throw Object.assign(new Error(message),{code:'MIGRATION_BLOCKED'}) }
export function migrateVoice(preset, language) {
  const p = structuredClone(preset), params = {...p.params}, tuning = {}, sources = {}, emotionVariants = {}
  let defaultSource
  if (p.kind === 'reference') {
    defaultSource = 'fish'; sources.fish = {kind:'reference-list',provider:'fish-audio',references:p.references}
    const fish = {}
    for (const [k,v] of Object.entries(params)) {
      if (fishKeys.includes(k)) fish[k] = v
      else fail('Unknown reference parameter: '+k)
    }
    if (Object.keys(fish).length) tuning.fish = fish
  } else if (p.kind === 'fish-audio') {
    defaultSource = 'fish'; sources.fish = {kind:'voice-id',provider:'fish-audio',voiceId:params.referenceId}; delete params.referenceId; tuning.fish = params
  } else {
    const provider = p.kind === 'service' ? p.engine : p.kind
    if (!['qwen','azure','volcengine','openai-compatible'].includes(provider)) fail('Unsupported legacy voice kind')
    defaultSource = provider
    const nameKey = provider === 'azure' ? 'voiceName' : provider === 'volcengine' ? 'speaker' : 'voice'
    if (!params[nameKey]) fail('Service voice has no portable online descriptor')
    sources[provider] = {kind:'preset',provider,voiceName:params[nameKey],...(params.model ? {model:params.model} : {})}
    delete params[nameKey]; delete params.model
    const moods = {...p.moodStyles,...params.moods}; delete params.moods
    tuning[provider] = params
    for (const [mood,value] of Object.entries(moods)) emotionVariants[mood] = 'emotion-'+mood
    const variants = {normal:{name:'Original',tuning}}
    for (const [mood,value] of Object.entries(moods)) variants['emotion-'+mood] = {name:mood,tuning:{[provider]:{[provider === 'qwen' ? 'moodInstruction' : 'style']:value}}}
    const voice = {name:p.label,language,defaultSource,sources,variants}
    validateVoiceSpec(voice)
    return {voice,emotionVariants}
  }
  const voice = {name:p.label,language,defaultSource,sources,...(Object.keys(tuning).length ? {variants:{normal:{name:'Original',tuning}}} : {})}
  validateVoiceSpec(voice)
  return {voice,emotionVariants}
}
export function migratePackVoices(manifest, figures) {
  const next = structuredClone(manifest), output = structuredClone(figures), mappings = []
  for (const figure of Object.values(output)) {
    if (!figure.voice || !figure.voice.preset) continue
    const old = figure.voice, id = 'v-'+figure.id
    const library = next.voiceLibrary ||= {version:1,voices:{}}
    if (Object.hasOwn(library.voices,id)) fail('Voice ID collision')
    const {voice,emotionVariants} = migrateVoice(old.preset,old.language)
    library.voices[id] = voice; figure.voice = {voice:id,...(Object.keys(emotionVariants).length ? {emotionVariants} : {})}
    validateVoiceBinding(figure.voice,library)
    mappings.push({figureId:figure.id,name:figure.name,oldVoiceId:old.id,voiceId:id,source:voice.defaultSource,references:old.preset.references?.length || 0})
  }
  return {manifest:next,figures:output,mappings}
}
