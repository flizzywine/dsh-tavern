import test from 'node:test'
import assert from 'node:assert/strict'
import { createQwenAdapter, QWEN_MOODS } from '../src/providers/qwen.js'
import { createAzureAdapter, AZURE_MOODS } from '../src/providers/azure.js'
import { createVolcengineAdapter, VOLCENGINE_MOODS } from '../src/providers/volcengine.js'
import { presetParams } from '../src/providers/params.js'
import { portableVoice, hash } from '../src/core.js'
import { createTts } from '../src/service.js'
import { createServiceSettings } from '../src/settings.js'
import { pcmWav } from '../src/providers/audio.js'

const audio = pcmWav(Buffer.alloc(100, 1))
const audioUrl = 'https://audio.example.test/result.wav'
const base = { text: 'hello <&>"\'', language: 'en', mood: 'joy' }
const params = { qwen: { voice: 'Bella', model: 'qwen3-tts-instruct-flash' }, azure: { voiceName: 'zh-CN-XiaoxiaoNeural' }, volcengine: { speaker: 'test-speaker', speechRate: 0 } }
function fakeFetch(calls) {
  return async (url, options) => {
    calls.push({ url, ...options })
    if (url.includes('dashscope')) return Response.json({ output: { audio: { url: audioUrl } } })
    if (url.includes('bytedance')) return new Response(JSON.stringify({ code: 0, data: Buffer.alloc(100, 1).toString('base64') }) + '\n' + JSON.stringify({ code: 20000000 }))
    return new Response(audio)
  }
}
function fixture(kind) {
  const calls = [], adapter = ({ qwen: createQwenAdapter, azure: createAzureAdapter, volcengine: createVolcengineAdapter })[kind]({ fetch: fakeFetch(calls) })
  return { calls, async say(mood, overrides = {}, extra = {}) {
    calls.length = 0
    await adapter.synthesize({ config: { region: 'eastasia', appId: 'test', resourceId: 'seed-tts-1.0' } }, { key: 'fake', accessKey: 'fake' }, { ...base, mood, params: { ...params[kind], ...overrides }, ...extra })
    return kind === 'azure' ? calls[0].body : JSON.parse(calls[0].body)
  } }
}

test('Qwen instruct sends each base instruction; calm, unknown and non-instruct are neutral', async () => {
  const f = fixture('qwen')
  for (const [mood, instruction] of Object.entries({e_smile:'A light smile',calm:'Explicit instruction',sad:null})) {
    const body = await f.say(mood,{moodInstruction:instruction})
    assert.equal(body.input.instructions, instruction || undefined)
  }
  for (const mood of [undefined, '', 'unknown', 'constructor', '__proto__']) assert.equal((await f.say(mood)).input.instructions, undefined)
  for (const model of ['qwen3-tts-flash', 'qwen-tts']) assert.equal((await f.say('joy', { model, moods: { joy: 'custom' } })).input.instructions, undefined)
  assert.equal((await f.say('calm', { moods: { calm: 'custom' } })).input.instructions, 'custom') // the ID carries no neutral semantics.
})

test('Qwen preset override merges defaults, supports custom ids, null disables', async () => {
  const f = fixture('qwen'), moods = { joy: 'custom instruction', custom_1: 'another instruction', sad: null }
  assert.equal((await f.say('joy', { moods })).input.instructions, moods.joy)
  assert.equal((await f.say('custom_1', { moods })).input.instructions, moods.custom_1)
  assert.equal((await f.say('sad', { moods })).input.instructions, undefined)
  assert.equal((await f.say('anger', { moods })).input.instructions, QWEN_MOODS.anger)
})

test('Azure applies only supported styles; calm and shy do not inherit old builtin mappings', async () => {
  const f = fixture('azure')
  for (const [mood, style] of Object.entries({e_smile:'cheerful',calm:null})) {
    const ssml = await f.say(mood,{style})
    if (style) assert.ok(ssml.includes('style="' + style + '"'))
    else assert.doesNotMatch(ssml, /express-as/)
  }
  assert.doesNotMatch(await f.say('love', { voiceName: 'zh-CN-YunxiNeural' }), /express-as/)
  assert.doesNotMatch(await f.say('joy', { styles: false }), /express-as/)
  for (const mood of [undefined, 'unknown', 'constructor', '__proto__']) assert.doesNotMatch(await f.say(mood), /express-as/)
  for (const styles of [undefined, false, true]) {
    const ssml = await f.say('joy', { voiceName: 'en-US-AshleyNeural', pitch: 25, rate: 8, styles, moods: { joy: 'cheerful' } }, { moodStyles: { joy: 'friendly' } })
    assert.doesNotMatch(ssml, /express-as/)
    assert.match(ssml, /pitch="\+25%" rate="\+8%"/)
  }
})

test('Azure unknown voices require preset opt-in, escape text/style, and respect null overrides', async () => {
  const f = fixture('azure'), voiceName = 'en-US-JennyNeural'
  assert.doesNotMatch(await f.say('joy', { voiceName }), /express-as/)
  assert.match(await f.say('joy', { voiceName, styles: true, style:'cheerful' }), /style="cheerful"/) // explicitly declared style.
  const ssml = await f.say('custom', { voiceName, styles: true, moods: { custom: '<&>"\'' } })
  assert.match(ssml, /style="&lt;&amp;&gt;&quot;&apos;"/)
  assert.match(ssml, /hello &lt;&amp;&gt;&quot;&apos;/)
  assert.doesNotMatch(await f.say('joy', { moods: { joy: null } }, { moodStyles: { joy: 'friendly' } }), /express-as/)
  assert.match(await f.say('custom', { moods: { custom: 'friendly' } }), /style="friendly"/)
  assert.doesNotMatch(await f.say('unknown', {}, { moodStyles: { default: 'friendly' } }), /express-as/)
})

test('Volcengine V3 emits documented audio_params emotion and scale, never for neutral/missing', async () => {
  const f = fixture('volcengine')
  for (const [mood, emotion] of Object.entries({e_smile:'happy',calm:null})) {
    const body = await f.say(mood,{emotion}), p = body.req_params.audio_params
    assert.equal(p.emotion, emotion || undefined)
    assert.equal(p.emotion_scale, emotion ? 1 : undefined)
    assert.equal(p.format, 'pcm'); assert.equal(p.sample_rate, 24000)
    assert.equal(f.calls[0].url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional')
  }
  for (const mood of [undefined, 'unknown', 'constructor', '__proto__']) assert.equal((await f.say(mood)).req_params.audio_params.emotion, undefined)
  assert.equal((await f.say('joy', { moods: { joy: null } })).req_params.audio_params.emotion, undefined)
  assert.equal((await f.say('custom', { emotion:'tender' })).req_params.audio_params.emotion, 'tender')
  assert.equal((await f.say('unknown', {}, { moodStyles: { default: 'happy' } })).req_params.audio_params.emotion, undefined)
})

test('cloud preset mood overrides are bounded and roundtrip without trimming or dropping null', () => {
  const moods = { joy: null, custom_1: ' instruction ', ['a'.repeat(32)]: 'x'.repeat(200) }
  for (const kind of Object.keys(params)) {
    const normalized = presetParams(kind, { ...params[kind], moods })
    assert.deepEqual(normalized.moods, moods)
    assert.notEqual(normalized.moods, moods)
    assert.equal(presetParams(kind, { ...params[kind], moods: Object.fromEntries(Array.from({ length: 32 }, (_, i) => ['m' + i, ''])) }).moods.m31, '')
    for (const invalid of [null, [], 'text', { Joy: 'bad' }, { 'a/b': 'bad' }]) assert.throws(() => presetParams(kind, { ...params[kind], moods: invalid }))
    for (const invalid of [{ ['a'.repeat(33)]: 'bad' }, { '1mood': 'bad' }, { joy: 1 }, { joy: false }, { joy: {} }, { joy: 'x'.repeat(201) }, Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['m' + i, null]))]) assert.throws(() => presetParams(kind, { ...params[kind], moods: invalid }))
  }
  assert.throws(() => presetParams('azure', { ...params.azure, styles: ['cheerful'] }))
  const voice = { schemaVersion: 1, id: 'qwen/custom', voiceId: 'qwen/custom', kind: 'service', engine: 'qwen', revision: '1', enabled: true, label: 'Custom', languages: ['en'], params: { ...params.qwen, moods } }
  assert.deepEqual(portableVoice(voice).params.moods, moods)
  assert.throws(() => portableVoice({ ...voice, params: { ...params.qwen, moods: { joy: 1 } } }), { code: 'INVALID_PARAMS' })
})

for (const kind of Object.keys(params)) test(kind + ' end-to-end fake synthesis caches repeated text+mood separately', async t => {
  const tts = createTts(), calls = [], settings = { providers: [{ id: 'provider', kind, config: { region: kind === 'qwen' ? 'cn' : 'eastasia', appId: 'test', resourceId: 'seed-tts-1.0' } }] }
  const service = createServiceSettings({ tts, get: () => settings, credentials: () => ({ resolve: async () => ({ value: 'fake' }) }), fetch: fakeFetch(calls) })
  t.after(async () => { service.dispose(); await tts.dispose() }); service.sync()
  tts.registerVoiceSource({ owner: 'test', sourceId: 'card', revision: '1', bindings: { custom: 'provider' }, voices: [{ schemaVersion: 1, id: 'custom', kind, label: 'Custom', enabled: true, languages: ['en'], params: { ...params[kind], moods: { custom: kind === 'azure' ? 'friendly' : 'custom', sad: null } } }] })
  const { grant } = tts.grantConsumer({ principal: 'test', source: 'card', scope: 'card' })
  const say = mood => tts.synthesize({ voice: { source: 'card', id: 'custom' }, text: 'hello', language: 'en', mood }, { grant, scope: 'card' })
  const first = await say('joy'), count = calls.length
  assert.equal(first.cacheHit, false); assert.ok(count > 0)
  assert.deepEqual(await say('joy'), { ...first, cacheHit: true }); assert.equal(calls.length, count)
  for (const mood of ['anger', 'custom', 'sad', 'unknown']) {
    const next = await say(mood)
    assert.notEqual(next.key, first.key); assert.equal(next.cacheHit, false)
    const before = calls.length
    assert.deepEqual(await say(mood), { ...next, cacheHit: true }); assert.equal(calls.length, before)
  }
})

test('cache identity explicitly hashes resolved provider mood, not only the caller mood id', async t => {
  let metadata, storedKey
  const tts = createTts({ profileId: 'test', cache: {get:async()=>null,loudness:async()=>null,
    put:async(key,_audio,_scopes,qa)=>{storedKey=key;metadata=qa},flush:async()=>{}} }); t.after(() => tts.dispose())
  let synthesis
  tts.registerProvider('test', { id: 'provider', kind: 'qwen', revision: '1', synthesize: async spec => { synthesis = spec; return audio } })
  tts.registerVoiceSource({ owner: 'test', sourceId: 'card', revision: '1', bindings: { custom: 'provider' }, voices: [{ schemaVersion: 1, id: 'custom', kind: 'qwen', enabled: true, label: 'Custom', languages: ['en'], params: params.qwen }] })
  const { grant } = tts.grantConsumer({ principal: 'test', source: 'card', scope: 'card' })
  const result = await tts.synthesize({ voice: { source: 'card', id: 'custom' }, text: 'hello', language: 'en', mood: 'joy' }, { grant, scope: 'card' })
  assert.equal(synthesis.resolvedMood, null) // no implicit style.
  const identity = Object.fromEntries(['version', 'profileId', 'source', 'voice', 'provider', 'slot', 'mood', 'resolvedMood', 'language', 'params', 'readings', 'text'].map(key => [key, synthesis[key]]))
  assert.equal(hash(identity), result.key)
  assert.equal(storedKey, result.key)
  assert.equal(metadata.text, synthesis.text)
  assert.equal(metadata.chars, [...synthesis.text].length)
  assert.equal(metadata.model, params.qwen.model)
  assert.equal(metadata.provider, 'provider')
  assert.equal(Object.hasOwn(metadata, 'params'), false)
  assert.notEqual(hash({ ...identity, resolvedMood: 'explicit-style' }), result.key)
})
