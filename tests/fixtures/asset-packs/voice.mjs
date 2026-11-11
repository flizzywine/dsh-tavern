// authored v4 fixtures and provider-level execution fixtures are distinct.
import {resolveVoiceSpec} from '../../../tavern-plugin/packages/dsh-tavern-tts/src/voice-resolver.js'
export const onlineSpec=(name='First',voiceName='ja-JP-NanamiNeural',provider='azure')=>({name,language:'ja',defaultSource:provider,sources:{[provider]:{kind:'preset',provider,voiceName}}})
// The synthetic pack's migrated voice: a Fish reference-list clone of the pack's reference clips.
export function cloneSpec(pack) {
  return structuredClone(Object.values(pack.manifest.voiceLibrary.voices)[0])
}
export function referenceVoice(pack) {
  return resolveVoiceSpec({voice:cloneSpec(pack),binding:{voice:'actor'},figureIdentity:'fixture',text:'fixture'}).effective.voice
}
