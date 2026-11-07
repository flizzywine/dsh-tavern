import {effectiveBubbleMoods} from './dialogue-bubbles.js'
import {bubbleCharacter,characterVoiceLanguage,matchBubbleMood,packSpeechInput} from '../../src/client/bubble-line.cjs'

// A host paragraph's spoken line: the cached voice's speech input, its selection key in host paragraph ordinals.
export function paragraphSpeech(chat,paragraph,config) {
  const character=bubbleCharacter(config,paragraph.segment)
  const mood=matchBubbleMood(paragraph.segment?.mood,effectiveBubbleMoods(config,character?.alias))
  const input=paragraph.segment && packSpeechInput(paragraph.segment,config,character,mood)
  if (!input) return null
  return {alias:character.alias,voiceKey:character.voiceKey,language:characterVoiceLanguage(character),
    input:{...input,mood:input.mood || 'default',selectionKey:JSON.stringify([chat.sessionId,Number(chat.regeneratedDshTurns?.[paragraph.turn]) || paragraph.turn,paragraph.para-1])}}
}
