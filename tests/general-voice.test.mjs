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
const clone = language => ({voiceSpec:{name:'小圆', language, defaultSource:'local', sources:{local:{kind:'reference-list', provider:'fish-audio', serviceId:'local', references:[{media:'a'.repeat(64), text:'你好', language}]}}}, binding:{}})
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

function speechFor(pack, {general = null, narrator = null} = {}, toggles = {}, narratorOn = false) {
  const reads = []
  const tts = createTts({profileId:'general-voice-test', reading:() => ({general:{figure:general && at(general)}, narrator:{enabled:narratorOn, figure:narrator && at(narrator)}, readAloud:{voice:null, auto:false}})})
  const library = {getPackSnapshot:async ({packId}) => packId === VOICE_PACK ? pack : null, readMedia:async input => { reads.push(input); return {bytes:audio} }}
  const presentation = {extension:withSwitches({}), subscribe:() => () => {}}
  return {tts, reads, speech:createAssetPackSpeech({presentation, getEngine:() => engineWith(toggles), getTts:() => tts, getLibrary:() => library, scope:'dsh-browser'})}
}

test('the GENERAL entry: none chosen opens the browser default; a service voice registers one source every NPC shares, in its own 配音语言', async t => {
  const browser = speechFor(voicePack({}))
  t.after(() => { browser.speech.dispose(); browser.tts.dispose() })
  const opened = await browser.speech.open(GENERAL_VOICE)
  assert.equal(opened.available, true); assert.deepEqual(opened.browser, {voice:''})

  const service = speechFor(voicePack({tongyong:preset('svc-q', {language:'ja'})}), {general:'tongyong'})
  t.after(() => { service.speech.dispose(); service.tts.dispose() })
  service.tts.registerProvider('test', {id:'svc-q', kind:'qwen', revision:'one', capabilities:{}, health:async () => ({state:'ready'}), synthesize:async () => audio})
  const first = await service.speech.open(GENERAL_VOICE), second = await service.speech.open(GENERAL_VOICE)
  assert.equal(first.available, true)
  assert.equal(first.language, 'ja')
  assert.deepEqual(first.voice, second.voice, 'two NPC lines reuse the one registered source')
  assert.equal(service.tts.listVoices({source:first.voice.source}).length, 1)
  // a figure gone: silent, not the browser.
  const gone = speechFor(voicePack({}), {general:'gone'})
  t.after(() => { gone.speech.dispose(); gone.tts.dispose() })
  assert.equal((await gone.speech.open(GENERAL_VOICE)).available, false)
  // 角色配音 off: no 通用声音 either.
  const off = speechFor(voicePack({}), {}, {voice:false})
  t.after(() => { off.speech.dispose(); off.tts.dispose() })
  assert.equal((await off.speech.open(GENERAL_VOICE)).available, false)
})
test('通用声音 and 旁白 with reference clips synthesize locally from the pointed figures\' pack; one figure is one source', async t => {
  const calls = [], pack = voicePack({xiaoyuan:clone('ja'), pangbai:clone('zh')})
  const provider = sink => ({id:'local', kind:'fish-audio', revision:'one', capabilities:{voiceKinds:['reference'], referenceInput:['bytes-list-v1']}, health:async () => ({state:'ready'}), synthesize:async input => { sink?.push(input); return audio }})
  const entry = speechFor(pack, {general:'xiaoyuan', narrator:'pangbai'}, {}, true)
  entry.tts.registerProvider('test', provider(calls))
  t.after(() => { entry.speech.dispose(); entry.tts.dispose() })
  const general = await entry.speech.open(GENERAL_VOICE), narrator = await entry.speech.open(NARRATOR_VOICE)
  assert.deepEqual([general.language, narrator.language], ['ja', 'zh'])
  assert.notEqual(general.voice.source, narrator.voice.source)
  for (const [alias, text] of [[GENERAL_VOICE, '欢迎'], [NARRATOR_VOICE, '夜深了']]) assert.ok((await entry.speech.synthesize(alias, {text})).key)
  assert.equal(calls.length, 2)
  assert.ok(calls.every(input => input.voice.kind === 'reference'))
  assert.ok(entry.reads.length > 0 && entry.reads.every(input => input.packId === VOICE_PACK && input.expectedRevision === 'vp-1'), 'clips come from the library')
  // 旁白 on 通用声音's figure: the same source (and so the same cached clips).
  const same = speechFor(pack, {general:'xiaoyuan', narrator:'xiaoyuan'}, {}, true)
  same.tts.registerProvider('test', provider())
  t.after(() => { same.speech.dispose(); same.tts.dispose() })
  assert.equal((await same.speech.open(NARRATOR_VOICE)).voice.source, (await same.speech.open(GENERAL_VOICE)).voice.source)
})
test('旁白 keys as the figure it points at, 通用声音\'s when they share one; 不配音 silences it', async t => {
  const {pack, raw} = await voicedCard(), voices = voicePack({tongyong:preset('svc-q'), ja:preset('svc-q', {language:'ja'}), mute:preset('svc-q', {source:null})})
  raw.extensions.dsh_tavern.stage.narrator = {enabled:true}
  const configFor = ids => cardBubbleConfig(raw, engineWith({}), [pack], [], [{id:'svc-q'}], () => undefined, {enabled:false}, pointing(voices, ids))
  const config = configFor({general:'tongyong', narrator:'tongyong'})
  assert.equal(config.narrator.voiceKey, config.voice.general)
  assert.deepEqual(configFor({general:'tongyong', narrator:'ja'}).narrator.language, 'ja')
  assert.notEqual(configFor({general:'tongyong', narrator:'ja'}).narrator.voiceKey, config.voice.general)
  assert.deepEqual(configFor({general:'tongyong', narrator:null}).narrator, {voiceKey:'browser:', language:'zh'}, 'none chosen: the browser default')
  assert.equal(configFor({general:'tongyong', narrator:'mute'}).narrator, undefined)
  const entry = speechFor(voices, {general:'mute', narrator:'mute'}, {}, true)
  t.after(() => { entry.speech.dispose(); entry.tts.dispose() })
  for (const alias of [GENERAL_VOICE, NARRATOR_VOICE]) assert.equal((await entry.speech.open(alias)).available, false)
})
