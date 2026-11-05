import assert from 'node:assert/strict'
import test from 'node:test'
import { createMediaHandlers } from '../tavern-plugin/lib/rpc/media.js'
import { createLineSpeech, createSpeechProviderBridge, NARRATOR_ALIAS, speechText, TTS_UNAVAILABLE } from '../tavern-plugin/lib/domain/speech.js'
import { NARRATOR_VOICE } from '../tavern-plugin/lib/domain/asset-pack-speech.js'
import { figureTtsVoice } from '../tavern-plugin/lib/domain/figure-voice.js'
import { assetPackDigest } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-catalogue.js'
import { createTts } from '../tavern-plugin/packages/dsh-tavern-tts/src/service.js'
import { pcmWav } from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'

const audio = pcmWav(Buffer.alloc(4800))
const OFF = { dialogueVoice: null, narrator: { enabled: false, voice: null } }

// The real voice service, with the plugin's audio address (the plugin index adds it).
function voiceService(reading = OFF) {
  const tts = createTts({ profileId: 'speech-test', reading: () => reading })
  tts.audioUrl = ticket => 'audio:' + ticket
  return tts
}
// A plugin speech provider entry as pluginApi.speechProviders() lists it.
function pluginProvider(calls, overrides = {}) {
  return { id: 'dsh-edge/edge', owner: 'dsh-edge', label: 'Edge 朗读', voices: ['xiaoxiao', 'Bad Voice'], version: 'v2',
    synthesize: async input => { calls.push(input); return { data: Buffer.from('mp3-bytes'), mediaType: 'audio/mpeg' } }, ...overrides }
}

test('朗读文字：去掉标记与装饰，最多 1000 字', () => {
  assert.equal(speechText('*她笑了* <b>好</b>'), '她笑了 好')
  assert.equal(speechText('# 标题\n\n> 引用'), '标题 引用')
  assert.equal([...speechText('字'.repeat(1200))].length, 1000)
})

test('没有语音服务：返回 TTS_UNAVAILABLE，不抛错', async () => {
  const speech = createLineSpeech({ getTts: () => undefined })
  assert.deepEqual(await speech.speak({ text: '你好', speaker: '林曦' }), TTS_UNAVAILABLE)
  assert.deepEqual(await speech.speak({ text: '夜深了。', narration: true }), TTS_UNAVAILABLE)
  assert.equal(speech.pendingCount(), 0)
})

test('旁白朗读默认关闭：整段旁白不合成；开启后按旁白声音念，本卡层覆盖全局', async () => {
  const calls = [], tts = voiceService()
  const bridge = createSpeechProviderBridge({ providers: () => [pluginProvider(calls)], toWav: async () => audio })
  bridge.attach(tts)
  const speech = createLineSpeech({ getTts: () => tts })
  for (const text of ['夜深了。', '雨还在下。', '她没有回头。']) assert.deepEqual(await speech.speak({ text, narration: true }), { skip: true, reason: 'narration' })
  assert.deepEqual(calls, [], '旁白关闭时不请求合成')

  const extension = { stage: { narrator: { enabled: true, voice: { browser: 'Tingting' } } } }
  assert.deepEqual(await speech.speak({ text: '夜深了。', narration: true, extension }), { browser: true, voice: 'Tingting', text: '夜深了。' })
  // A figure narrator speaks only where the stage resolves her (figures).
  const figureNarrator = { stage: { narrator: { enabled: true, voice: { packId: 'p', figureId: 'f' } } } }
  assert.deepEqual(await speech.speak({ text: '夜深了。', narration: true, extension: figureNarrator }), { skip: true, reason: 'narration' })
  assert.deepEqual(calls, [])
})

test('其他台词用台词朗读声音：未设为浏览器默认声音，浏览器声音原样交给浏览器', async () => {
  let reading = OFF
  const tts = voiceService()
  tts.reading = () => structuredClone(reading)
  const speech = createLineSpeech({ getTts: () => tts })
  assert.deepEqual(await speech.speak({ text: '“欢迎回来。”', speaker: '林曦' }), { browser: true, voice: '', text: '“欢迎回来。”' })
  reading = { ...OFF, dialogueVoice: { browser: 'Tingting' } }
  assert.deepEqual(await speech.speak({ text: '*她笑了* 好', speaker: '林曦' }), { browser: true, voice: 'Tingting', text: '她笑了 好' })
  assert.deepEqual(await speech.speak({ text: '<br>' }), { skip: true, reason: 'empty' })
})

test('插件配音渠道接入语音服务：注册为 tavern-plugin:<owner>:<id>，版本即 revision，台词经插件合成并转成 WAV 音频票据', async () => {
  const calls = [], converted = [], tts = voiceService({ ...OFF, dialogueVoice: { serviceId: 'tavern-plugin:dsh-edge:edge', voice: 'xiaoxiao' } })
  let entries = [pluginProvider(calls)]
  const bridge = createSpeechProviderBridge({ providers: () => entries, toWav: async (data, mediaType) => { converted.push(mediaType); return audio } })
  const detach = bridge.attach(tts)
  const [service] = await tts.listServices()
  assert.equal(service.id, 'tavern-plugin:dsh-edge:edge')
  assert.equal(service.kind, 'service')
  assert.equal(service.revision, 'v2')
  // Only voices the voice service can address join its catalogue.
  assert.deepEqual((await tts.listServiceVoices()).filter(voice => voice.serviceId === service.id).map(voice => voice.id), ['xiaoxiao'])

  const speech = createLineSpeech({ getTts: () => tts })
  const reply = await speech.speak({ text: '别过来！', speaker: '路人', emotion: 'fear' })
  assert.match(reply.url, /^audio:/)
  assert.equal(reply.mediaType, 'audio/wav')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].voice, 'xiaoxiao')
  assert.equal(calls[0].text, '别过来！')
  assert.deepEqual(converted, ['audio/mpeg'])
  assert.deepEqual(Buffer.from(await tts.redeemAudioTicket(reply.url.slice(6))), audio)

  // A plugin that unloads leaves the voice service; another one joins on sync.
  entries = []
  bridge.sync()
  assert.deepEqual(await tts.listServices(), [])
  entries = [pluginProvider(calls, { id: 'dsh-edge/edge2', version: '' })]
  bridge.sync()
  assert.deepEqual((await tts.listServices()).map(row => [row.id, row.revision]), [['tavern-plugin:dsh-edge:edge2', '0']])
  detach()
  assert.deepEqual(await tts.listServices(), [])
})

test('预设服务声音（{serviceId, voice}）注册为与舞台旁白同一个单源声音，同一句只合成一次', async () => {
  const calls = [], tts = voiceService({ ...OFF, narrator: { enabled: true, voice: { serviceId: 'mm', voice: 'female-shaonv' } } })
  tts.registerProvider('test', { id: 'mm', kind: 'minimax', revision: 'r1', capabilities: {}, health: async () => ({ state: 'ready' }), catalog: async () => [],
    synthesize: async input => { calls.push(input); return audio } })
  const speech = createLineSpeech({ getTts: () => tts })
  const first = await speech.speak({ text: '夜深了。', narration: true })
  assert.match(first.url, /^audio:/)
  assert.equal((await speech.speak({ text: '夜深了。', narration: true })).mediaType, 'audio/wav')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].voice.kind, 'minimax')
  // The same source the stage's narrator registers for this voice (shared audio, no revision conflict).
  const spec = { name: '旁白', language: 'zh', defaultSource: 'narrator', sources: { narrator: { kind: 'preset', provider: 'minimax', voiceName: 'female-shaonv' } } }
  const voice = figureTtsVoice({ voice: 'narrator' }, spec, 'narrator')
  assert.ok(tts.listVoices({ source: 'narrator:' + assetPackDigest({ voice, readings: [], binding: { serviceId: 'mm' }, id: 'female-shaonv', language: 'zh' }) }).length)
  assert.equal(NARRATOR_ALIAS, NARRATOR_VOICE)
})

test('有人物声音的说话人走本卡的素材包配音；旁白走本卡旁白；没有人物声音的说话人用台词朗读声音', async () => {
  const submitted = []
  const tts = { apiVersion: 1, subscribe: () => () => {}, reading: () => ({ ...OFF, dialogueVoice: { browser: 'Kyoko' } }), audioUrl: ticket => 'audio:' + ticket,
    jobs: {
      submit(input, options) { submitted.push([input, options]); return { requestId: 'r' + submitted.length } },
      async wait(requestId) { return { state: 'ready', result: { ticket: 't-' + requestId, loudness: { version: 1, gain: 1 } } } }
    } }
  const opened = []
  const figures = {
    async voiced(alias) { return alias === '林曦' },
    async open(alias) {
      opened.push(alias)
      if (opened.length === 1) return { available: false, diagnostics: ['TTS_STALE'] }
      return alias === NARRATOR_VOICE ? { available: true, browser: { voice: 'Tingting' }, diagnostics: [] }
        : { available: true, voice: { source: 'figure:p:f:1', id: 'voice' }, language: 'ja', scope: 'dsh-browser', diagnostics: [] }
    }
  }
  const speech = createLineSpeech({ getTts: () => tts })
  assert.deepEqual(await speech.speak({ text: 'おかえり', speaker: '林曦', emotion: 'joy', figures }), { url: 'audio:t-r1', mediaType: 'audio/wav', loudness: { version: 1, gain: 1 } })
  assert.deepEqual(opened, ['林曦', '林曦'], '首次打开的修订冲突重开一次')
  assert.deepEqual(submitted[0], [{ voice: { source: 'figure:p:f:1', id: 'voice' }, text: 'おかえり', mood: 'joy', language: 'ja' }, { principal: 'dsh-browser', scope: 'dsh-browser' }])
  assert.deepEqual(await speech.speak({ text: '夜深了。', narration: true, figures }), { browser: true, voice: 'Tingting', text: '夜深了。' })
  assert.deepEqual(await speech.speak({ text: '你好', speaker: '路人', figures }), { browser: true, voice: 'Kyoko', text: '你好' })
  assert.equal(submitted.length, 1)
})

test('speechForLine 把页面的同源来源交给 speakLine', async () => {
  const calls = []
  const handlers = createMediaHandlers({ speakLine: async (...args) => { calls.push(args); return { skip: true, reason: 'TTS_UNAVAILABLE' } }, str: String })
  assert.deepEqual(await handlers.speechForLine({ sessionId: 's1', speaker: '林曦', text: '你好' }, 'speechForLine', false, { origin: 'http://127.0.0.1:1' }), { skip: true, reason: 'TTS_UNAVAILABLE' })
  assert.deepEqual(calls, [['s1', { sessionId: 's1', speaker: '林曦', text: '你好' }, 'http://127.0.0.1:1']])
  for (const removed of ['getSpeechSettings', 'updateSpeechSettings', 'speechTest']) assert.equal(handlers[removed], undefined)
})

for (const template of [false, true]) test(`catalogue ${template ? 'template' : 'clone'} speaks NPC, unbound figure and narration through the local service`, async t => {
  const ref = template ? {templateId:'33333333-3333-4333-8333-333333333333'} : {packId:'11111111-1111-4111-8111-111111111111',voiceId:'library-clone'}
  const hash = 'a'.repeat(64), calls = [], reads = []
  const spec = {name:'小圆',language:'zh',defaultSource:'clone',sources:{clone:{kind:'reference-list',provider:'fish-audio',serviceId:'local',references:[{media:hash,text:'你好。',language:'zh'}]}}}
  const library = {listVoiceCatalogue:async () => ({voices:[{ref,name:spec.name,voiceSpec:spec,binding:{voice:'library-clone'},revision:'r1'}]}),
    readMedia:async input => { reads.push(input); return {bytes:audio} },
    readVoiceTemplateMedia:async input => { reads.push(input); return {bytes:audio} }}
  const tts = voiceService({dialogueVoice:ref,narrator:{enabled:true,voice:ref}})
  tts.registerProvider('test',{id:'local',kind:'fish-audio',revision:'one',capabilities:{voiceKinds:['reference'],referenceInput:['bytes-list-v1']},health:async () => ({state:'ready'}),
    synthesize:async input => { calls.push(input); return audio }})
  const speech = createLineSpeech({getTts:() => tts,getLibrary:() => library})
  t.after(() => { speech.dispose(); tts.dispose() })
  const figures = {voiced:async () => false}
  for (const line of [{speaker:'路人',text:'欢迎。'}, {speaker:'未绑定人物',text:'你好。',figures}, {narration:true,text:'夜深了。'}]) {
    const result = await speech.speak(line)
    assert.match(result.url,/^audio:/)
    assert.deepEqual(Buffer.from(await tts.redeemAudioTicket(result.url.slice(6))),audio)
  }
  assert.equal(calls.length,3)
  assert.ok(calls.every(input => input.voice.kind === 'reference'))
  assert.ok(reads.length > 0)
  assert.ok(reads.every(input => input.hash === hash && input.expectedRevision === 'r1' && (template ? input.templateId === ref.templateId : input.packId === ref.packId)))
})
for (const voice of [{browser:'Kyoko'}, {serviceId:'mm',voice:'female-shaonv'}]) test('narrator without its own voice uses general voice: ' + JSON.stringify(voice), async t => {
  const calls = [], tts = voiceService({dialogueVoice:voice,narrator:{enabled:true,voice:null}})
  tts.registerProvider('test', {id:'mm',kind:'minimax',revision:'r1',capabilities:{},health:async () => ({state:'ready'}),catalog:async () => [],
    synthesize:async input => { calls.push(input); return audio }})
  const speech = createLineSpeech({getTts:() => tts})
  t.after(() => { speech.dispose(); tts.dispose() })
  const result = await speech.speak({text:'Night falls.',narration:true})
  if (voice.browser) assert.deepEqual(result,{browser:true,voice:voice.browser,text:'Night falls.'})
  else { assert.match(result.url,/^audio:/); assert.equal(calls.length,1) }
})

test('silent general voice silences unbound speakers and fallback narration', async t => {
  const tts = voiceService({dialogueVoice:{silent:true},narrator:{enabled:true,voice:null}})
  const speech = createLineSpeech({getTts:() => tts})
  t.after(() => { speech.dispose(); tts.dispose() })
  for (const line of [{speaker:'NPC',text:'Hello.'}, {narration:true,text:'Night falls.'}])
    assert.deepEqual(await speech.speak(line),{skip:true,reason:'silent'})
})
