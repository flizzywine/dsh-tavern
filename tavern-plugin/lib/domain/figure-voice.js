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
// A browser source speaks at the 语速 of its 调音 (variants.normal, then the bound variant: 'rate', 0.5-2, schema-checked): the same
// per-voice setting a service's 语速 is, there being no global speed. {} = the system's own pace.
export function browserSpeechRate(voice, binding) {
  const sourceId = binding.source ?? voice.defaultSource
  const rate = {...voice.variants?.normal?.tuning?.[sourceId], ...voice.variants?.[binding.variant]?.tuning?.[sourceId]}.rate
  return typeof rate === 'number' ? {rate} : {}
}
// The service a figure's voice speaks through; null = no voice plugin. A voice that cannot speak throws the resolver's own
// reason (VOICE_UNSET: no voice picked yet, SERVICE_REQUIRED: its service not set up, ...), never a guessed one.
export async function assetVoiceBinding(tts, declaration, options) {
  if (tts?.apiVersion !== 1) return null
  const {effective, issues} = await tts.resolveVoiceService(declaration,options)
  if (!effective && issues[0]) throw Object.assign(new Error(issues[0].code), {code:issues[0].code})
  return effective
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
  if (browser) return {browser:browser.voiceName ?? '',...browserSpeechRate(voice, binding),language:effectiveVoiceLanguage(binding.language, voice.language)}
  const effective = await assetVoiceBinding(tts,{voice,binding},options)
  if (!effective) throw Object.assign(new Error('SERVICE_REQUIRED'), {code:'SERVICE_REQUIRED'})
  return {voice:figureTtsVoice(binding,voice,`${pack.manifest.id}:${figure.id}`),binding:effective,voiceId:binding.voice,revision:pack.revision,
    readReference:async hash => (await library.readMedia({packId:pack.manifest.id,expectedRevision:pack.revision,hash})).bytes}
}
