import assert from 'node:assert/strict'
import test from 'node:test'
import { createSpeech, minimaxEmotion, speechText } from '../tavern-plugin/lib/domain/speech.js'

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
  assert.deepEqual(initial.providers.map(item => item.id), ['browser', 'openai', 'gpt-sovits', 'minimax'])
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
