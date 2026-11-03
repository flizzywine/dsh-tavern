// 通用声音 (tts.reading().dialogueVoice) and 全文朗读 (stage switch fullReading) on the host: the one precedence rule, the
// shared GENERAL voice entry and the bubble config the clients read. Fixture ids differ from names on purpose.
import test from 'node:test'
import assert from 'node:assert/strict'
import {effectiveCardStage, validateCardStage} from '../tavern-plugin/lib/domain/card-stage-settings.js'
import {defaultAssetEngineSettings, validateAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {createAssetPackSpeech, GENERAL_VOICE, NARRATOR_VOICE} from '../tavern-plugin/lib/domain/asset-pack-speech.js'
import {bubbleInjection} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {cardBubbleConfig} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'
import {createTts} from '../tavern-plugin/packages/dsh-tavern-tts/src/service.js'
import {pcmWav} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'
import {stageEnabledExtension} from './helpers/stage-enabled-settings.mjs'
import {syntheticPack, cardExtension, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

const engineWith = toggles => {
  const engine = defaultAssetEngineSettings()
  return {...engine, stageToggles:{...engine.stageToggles, ...toggles}}
}
const withSwitches = switches => ({stage:{enabled:true, switches}})

test('全文朗读 defaults off; in effect it turns 角色配音 off, and the card layer decides before the global switch', () => {
  assert.equal(defaultAssetEngineSettings().stageToggles.fullReading, false)
  const stored = defaultAssetEngineSettings(); delete stored.stageToggles.fullReading
  assert.equal(validateAssetEngineSettings(stored).stageToggles.fullReading, false, 'settings saved before the switch read as off')
  assert.equal(validateCardStage({switches:{fullReading:'on'}}).switches.fullReading, 'on')
  // global 全文朗读 on + card 角色配音 on: 全文朗读 wins, voice is off.
  let stage = effectiveCardStage(withSwitches({voice:'on'}), engineWith({fullReading:true}))
  assert.equal(stage.fullReading, true); assert.equal(stage.voice, false)
  // 本卡关闭 beats 全局开启.
  stage = effectiveCardStage(withSwitches({fullReading:'off'}), engineWith({fullReading:true}))
  assert.equal(stage.fullReading, false); assert.equal(stage.voice, true)
  stage = effectiveCardStage(withSwitches({fullReading:'on', voice:'off'}), engineWith({}))
  assert.equal(stage.fullReading, true); assert.equal(stage.voice, false)
})

async function voicedCard() {
  const pack = await syntheticPack(), figure = pack.figures[FIGURE_ID]
  const raw = {extensions:{dsh_tavern:stageEnabledExtension(cardExtension())}}
  return {pack, figure, raw}
}

test('bubble config: an unbound enabled figure speaks the 通用声音, 「不配音」 stays silent; the prompt bytes do not change', async () => {
  const {pack, figure, raw} = await voicedCard(), engine = engineWith({})
  const service = {serviceId:'svc-q', voice:'v-cherry'}, bound = figure.voice
  delete figure.voice
  let config = cardBubbleConfig(raw, engine, [pack], [], [], () => undefined, null, service)
  const character = config.characters.find(row => row.ref.figureId === FIGURE_ID)
  assert.equal(character.general, true)
  assert.equal(typeof config.voice.general, 'string')
  assert.notEqual(config.voice.general, cardBubbleConfig(raw, engine, [pack], [], [], () => undefined, null, null).voice.general, 'the clip key follows the chosen voice')
  assert.equal(config.voice.fullReading, undefined)
  // The general fields never reach the dialogue-format prompt.
  const strip = value => ({...value, voice:{enabled:value.voice.enabled}, characters:value.characters.map(({general, ...row}) => row)})
  assert.deepEqual(bubbleInjection(config), bubbleInjection(strip(config)))
  figure.voice = {...bound, source:null}
  config = cardBubbleConfig(raw, engine, [pack], [], [], () => undefined, null, service)
  assert.equal(config.characters.find(row => row.ref.figureId === FIGURE_ID).general, undefined)
})

test('bubble config under 全文朗读: no character voice or 通用声音 line; the narrator pages read in the 通用声音', async () => {
  const {pack, raw} = await voicedCard()
  raw.extensions.dsh_tavern.stage.switches = {fullReading:'on'}
  const config = cardBubbleConfig(raw, engineWith({}), [pack], [], [], () => undefined, null, null)
  assert.equal(config.voice.enabled, false); assert.equal(config.voice.general, undefined); assert.equal(config.voice.fullReading, true)
  assert.equal(config.narrator.voiceKey, 'browser:')
  assert.ok(config.characters.every(row => !row.voice && !row.general))
})

function speechFor(reading, toggles = {}) {
  const tts = createTts({profileId:'general-voice-test', reading:() => reading})
  const presentation = {extension:withSwitches({}), subscribe:() => () => {}}
  return {tts, speech:createAssetPackSpeech({presentation, getEngine:() => engineWith(toggles), getTts:() => tts, scope:'dsh-browser'})}
}

test('the GENERAL entry: null opens the browser default; a service voice registers one source every NPC shares', async t => {
  const browser = speechFor({dialogueVoice:null, narrator:{enabled:false, voice:null}})
  t.after(() => { browser.speech.dispose(); browser.tts.dispose() })
  const opened = await browser.speech.open(GENERAL_VOICE)
  assert.equal(opened.available, true); assert.deepEqual(opened.browser, {voice:''})

  const service = speechFor({dialogueVoice:{serviceId:'svc-q', voice:'v-cherry'}, narrator:{enabled:false, voice:null}})
  t.after(() => { service.speech.dispose(); service.tts.dispose() })
  service.tts.registerProvider('test', {id:'svc-q', kind:'qwen', revision:'one', capabilities:{}, health:async () => ({state:'ready'}), synthesize:async () => pcmWav(Buffer.alloc(64, 1))})
  const first = await service.speech.open(GENERAL_VOICE), second = await service.speech.open(GENERAL_VOICE)
  assert.equal(first.available, true)
  assert.deepEqual(first.voice, second.voice, 'two NPC lines reuse the one registered source')
  assert.equal(service.tts.listVoices({source:first.voice.source}).length, 1)
  // 角色配音 off: no 通用声音 either; 全文朗读 opens it for the narrator's pages.
  const off = speechFor({dialogueVoice:null, narrator:{enabled:false, voice:null}}, {voice:false})
  t.after(() => { off.speech.dispose(); off.tts.dispose() })
  assert.equal((await off.speech.open(GENERAL_VOICE)).available, false)
  const full = speechFor({dialogueVoice:null, narrator:{enabled:false, voice:null}}, {fullReading:true})
  t.after(() => { full.speech.dispose(); full.tts.dispose() })
  assert.deepEqual((await full.speech.open(NARRATOR_VOICE)).browser, {voice:''})
})
