import test from 'node:test'
import assert from 'node:assert/strict'
import {chooseService} from '../tavern-plugin/packages/dsh-tavern-tts/src/voice-resolver.js'
import {bubbleInstruction, PROMPT_PROSE} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {cardBubbleConfig} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {stageEnabledExtension} from './helpers/stage-enabled-settings.mjs'
import {syntheticPack,cardExtension,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

// Voice-direction prose ({sighs} cues) reaches the prompt only when the figure's chosen voice service is Fish and declares them.
test('only an enabled Fish binding with declared voice directions opts the session into direction prose', async () => {
  const pack=await syntheticPack(),figure=pack.figures[FIGURE_ID]
  const voice=pack.manifest.voiceLibrary.voices[figure.voice.voice]
  voice.sources={fish:{provider:'fish-audio',kind:'voice-id',voiceId:'reference'}};voice.defaultSource='fish';figure.voice.source='fish'
  const engine=defaultAssetEngineSettings(),raw={extensions:{dsh_tavern:stageEnabledExtension(cardExtension())}}
  const render=(kind,model,voiceDirections)=>bubbleInstruction(cardBubbleConfig(raw,engine,[pack],[],[{id:'provider',kind,model,capabilities:{voiceDirections}}],chooseService))
  assert.ok(render('fish-audio','server-model',true).includes(PROMPT_PROSE.p020))
  assert.ok(!render('fish-audio','drama-3',false).includes(PROMPT_PROSE.p020))
  assert.ok(!render('azure','server-model',true).includes(PROMPT_PROSE.p020))
  figure.voice.source=null
  assert.ok(!render('fish-audio','server-model',true).includes(PROMPT_PROSE.p020))
})
