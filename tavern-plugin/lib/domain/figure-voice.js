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
export async function assetVoiceBinding(tts, defaults, declaration, options) {
  if (tts?.apiVersion !== 1) return null
  return (await tts.resolveVoiceService({...declaration,defaults},options)).effective
}
