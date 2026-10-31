import assert from 'node:assert/strict'
import test from 'node:test'
import { createMediaHandlers } from '../tavern-plugin/lib/rpc/media.js'
import { createSpeech, minimaxEmotion, speechText, volcengineEmotion, volcengineResource } from '../tavern-plugin/lib/domain/speech.js'

function harness({ responses = [] } = {}) {
  const files = new Map(), keys = new Map(), requests = []
  const store = {
    async readJson(path) { return files.has(path) ? JSON.parse(files.get(path)) : undefined },
    async writeJson(path, value) { files.set(path, JSON.stringify(value)) },
    async writeBytes(path, data) { files.set(path, Buffer.from(data)) },
    async readBytes(path) { return files.get(path) },
    async size(path) { return files.has(path) ? files.get(path).length : 0 }
  }
  const credentials = { async resolve(ref) { return keys.has(ref) ? { value: keys.get(ref) } : undefined }, async set(ref, value) { keys.set(ref, value) } }
  const fetchImpl = async (url, init) => {
    requests.push({ url, init, body: init.body ? JSON.parse(init.body) : null })
    const next = responses.shift() || { body: Buffer.from('ID3audio'), type: 'audio/mpeg' }
    return new Response(next.body, { status: next.status || 200, headers: { 'content-type': next.type || 'audio/mpeg' } })
  }
  const plugins = []
  const speech = createSpeech({ store, credentials: () => credentials, plugins: () => plugins, fetchImpl })
  return { speech, files, keys, requests, plugins }
}

test('配音设置：默认浏览器朗读；开启前要填齐地址与 Key，改地址必须重填 Key', async () => {
  const { speech, keys } = harness()
  const initial = await speech.present()
  assert.equal(initial.enabled, false)
  assert.equal(initial.provider, 'browser')
  assert.deepEqual(initial.providers.map(item => item.id), ['browser', 'openai', 'gpt-sovits', 'fish', 'minimax', 'volcengine'])
  await assert.rejects(speech.save({ enabled: true, provider: 'openai' }), /还不能开启配音：请填写 API Key/)
  const saved = await speech.save({ enabled: true, provider: 'openai', config: { voice: 'nova' }, apiKey: 'sk-1' })
  assert.equal(saved.enabled, true)
  assert.equal(keys.get('DSH_TAVERN_SPEECH_OPENAI_API_KEY'), 'sk-1')
  const openai = saved.providers.find(item => item.id === 'openai')
  assert.equal(openai.hasKey, true)
  assert.equal(openai.voice, 'nova')
  assert.equal(openai.fields.find(field => field.name === 'baseUrl').value, 'https://api.openai.com/v1')
  assert.equal(JSON.stringify(saved).includes('sk-1'), false, '设置里不回传密钥')
  await assert.rejects(speech.save({ provider: 'openai', config: { baseUrl: 'https://relay.example/v1' } }), /请重新填写 API Key/)
  await assert.rejects(speech.save({ provider: 'openai', config: { baseUrl: 'ftp://x' }, apiKey: 'sk-2' }), /http/)
  assert.equal((await speech.save({ enabled: true, provider: 'browser' })).provider, 'browser')
})

test('配音合成：OpenAI 兼容接口按情绪给语气，同一句只请求一次；旁白没设声音就不念', async () => {
  const { speech, requests, files } = harness()
  await speech.save({ enabled: true, provider: 'openai', config: { voice: 'alloy', narratorVoice: '' }, apiKey: 'sk-1' })
  const first = await speech.synthesize({ text: '“欢迎回来。”', voice: 'nova', emotion: 'joy' })
  assert.match(first.id, /^[0-9a-f]{64}\.mp3$/)
  assert.equal(requests[0].url, 'https://api.openai.com/v1/audio/speech')
  assert.equal(requests[0].init.headers.authorization, 'Bearer sk-1')
  assert.deepEqual(requests[0].body, { model: 'gpt-4o-mini-tts', input: '“欢迎回来。”', voice: 'nova', response_format: 'mp3', instructions: '用开心的语气说这句话。' })
  assert.deepEqual(await speech.synthesize({ text: '“欢迎回来。”', voice: 'nova', emotion: 'joy' }), first)
  assert.equal(requests.length, 1, '同样的渠道、声音、情绪和文字读缓存')
  assert.equal((await speech.readAudio(first.id)).mediaType, 'audio/mpeg')
  assert.equal(await speech.readAudio('../x.mp3'), undefined)
  assert.ok(files.has('speech-cache/' + first.id))

  const current = await speech.active()
  assert.equal(speech.voiceFor({ character: { voices: { openai: 'onyx' } }, ...current }), 'onyx')
  assert.equal(speech.voiceFor({ character: null, ...current }), 'alloy')
  assert.equal(speech.voiceFor({ character: null, ...current, narration: true }), null, '旁白声音留空：不念')
  await speech.save({ enabled: false })
  assert.equal(await speech.active(), null)
})

test('配音合成：GPT-SoVITS 读参考音频与文字，MiniMax 解出十六进制音频并映射情绪，错误带上服务的说明', async () => {
  const { speech, requests } = harness({ responses: [
    { body: Buffer.from('RIFFwave'), type: 'audio/wav' },
    { body: JSON.stringify({ data: { audio: Buffer.from('ID3mm').toString('hex') }, base_resp: { status_code: 0 } }), type: 'application/json' },
    { body: '{"error":"bad voice"}', status: 400, type: 'application/json' }
  ] })
  await speech.save({ provider: 'gpt-sovits', config: { voice: '/data/lin.wav|今天天气真好' } })
  const wav = await speech.synthesize({ provider: 'gpt-sovits', text: '你好' })
  assert.match(wav.id, /\.wav$/)
  assert.equal(requests[0].url, 'http://127.0.0.1:9880/tts')
  assert.equal(requests[0].body.ref_audio_path, '/data/lin.wav')
  assert.equal(requests[0].body.prompt_text, '今天天气真好')

  await speech.save({ provider: 'minimax', config: { groupId: 'g1' }, apiKey: 'mm' })
  const mp3 = await speech.synthesize({ provider: 'minimax', text: '别过来！', emotion: 'fear' })
  assert.match(mp3.id, /\.mp3$/)
  assert.equal(requests[1].url, 'https://api.minimaxi.com/v1/t2a_v2?GroupId=g1')
  assert.equal(requests[1].body.voice_setting.voice_id, 'female-shaonv')
  assert.equal(requests[1].body.voice_setting.emotion, 'fearful')
  assert.equal(minimaxEmotion('grief'), 'sad')
  assert.equal(minimaxEmotion('curiosity'), 'neutral')

  await assert.rejects(speech.synthesize({ provider: 'gpt-sovits', text: '再来一句', voice: '/data/x.wav' }), /HTTP 400：\{"error":"bad voice"\}/)
  assert.deepEqual(await speech.synthesize({ provider: 'browser', text: '*她笑了* <b>好</b>', voice: 'Tingting' }), { browser: true, voice: 'Tingting', text: '她笑了 好' })
  assert.equal(speechText('# 标题\n\n> 引用'), '标题 引用')
})

test('配音合成：火山引擎按音色选资源与情绪，把逐行 JSON 里的音频块拼成一句', async () => {
  const ndjson = lines => ({ body: Buffer.from(lines.map(line => JSON.stringify(line)).join('\n') + '\n'), type: 'application/x-ndjson' })
  const { speech, requests } = harness({ responses: [
    ndjson([{ code: 0, message: '', data: Buffer.from('ID3a').toString('base64') },
      { code: 0, message: '', data: Buffer.from('b').toString('base64') },
      { code: 20000000, message: 'OK' }]),
    ndjson([{ code: 20000000, message: 'OK', data: Buffer.from('ID3c').toString('base64') }]),
    ndjson([{ code: 20000000, message: 'OK', data: Buffer.from('ID3d').toString('base64') }]),
    ndjson([{ code: 20000000, message: 'OK', data: Buffer.from('ID3e').toString('base64') }]),
    ndjson([{ code: 45000001, message: 'invalid speaker' }]),
    { body: JSON.stringify({ header: { code: 45000010, message: 'load grant: requested grant not found in SaaS storage' } }), status: 401, type: 'application/json' }
  ] })
  const saved = await speech.save({ enabled: true, provider: 'volcengine', config: { appId: 'app-1', voice: 'zh_female_vv_uranus_bigtts' }, apiKey: 'token-1' })
  assert.equal(saved.provider, 'volcengine')
  const volc = saved.providers.find(item => item.id === 'volcengine')
  assert.equal(volc.keyLabel, 'Access Token')
  assert.equal(volc.hasKey, true)
  assert.equal(volc.fields.find(field => field.name === 'appId').value, 'app-1')
  assert.equal(volc.fields.find(field => field.name === 'baseUrl').value, 'https://openspeech.bytedance.com')

  const audio = await speech.synthesize({ text: '“你回来了。”', emotion: 'joy' })
  assert.match(audio.id, /\.mp3$/)
  assert.equal(requests[0].url, 'https://openspeech.bytedance.com/api/v3/tts/unidirectional')
  assert.equal(requests[0].init.headers['x-api-app-id'], 'app-1')
  assert.equal(requests[0].init.headers['x-api-access-key'], 'token-1')
  assert.equal(requests[0].init.headers['x-api-resource-id'], 'seed-tts-2.0')
  assert.equal(requests[0].body.req_params.text, '“你回来了。”')
  assert.equal(requests[0].body.req_params.speaker, 'zh_female_vv_uranus_bigtts')
  assert.equal(requests[0].body.req_params.audio_params.format, 'mp3')
  assert.equal(requests[0].body.req_params.audio_params.emotion, 'happy', '开心映射成火山的情感枚举')
  assert.equal(requests[0].body.req_params.audio_params.emotion_scale, 4)
  assert.equal((await speech.readAudio(audio.id)).bytes.toString(), 'ID3ab', '多行音频块按顺序拼起来')

  // 1.0 的普通音色不认情绪参数；复刻音色走 ICL 资源；显式资源 ID 优先。
  const plain = await speech.synthesize({ provider: 'volcengine', text: '别过来！', emotion: 'fear', voice: 'zh_male_qingshuangnanda_mars_bigtts' })
  assert.match(plain.id, /\.mp3$/)
  assert.equal(requests[1].init.headers['x-api-resource-id'], 'seed-tts-1.0')
  assert.equal(Object.hasOwn(requests[1].body.req_params.audio_params, 'emotion'), false)
  await speech.synthesize({ provider: 'volcengine', text: '我回来了。', voice: 'icl_abc123' })
  assert.equal(requests[2].init.headers['x-api-resource-id'], 'seed-icl-2.0')
  await speech.save({ provider: 'volcengine', config: { resourceId: 'seed-tts-2.0' } })
  await speech.synthesize({ provider: 'volcengine', text: '换一个资源。', voice: 'icl_abc123' })
  assert.equal(requests[3].init.headers['x-api-resource-id'], 'seed-tts-2.0')

  assert.equal(volcengineResource('zh_female_vv_uranus_bigtts'), 'seed-tts-2.0')
  assert.equal(volcengineResource('zh_male_dayi_saturn_bigtts'), 'seed-tts-2.0')
  assert.equal(volcengineResource('zh_female_cancan_mars_bigtts'), 'seed-tts-1.0')
  assert.equal(volcengineResource('icl_replica', 'seed-icl-2.0'), 'seed-icl-2.0')
  assert.equal(volcengineEmotion('joy', 'seed-tts-2.0', 'zh_female_vv_uranus_bigtts'), 'happy')
  assert.equal(volcengineEmotion('joy', 'seed-tts-1.0', 'zh_female_cancan_mars_bigtts'), '')
  assert.equal(volcengineEmotion('joy', 'seed-tts-1.0', 'zh_female_shuangkuaisisi_emo_v2_mars_bigtts'), 'happy')
  assert.equal(volcengineEmotion('confusion', 'seed-tts-2.0', 'zh_female_vv_uranus_bigtts'), '')
  assert.equal(volcengineEmotion('__proto__', 'seed-tts-2.0', 'zh_female_vv_uranus_bigtts'), '', '原型键不算情绪')

  await assert.rejects(speech.synthesize({ provider: 'volcengine', text: '没人理我。', voice: 'zh_male_m191_uranus_bigtts' }), /火山引擎没有返回音频：invalid speaker/)
  await assert.rejects(speech.synthesize({ provider: 'volcengine', text: '再试一次。', voice: 'zh_male_taocheng_uranus_bigtts' }),
    /HTTP 401：load grant: requested grant not found in SaaS storage/, '鉴权失败时带上服务的说明')
})

test('插件配音渠道：出现在设置里，合成交给插件，结果同样缓存', async () => {
  const { speech, plugins } = harness()
  const calls = []
  plugins.push({ id: 'edge-tts/edge', owner: 'edge-tts', label: 'Edge 朗读', voices: ['zh-CN-XiaoxiaoNeural'], defaultVoice: 'zh-CN-XiaoxiaoNeural',
    synthesize: async input => { calls.push(input); return { data: new Uint8Array([1, 2, 3]), mediaType: 'audio/mpeg' } } })
  const listed = (await speech.present()).providers.find(item => item.id === 'edge-tts/edge')
  assert.equal(listed.owner, 'edge-tts')
  assert.equal(listed.voice, 'zh-CN-XiaoxiaoNeural')
  await speech.save({ enabled: true, provider: 'edge-tts/edge' })
  const audio = await speech.synthesize({ text: '你好', emotion: 'joy' })
  await speech.synthesize({ text: '你好', emotion: 'joy' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].voice, 'zh-CN-XiaoxiaoNeural')
  assert.equal(calls[0].emotion, 'joy')
  assert.match(audio.id, /\.mp3$/)
  plugins.length = 0
  assert.equal(await speech.active(), null, '插件卸载后渠道不可用')
  await assert.rejects(speech.synthesize({ provider: 'edge-tts/edge', text: '你好' }), /没有这个配音渠道/)
})

// Fish 协议 (cast-presentation.md 21/N): routes answered like a Fish-compatible server; /v1/info is optional.
// The MessagePack forms fishMessagePack writes (32-bit str / bin / array / map), read back.
function unpack(bytes) {
  let at = 0
  const length = () => { const value = bytes.readUInt32BE(at + 1); at += 5; return value }
  const next = () => {
    const tag = bytes[at], size = length()
    if (tag === 0xdb || tag === 0xc6) { const slice = bytes.subarray(at, at + size); at += size; return tag === 0xdb ? slice.toString('utf8') : Buffer.from(slice) }
    if (tag === 0xdd) return Array.from({ length: size }, next)
    if (tag === 0xdf) return Object.fromEntries(Array.from({ length: size }, () => [next(), next()]))
    throw new Error('unexpected tag ' + tag)
  }
  const value = next()
  assert.equal(at, bytes.length)
  return value
}

function fishHarness({ info } = {}) {
  const h = harness(), requests = []
  const fetchImpl = async (url, init) => {
    const path = new URL(url).pathname
    requests.push({ url, path, headers: init.headers || {}, body: !init.body ? null : typeof init.body === 'string' ? JSON.parse(init.body) : unpack(init.body) })
    if (path === '/v1/info') return info === undefined ? new Response('not found', { status: 404 }) : new Response(JSON.stringify(info), { headers: { 'content-type': 'application/json' } })
    if (path === '/v1/warm') return new Response('', { status: 200 })
    return new Response(Buffer.from('RIFFfish'), { headers: { 'content-type': 'audio/wav' } })
  }
  const credentials = { async resolve(ref) { return h.keys.has(ref) ? { value: h.keys.get(ref) } : undefined }, async set(ref, value) { h.keys.set(ref, value) } }
  const speech = createSpeech({ store: { readJson: async path => h.files.has(path) ? JSON.parse(h.files.get(path)) : undefined, writeJson: async (path, value) => { h.files.set(path, JSON.stringify(value)) },
    writeBytes: async (path, data) => { h.files.set(path, Buffer.from(data)) }, readBytes: async path => h.files.get(path), size: async path => h.files.has(path) ? h.files.get(path).length : 0 },
  credentials: () => credentials, fetchImpl })
  return { speech, requests, keys: h.keys }
}

test('Fish 协议：Key 只发给保存它的地址；服务没有 /v1/info 时照常合成、不预热', async () => {
  const { speech, requests, keys } = fishHarness()
  await speech.save({ enabled: true, provider: 'fish', config: { voice: 'cloud-voice', model: 's1' }, apiKey: 'fk-1' })
  assert.equal(keys.get('DSH_TAVERN_SPEECH_FISH_API_KEY'), 'fk-1')
  assert.deepEqual(await speech.serviceInfo({ provider: 'fish' }), { models: [] }, '404：服务不列模型')
  await speech.synthesize({ text: '你好' })
  assert.equal(requests.at(-1).url, 'https://api.fish.audio/v1/tts')
  assert.equal(requests.at(-1).headers.authorization, 'Bearer fk-1')
  assert.equal(await speech.prepare({ voice: 'cloud-voice' }), false, '没有声明 prepareVoice 就不预热')
  assert.equal(requests.some(item => item.path === '/v1/warm'), false)
  // A new address keeps working without the old key; it is never sent there.
  const moved = await speech.save({ provider: 'fish', config: { baseUrl: 'http://127.0.0.1:9000' } })
  assert.equal(moved.providers.find(item => item.id === 'fish').hasKey, false)
  await speech.synthesize({ text: '换了地址' })
  assert.equal(requests.at(-1).url, 'http://127.0.0.1:9000/v1/tts')
  assert.equal(Object.hasOwn(requests.at(-1).headers, 'authorization'), false, '旧密钥不发到新地址')
})

test('Fish 协议：服务声明 prepareVoice 才调 /v1/warm；配音关着什么都不请求', async () => {
  const { speech, requests } = fishHarness({ info: { models: [{ id: 'model-a' }], capabilities: { prepareVoice: true } } })
  await speech.save({ provider: 'fish', config: { baseUrl: 'http://127.0.0.1:8080', voice: 'ref-lin' } })
  assert.equal(await speech.prepare({ voice: 'ref-lin' }), false, '配音关着')
  assert.equal(requests.length, 0)
  await speech.save({ enabled: true, provider: 'fish' })
  assert.equal(await speech.prepare({ voice: 'ref-lin' }), true)
  const warm = requests.find(item => item.path === '/v1/warm')
  assert.deepEqual([warm.headers.model, warm.body, Object.hasOwn(warm.headers, 'authorization')], ['model-a', { reference_id: 'ref-lin' }, false])
  await speech.save({ enabled: true, provider: 'openai', config: { voice: 'alloy' }, apiKey: 'sk-1' })
  assert.equal(await speech.prepare({ voice: 'alloy' }), false, '别的渠道没有预热')
})
// 随卡参考音频 (cast-presentation.md 22/N): a character whose 配音来源 is Fish's clone is voiced by its clips, sent inline.
test('Fish 协议：配音来源是声音克隆时把参考音频和原文内联发送（MessagePack），参考音频进缓存键；选别的来源时不用参考音频', async () => {
  const { speech, requests } = fishHarness({ info: { models: [{ id: 'model-a' }], capabilities: { prepareVoice: true } } })
  const saved = await speech.save({ enabled: true, provider: 'fish', config: { baseUrl: 'http://127.0.0.1:8080', voice: 'ref-default' } })
  assert.equal(saved.providers.find(item => item.id === 'fish').references, true)
  assert.equal(saved.providers.find(item => item.id === 'openai').references, undefined)
  const clips = new Map([['a'.repeat(32) + '.wav', Buffer.from('RIFF0000WAVEone')], ['b'.repeat(32) + '.mp3', Buffer.from('ID3two')]])
  const readReference = async file => clips.get(file)
  const character = { name: '林曦', voices: {}, voiceSource: { provider: 'fish', clone: true }, voiceReferences: [{ file: 'a'.repeat(32) + '.wav', text: '今天天气真好。' }, { file: 'b'.repeat(32) + '.mp3', text: '走吧。' }] }
  const current = await speech.active()
  const references = speech.referencesFor({ character, provider: current.provider })
  assert.equal(references.length, 2)
  assert.deepEqual(speech.referencesFor({ character, provider: current.provider, narration: true }), [], '旁白不用人物的参考音频')
  assert.equal(speech.referencesFor({ character: { ...character, voices: { fish: 'ref-lin' } }, provider: current.provider }).length, 2, '选了声音克隆，填了 ID 也用参考音频')
  assert.deepEqual(speech.referencesFor({ character: { ...character, voiceSource: { provider: 'fish' } }, provider: current.provider }), [], '选了 Fish 的声音 ID，有参考音频也用声音')
  assert.deepEqual(speech.referencesFor({ character: { ...character, voiceSource: null }, provider: current.provider }), [], '没选：配音设置里的渠道和声音')
  assert.throws(() => speech.referencesFor({ character: { ...character, voiceReferences: undefined }, provider: current.provider }),
    /「林曦」的配音来源是「Fish 协议 · 声音克隆（参考音频）」，还没有参考音频：请在「舞台素材」里为它上传参考音频/, '没有参考音频：报可修复的错，不悄悄改用声音')

  const first = await speech.synthesize({ text: '“你好。”', voice: speech.voiceFor({ character, ...current }), references, readReference })
  const tts = requests.at(-1)
  assert.equal(tts.path, '/v1/tts')
  assert.equal(tts.headers['content-type'], 'application/msgpack')
  assert.equal(tts.headers.model, 'model-a')
  assert.equal(Object.hasOwn(tts.headers, 'authorization'), false)
  assert.deepEqual(tts.body, { text: '“你好。”', references: [{ audio: clips.get('a'.repeat(32) + '.wav'), text: '今天天气真好。' }, { audio: clips.get('b'.repeat(32) + '.mp3'), text: '走吧。' }], format: 'wav' })
  assert.equal(Object.hasOwn(tts.body, 'reference_id'), false, '内联参考时不带 reference_id')
  const count = requests.length
  assert.deepEqual(await speech.synthesize({ text: '“你好。”', voice: 'ref-default', references, readReference }), first, '同样的参考音频读缓存')
  assert.equal(requests.length, count)
  const plain = await speech.synthesize({ text: '“你好。”', voice: 'ref-default' })
  assert.notEqual(plain.id, first.id, '用默认声音的同一句是另一份缓存')
  assert.deepEqual(requests.at(-1).body, { text: '“你好。”', reference_id: 'ref-default', format: 'wav' })
  const retold = await speech.synthesize({ text: '“你好。”', references: [{ ...references[0], text: '今天天气不错。' }, references[1]], readReference })
  assert.notEqual(retold.id, first.id, '原文改了就重新合成')
  const fewer = await speech.synthesize({ text: '“你好。”', references: references.slice(0, 1), readReference })
  assert.notEqual(fewer.id, first.id, '少一段就重新合成')
  await assert.rejects(speech.synthesize({ text: '缺文件', references: [{ file: 'c'.repeat(32) + '.wav', text: 'x' }], readReference }), /参考音频不存在/)

  await speech.save({ enabled: true, provider: 'openai', config: { voice: 'alloy' }, apiKey: 'sk-1' })
  const openai = await speech.active()
  assert.deepEqual(speech.referencesFor({ character, provider: openai.provider }), [], '别的渠道不用这个人物的参考音频')
})

test('配音来源：人物在配好的渠道里选一个，台词就走那个渠道；没选的走配音设置里的渠道；选的渠道不在时报错', async () => {
  const { speech, requests } = fishHarness()
  const unsaved = await speech.present()
  assert.deepEqual(unsaved.providers.filter(item => item.configured).map(item => item.id), ['browser'], '没保存过的渠道不算配好')
  await speech.save({ provider: 'gpt-sovits', config: { baseUrl: 'http://127.0.0.1:9880', voice: '/data/default.wav' } })
  await speech.save({ provider: 'openai', config: { voice: 'alloy' } })
  const saved = await speech.save({ enabled: true, provider: 'fish', config: { baseUrl: 'http://127.0.0.1:8080', voice: 'ref-default' } })
  assert.deepEqual(saved.providers.filter(item => item.configured).map(item => item.id), ['browser', 'gpt-sovits', 'fish'], 'OpenAI 缺 Key：不算配好')
  const current = await speech.active()
  assert.equal(await speech.channelFor({ character: { name: '林曦', voices: {} }, current }), current)
  const sovits = await speech.channelFor({ character: { name: '林曦', voices: { 'gpt-sovits': '/data/lin.wav' }, voiceSource: { provider: 'gpt-sovits' } }, current })
  assert.equal(sovits.provider.id, 'gpt-sovits')
  assert.equal(speech.voiceFor({ character: { voices: { 'gpt-sovits': '/data/lin.wav' } }, ...sovits }), '/data/lin.wav')
  await speech.synthesize({ provider: sovits.provider.id, text: '你好', voice: '/data/lin.wav' })
  assert.equal(requests.at(-1).url, 'http://127.0.0.1:9880/tts', '用人物选的渠道和它保存的地址')
  const keyless = await speech.channelFor({ character: { name: '林曦', voiceSource: { provider: 'openai' } }, current })
  await assert.rejects(speech.synthesize({ provider: keyless.provider.id, text: '你好', voice: 'alloy' }), /配音设置不完整：请填写 API Key/, '选的渠道没配好：报错，不改用别的')
  await assert.rejects(speech.channelFor({ character: { name: '林曦', voiceSource: { provider: 'edge-tts/edge' } }, current }), /没有这个配音渠道/)
})


test('朗读内容经 RPC 保存，省略时保留，重建服务后仍能读回；旧设置默认全文', async () => {
  const {speech,files,keys} = harness()
  files.set('speech/config.json', JSON.stringify({enabled:true,provider:'browser',providers:{}}))
  assert.equal((await speech.present()).readMode, 'full')
  const handlers = createMediaHandlers({speech})
  assert.equal((await handlers.updateSpeechSettings({readMode:'dialogue'})).readMode, 'dialogue')
  assert.equal((await speech.save({enabled:false})).readMode, 'dialogue')
  const restored = createSpeech({
    store: { readJson: async path => JSON.parse(files.get(path)) },
    credentials: () => ({ resolve: async ref => ({ value: keys.get(ref) }) })
  })
  assert.equal((await restored.present()).readMode, 'dialogue')
  await assert.rejects(handlers.updateSpeechSettings({readMode:'invalid'}), /请选择朗读/)
  assert.equal((await speech.present()).readMode, 'dialogue')
  assert.equal((await handlers.updateSpeechSettings({readMode:'full'})).readMode, 'full')
})
