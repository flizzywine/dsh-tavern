// The core helpers a mod may use: this is their one list (docs/mod-authoring.md). A mod never imports a core path; it gets this
// object as bindings.hostLibrary (its stage service's request bindings, stage-extensions.js) and as the library argument of the
// stage contribution hooks that need one (configFields).
import { recognitionAudio } from './domain/speech-recognition.js'
import { figureCatalogue } from './domain/figure-catalogue.js'
import { PROMPT_PROSE as dialogueBubbleProse, bubbleVoiceSwitches, effectiveBubbleMoods } from './domain/dialogue-bubbles.js'
import { projectAgentMessageText } from './domain/runtime-content-projection.js'
import { promptSection } from './domain/prompt-section.js'
import { prompt } from './prompt-catalog.js'
import { variableGuessHints } from './domain/variable-bindings/index.js'
import bubbleLine from '../src/client/bubble-line.cjs'

const { bubbleCharacter, parseBubbles, bubbleSpeechCut, matchBubbleMood, voiceTranslates, projectVoiceCues } = bubbleLine

export const modLibrary = Object.freeze({
  // speech and people
  recognitionAudio, figureCatalogue,
  // dialogue bubbles: the speaker, voice switches and moods, the reply parser and its voice cues, the bubble prompt prose
  bubbleCharacter, bubbleVoiceSwitches, effectiveBubbleMoods, parseBubbles, bubbleSpeechCut, matchBubbleMood, voiceTranslates,
  projectVoiceCues, dialogueBubbleProse,
  // prompts: a tagged prompt section, a built-in prompt file, the text of an agent message
  promptSection, prompt, projectAgentMessageText,
  // settings: the variable guess hints a settings field may carry (time, date, weekday)
  variableGuessHints,
})