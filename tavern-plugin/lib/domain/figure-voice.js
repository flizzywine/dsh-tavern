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

// Reading selections use the library's plain catalogue, not the current card's cast.
export async function catalogueTtsVoice(library, tts, ref, options) {
  const item = (await library.listVoiceCatalogue()).voices.find(row => ref.templateId
    ? row.ref.templateId === ref.templateId : row.ref.packId === ref.packId && row.ref.voiceId === ref.voiceId)
  if (!item) throw Object.assign(new Error('VOICE_NOT_FOUND'), {code:'VOICE_NOT_FOUND'})
  const spoken = {...item.binding,language:'zh'}
  const browser = browserSpeechSource(item.voiceSpec, spoken)
  if (browser) return {browser:browser.voiceName ?? ''}
  const binding = await assetVoiceBinding(tts,{voice:item.voiceSpec,binding:spoken},options)
  if (!binding) throw Object.assign(new Error('SERVICE_REQUIRED'), {code:'SERVICE_REQUIRED'})
  return {voice:figureTtsVoice(spoken,item.voiceSpec,JSON.stringify(item.ref)),binding,
    voiceId:spoken.voice,revision:item.revision,
    readReference:async hash => (await (ref.templateId
      ? library.readVoiceTemplateMedia({templateId:ref.templateId,expectedRevision:item.revision,hash})
      : library.readMedia({packId:ref.packId,expectedRevision:item.revision,hash}))).bytes}
}
