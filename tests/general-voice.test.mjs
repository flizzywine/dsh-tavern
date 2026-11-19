import test from 'node:test'
import assert from 'node:assert/strict'
import {effectiveCardStage, validateCardStage} from '../tavern-plugin/lib/domain/card-stage-settings.js'
import {defaultAssetEngineSettings, validateAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {bubbleInjection} from '../tavern-plugin/lib/domain/dialogue-bubbles.js'
import {cardBubbleConfig} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-stage.js'
import {pcmWav} from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'
import {stageEnabledExtension} from './helpers/stage-enabled-settings.mjs'
import {syntheticPack, cardExtension, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'

const engineWith = toggles => {
  const engine = defaultAssetEngineSettings()
  return {...engine, stageToggles:{...engine.stageToggles, ...toggles}}
}
async function voicedCard() {
  const pack = await syntheticPack(), figure = pack.figures[FIGURE_ID]
  const raw = {extensions:{dsh_tavern:stageEnabledExtension(cardExtension())}}
  return {pack, figure, raw}
}

// 通用声音 / 旁白 point at a figure of the library (tts.reading general / narrator .figure): here figures of an unlit pack
// that only holds voices, read through getPackSnapshot like any pack; none chosen = the browser's default voice.
const audio = pcmWav(Buffer.alloc(64, 1))
const VOICE_PACK = '22222222-2222-4222-8222-222222222222'
const preset = (serviceId, extra = {}) => ({voiceSpec:{name:'通用', language:'zh', defaultSource:'main', sources:{main:{kind:'preset', provider:'qwen', serviceId, voiceName:'Cherry'}}}, binding:extra})
function voicePack(voices) {
  return {revision:'vp-1', manifest:{id:VOICE_PACK, voiceLibrary:{version:1, voices:Object.fromEntries(Object.entries(voices).map(([id, v]) => [id, v.voiceSpec]))}},
    figures:Object.fromEntries(Object.entries(voices).map(([id, v]) => [id, {id, name:id, voice:{voice:id, ...v.binding}}]))}
}
const at = figureId => ({packId:VOICE_PACK, figureId})
// cardBubbleConfig's `pointed`: what card-stage.js reads for each pointer.
const pointing = (pack, ids) => Object.fromEntries(Object.entries(ids).map(([role, id]) => [role, id ? {ref:at(id), pack, figure:pack.figures[id] || null} : null]))

test('bubble config: an unbound enabled figure speaks the 通用声音, 「不配音」 stays silent; the prompt bytes do not change', async () => {
  const {pack, figure, raw} = await voicedCard(), engine = engineWith({}), voices = voicePack({tongyong:preset('svc-q'), mute:preset('svc-q', {source:null})}), bound = figure.voice
  delete figure.voice
  const configFor = id => cardBubbleConfig(raw, engine, [pack], [], [], () => undefined, null, pointing(voices, {general:id}))
  let config = configFor('tongyong')
  const character = config.characters.find(row => row.ref.figureId === FIGURE_ID)
  assert.equal(character.general, true)
  assert.equal(typeof config.voice.general, 'string')
  assert.equal(config.voice.generalLanguage, 'zh', 'the pointed figure\'s own 配音语言')
  assert.equal(configFor(null).voice.general, 'browser:', 'none chosen: the browser default')
  assert.equal(config.voice.fullReading, undefined)
  // The general fields never reach the dialogue-format prompt.
  const strip = value => ({...value, voice:{enabled:value.voice.enabled}, characters:value.characters.map(({general, ...row}) => row)})
  assert.deepEqual(bubbleInjection(config), bubbleInjection(strip(config)))
  assert.equal(configFor('mute').voice.general, undefined, '不配音')
  assert.equal(configFor('gone').voice.general, undefined, 'a figure gone is silent, never another voice')
  figure.voice = {...bound, source:null}
  config = configFor('tongyong')
  assert.equal(config.characters.find(row => row.ref.figureId === FIGURE_ID).general, undefined)
})
