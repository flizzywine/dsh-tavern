import {effectiveVoiceLanguage} from '../../src/client/bubble-line.cjs'
// Immutable pack declaration; synthesis-time mood and pool selection belong to TTS.
export function figureTtsVoice(binding, voice, figureIdentity, emotions = []) {
  return {id:'voice',kind:'pack',enabled:binding.source !== null,languages:[effectiveVoiceLanguage(binding.language, voice.language)],
    pack:{voice:structuredClone(voice),binding:structuredClone(binding),figureIdentity,emotions:structuredClone(emotions)}}
}
// the browser's own speech is a provider the browser runs. Its source registers
// nothing with the TTS service; the browser is told the system voice to speak with. null for every other source.
export function browserSpeechSource(voice, binding) {
  if (!voice || !binding || binding.source === null) return null
  const source = voice.sources[binding.source ?? voice.defaultSource]
  return source?.provider === 'browser' ? source : null
}
export async function assetVoiceBinding(tts, declaration, options) {
  if (tts?.apiVersion !== 1) return null
  return (await tts.resolveVoiceService(declaration,options)).effective
}

// 通用声音 / 旁白 (tts.reading().general / .narrator .figure): a figure of any installed pack, enabled or not, spoken with its own
// voice in its own 配音语言 - the same declaration as that figure on a card. null = the browser's default voice; a figure
// gone (or without a voice) throws VOICE_NOT_FOUND; 「不配音」 is silent (null).
export async function figureRefTtsVoice(library, tts, ref, options) {
  if (!ref) return {browser:''}
  const pack = await library.getPackSnapshot({packId:ref.packId}), figure = pack?.figures[ref.figureId]
  if (figure?.voice?.source === null) return null
  const voice = figure?.voice && pack.manifest.voiceLibrary?.voices[figure.voice.voice]
  if (!voice) throw Object.assign(new Error('VOICE_NOT_FOUND'), {code:'VOICE_NOT_FOUND'})
  const binding = figure.voice
  if (binding.source === null) return null
  const browser = browserSpeechSource(voice, binding)
  if (browser) return {browser:browser.voiceName ?? '',language:effectiveVoiceLanguage(binding.language, voice.language)}
  const effective = await assetVoiceBinding(tts,{voice,binding},options)
  if (!effective) throw Object.assign(new Error('SERVICE_REQUIRED'), {code:'SERVICE_REQUIRED'})
  return {voice:figureTtsVoice(binding,voice,`${pack.manifest.id}:${figure.id}`),binding:effective,voiceId:binding.voice,revision:pack.revision,
    readReference:async hash => (await library.readMedia({packId:pack.manifest.id,expectedRevision:pack.revision,hash})).bytes}
}

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
