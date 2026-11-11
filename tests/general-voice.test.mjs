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

})

for (const template of [false,true]) test(`stage catalogue ${template?'template':'clone'} routes general and narrator to local synthesis`, async t => {
  const ref=template?{templateId:'33333333-3333-4333-8333-333333333333'}:{packId:'11111111-1111-4111-8111-111111111111',voiceId:'clone'}
  assert.deepEqual(validateCardStage({narrator:{voice:ref}}).narrator.voice,ref)
  const calls=[],audio=pcmWav(Buffer.alloc(64,1)),reading={dialogueVoice:ref,narrator:{enabled:true,voice:ref}}
  const tts=createTts({reading:()=>reading})
  tts.registerProvider('test',{id:'local',kind:'fish-audio',revision:'one',capabilities:{voiceKinds:['reference'],referenceInput:['bytes-list-v1']},health:async()=>({state:'ready'}),synthesize:async input=>{calls.push(input);return audio}})
  const library={listVoiceCatalogue:async()=>({voices:[{ref,revision:'one',binding:{voice:'clone'},voiceSpec:{name:'小圆',language:'zh',defaultSource:'local',sources:{local:{kind:'reference-list',provider:'fish-audio',serviceId:'local',references:[{media:'a'.repeat(64),text:'你好',language:'zh'}]}}}}]}),readMedia:async()=>({bytes:audio}),readVoiceTemplateMedia:async()=>({bytes:audio})}
  const speech=createAssetPackSpeech({presentation:{extension:withSwitches({}),subscribe:()=>()=>{}},getEngine:()=>engineWith({}),getTts:()=>tts,getLibrary:()=>library,scope:'dsh-browser'})
  t.after(()=>{speech.dispose();tts.dispose()})
  for (const [alias,text] of [[GENERAL_VOICE,'欢迎'],[NARRATOR_VOICE,'夜深了']]) {
    const opened=await speech.open(alias)
    assert.equal(opened.available,true,JSON.stringify(opened))
    assert.ok((await speech.synthesize(alias,{text})).key)
  }
  assert.equal(calls.length,2)
  assert.ok(calls.every(input=>input.voice.kind==='reference'))
})
for (const generalVoice of [{browser:'Kyoko'}, {serviceId:'svc-q',voice:'v-cherry'}]) test('narrator fallback and silent general voice: ' + JSON.stringify(generalVoice), async t => {
  const {pack,raw} = await voicedCard()
  raw.extensions.dsh_tavern.stage.narrator = {enabled:true}
  const configFor = voice => cardBubbleConfig(raw,engineWith({}),[pack],[],[{id:'svc-q'}],() => undefined,{enabled:false,voice:null},voice)
  const config = configFor(generalVoice)
  assert.equal(config.narrator.voiceKey,config.voice.general)
  const silent = configFor({silent:true})
  assert.equal(silent.voice.general,undefined)
  assert.equal(silent.narrator,undefined)
  const entry = speechFor({dialogueVoice:{silent:true},narrator:{enabled:true,voice:null}})
  t.after(() => { entry.speech.dispose(); entry.tts.dispose() })
  for (const alias of [GENERAL_VOICE,NARRATOR_VOICE]) assert.equal((await entry.speech.open(alias)).available,false)
})
