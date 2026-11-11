import assert from 'node:assert/strict'
import test from 'node:test'
import { createMediaHandlers } from '../tavern-plugin/lib/rpc/media.js'
import { createLineSpeech, createSpeechProviderBridge, NARRATOR_ALIAS, speechText, TTS_UNAVAILABLE } from '../tavern-plugin/lib/domain/speech.js'
import { NARRATOR_VOICE } from '../tavern-plugin/lib/domain/asset-pack-speech.js'
import { createTts } from '../tavern-plugin/packages/dsh-tavern-tts/src/service.js'
import { pcmWav } from '../tavern-plugin/packages/dsh-tavern-tts/src/providers/audio.js'

const audio = pcmWav(Buffer.alloc(4800))
const VOICES = '44444444-4444-4444-8444-444444444444'
// 通用声音 / 旁白 point at a figure of the library (tts.reading general / narrator .figure): figures of one voice-only pack here.
const at = figureId => figureId ? { packId: VOICES, figureId } : null
const readingOf = ({ narrator = false, general = null, narratorFigure = null, readAloud = { voice: null, auto: false } } = {}) =>
  ({ general: { figure: at(general) }, narrator: { enabled: narrator, figure: at(narratorFigure) }, readAloud })
const OFF = readingOf(), ON = readingOf({ narrator: true })
const browserVoice = voiceName => ({ name: '朗读', language: 'zh', defaultSource: 'b', sources: { b: { kind: 'preset', provider: 'browser', ...(voiceName ? { voiceName } : {}) } } })
const minimaxVoice = (language = 'zh') => ({ name: '旁白', language, defaultSource: 'm', sources: { m: { kind: 'preset', provider: 'minimax', serviceId: 'mm', voiceName: 'female-shaonv' } } })
// figures: { id: [voiceSpec, binding extra] }
function voiceLibrary(figures = {}, reads = []) {
  const pack = { revision: 'vp-1', manifest: { id: VOICES, voiceLibrary: { version: 1, voices: Object.fromEntries(Object.entries(figures).map(([id, [spec]]) => [id, spec])) } },
    figures: Object.fromEntries(Object.entries(figures).map(([id, [, binding]]) => [id, { id, name: id, voice: { voice: id, ...binding } }])) }
  return { getPackSnapshot: async ({ packId }) => packId === VOICES ? pack : null, readMedia: async input => { reads.push(input); return { bytes: audio } } }
}

// The real voice service, with the plugin's audio address (the plugin index adds it).
function voiceService(reading = OFF) {
  const tts = createTts({ profileId: 'speech-test', reading: () => typeof reading === 'function' ? reading() : reading })
  tts.audioUrl = ticket => 'audio:' + ticket
  return tts
}
// A plugin speech provider entry as pluginApi.speechProviders() lists it.
function pluginProvider(calls, overrides = {}) {
  return { id: 'dsh-edge/edge', owner: 'dsh-edge', label: 'Edge 朗读', voices: ['xiaoxiao', 'Bad Voice'], version: 'v2',
    synthesize: async input => { calls.push(input); return { data: Buffer.from('mp3-bytes'), mediaType: 'audio/mpeg' } }, ...overrides }
}

test('旁白朗读默认关闭：整段旁白不合成；开启后按旁白指向的人物的声音念，本卡层覆盖全局', async () => {
  const calls = []
  let reading = readingOf({ narratorFigure: 'yunxi' })
  const tts = voiceService(() => reading)
  const bridge = createSpeechProviderBridge({ providers: () => [pluginProvider(calls)], toWav: async () => audio })
  bridge.attach(tts)
  const speech = createLineSpeech({ getTts: () => tts, getLibrary: () => voiceLibrary({ yunxi: [browserVoice('Yunxi')], tingting: [browserVoice('Tingting')] }) })
  for (const text of ['夜深了。', '雨还在下。', '她没有回头。']) assert.deepEqual(await speech.speak({ text, narration: true }), { skip: true, reason: 'narration' })
  assert.deepEqual(calls, [], '旁白关闭时不请求合成')

  const extension = { stage: { narrator: { enabled: true } } }
  assert.deepEqual(await speech.speak({ text: '夜深了。', narration: true, extension }), { browser: true, voice: 'Yunxi', text: '夜深了。' }, '本卡开启')
  reading = readingOf({ narrator: true, narratorFigure: 'tingting' })
  assert.deepEqual(await speech.speak({ text: '夜深了。', narration: true }), { browser: true, voice: 'Tingting', text: '夜深了。' }, '全局开启，换了指向的人物')
  assert.deepEqual(await speech.speak({ text: '夜深了。', narration: true, extension: { stage: { narrator: { enabled: false } } } }), { skip: true, reason: 'narration' }, '本卡关闭')
  assert.deepEqual(calls, [])
})

test('其他台词用通用声音：未选为浏览器默认声音，浏览器声音原样交给浏览器', async () => {
  let reading = OFF
  const tts = voiceService(() => reading)
  const speech = createLineSpeech({ getTts: () => tts, getLibrary: () => voiceLibrary({ tingting: [browserVoice('Tingting')] }) })
  assert.deepEqual(await speech.speak({ text: '“欢迎回来。”', speaker: '林曦' }), { browser: true, voice: '', text: '“欢迎回来。”' })
  reading = readingOf({ general: 'tingting' })
  assert.deepEqual(await speech.speak({ text: '*她笑了* 好', speaker: '林曦' }), { browser: true, voice: 'Tingting', text: '她笑了 好' })
  assert.deepEqual(await speech.speak({ text: '<br>' }), { skip: true, reason: 'empty' })
})

test('插件配音渠道接入语音服务：注册为 tavern-plugin:<owner>:<id>，版本即 revision，全文朗读经插件合成并转成 WAV 音频票据', async () => {
  const calls = [], converted = [], tts = voiceService({ ...OFF, readAloud: { voice: { serviceId: 'tavern-plugin:dsh-edge:edge', voice: 'xiaoxiao' }, auto: false } })
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
  const reply = await speech.read({ text: '别过来！' })
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

test('旁白的服务声音按所指人物的配音语言合成，同一句只合成一次', async () => {
  const calls = [], tts = voiceService(readingOf({ narrator: true, narratorFigure: 'mm-ja' }))
  tts.registerProvider('test', { id: 'mm', kind: 'minimax', revision: 'r1', capabilities: {}, health: async () => ({ state: 'ready' }), catalog: async () => [],
    synthesize: async input => { calls.push(input); return audio } })
  const speech = createLineSpeech({ getTts: () => tts, getLibrary: () => voiceLibrary({ 'mm-ja': [minimaxVoice('ja')] }) })
  const extension = { stage: {} }
  const first = await speech.speak({ text: '夜深了。', narration: true, extension })
  assert.match(first.url, /^audio:/)
  assert.equal((await speech.speak({ text: '夜深了。', narration: true, extension })).mediaType, 'audio/wav')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].voice.kind, 'minimax')
  assert.equal(calls[0].language, 'ja')
  assert.equal(NARRATOR_ALIAS, NARRATOR_VOICE)
})
test('通用声音与旁白的参考音色经本地服务合成：路人、未绑定人物和旁白；参考音频按哈希从所指人物的素材包读取', async t => {
  const hash = 'a'.repeat(64), calls = [], reads = []
  const spec = { name: '小圆', language: 'zh', defaultSource: 'clone', sources: { clone: { kind: 'reference-list', provider: 'fish-audio', serviceId: 'local', references: [{ media: hash, text: '你好。', language: 'zh' }] } } }
  const tts = voiceService(readingOf({ narrator: true, general: 'xiaoyuan', narratorFigure: 'xiaoyuan' }))
  tts.registerProvider('test', { id: 'local', kind: 'fish-audio', revision: 'one', capabilities: { voiceKinds: ['reference'], referenceInput: ['bytes-list-v1'] }, health: async () => ({ state: 'ready' }),
    synthesize: async input => { calls.push(input); return audio } })
  const speech = createLineSpeech({ getTts: () => tts, getLibrary: () => voiceLibrary({ xiaoyuan: [spec] }, reads) })
  t.after(() => { speech.dispose(); tts.dispose() })
  const figures = { voiced: async () => false }
  for (const line of [{ speaker: '路人', text: '欢迎。' }, { speaker: '未绑定人物', text: '你好。', figures }, { narration: true, text: '夜深了。', extension: { stage: {} } }]) {
    const result = await speech.speak(line)
    assert.match(result.url, /^audio:/)
    assert.deepEqual(Buffer.from(await tts.redeemAudioTicket(result.url.slice(6))), audio)
  }
  assert.equal(calls.length, 3)
  assert.ok(calls.every(input => input.voice.kind === 'reference'))
  assert.ok(reads.length > 0 && reads.every(input => input.packId === VOICES && input.hash === hash))
})

test('通用声音「不配音」或所指人物不在了：未绑定的说话人和旁白都不出声', async t => {
  const tts = voiceService(readingOf({ narrator: true, general: 'mute', narratorFigure: 'gone' }))
  const speech = createLineSpeech({ getTts: () => tts, getLibrary: () => voiceLibrary({ mute: [browserVoice(), { source: null }] }) })
  t.after(() => { speech.dispose(); tts.dispose() })
  assert.deepEqual(await speech.speak({ speaker: 'NPC', text: 'Hello.' }), { skip: true, reason: 'silent' })
  await assert.rejects(speech.speak({ narration: true, text: 'Night falls.', extension: { stage: {} } }), { code: 'VOICE_NOT_FOUND' })
})
