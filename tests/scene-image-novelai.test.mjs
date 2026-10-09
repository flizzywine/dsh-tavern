import test from 'node:test'
import assert from 'node:assert/strict'

import { generateSceneImage } from '../tavern-plugin/lib/domain/scene-image-provider.js'
import { channelSettings, imageChannelRequest } from '../tavern-plugin/lib/domain/scene-image-channels.js'
import { novelaiPrompts } from '../tavern-plugin/lib/domain/scene-image-novelai.js'

import { imageZip } from './fixtures/scene-image-zip.mjs'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')
const input = { provider: 'novelai', apiKey: 'fixture-secret', prompt: 'ignored flattened copy' }
const plan = {
  id: 'plan', profile: 'nai-test', people: [{ id: 'a', name: '林', fields: { clothing: { text: 'stale red coat' } } }, { id: 'b', name: '林' }],
  blocks: [
    { owner: 'a', field: 'appearance', tags: 'girl, black hair', text: '黑发' },
    { owner: 'a', field: 'clothing', tags: 'blue coat', text: '蓝衣' },
    { owner: 'a', field: 'position', tags: 'on the left', text: '左侧' },
    { owner: 'b', field: 'appearance', tags: 'boy, silver hair', text: '银发' },
    { owner: 'b', field: 'action', tags: 'sitting', text: '坐下' },
    { owner: 'scene', field: 'composition', tags: '1girl, 1boy, wide shot', text: '双人远景' },
    { owner: 'scene', field: 'environment', tags: 'rainy station', text: '雨中车站' }
  ], style: { tags: 'watercolor' }, prompt: 'unstructured duplicate'
}

test('NovelAI validates size/model and model-specific people limit before any request; repaint uses fresh seeds', () => {
  const original = imageChannelRequest({ ...input, plan })
  const repaint = imageChannelRequest({ ...input, plan })
  assert.ok(Number.isInteger(original.body.parameters.seed) && original.body.parameters.seed >= 0 && original.body.parameters.seed < 2 ** 32)
  // More than one sample avoids depending on a single random collision.
  const seeds = new Set([original.body.parameters.seed, repaint.body.parameters.seed, imageChannelRequest({ ...input, plan }).body.parameters.seed])
  assert.ok(seeds.size > 1)
  const many = { people: Array.from({ length: 7 }, (_, n) => ({ id: String(n) })), blocks: Array.from({ length: 7 }, (_, n) => ({ owner: String(n), tags: 'person ' + n })) }
  assert.throws(() => imageChannelRequest({ ...input, model: 'nai-diffusion-4-5-full', plan: many }), /最多支持 6 人/)
  assert.equal(imageChannelRequest({ ...input, plan: many }).body.parameters.v4_prompt.caption.char_captions.length, 7)
  assert.equal(imageChannelRequest({ ...input, model: 'nai-diffusion-4-5-curated', plan }).body.parameters.scale, 5)
  assert.equal(imageChannelRequest({ ...input, model: 'nai-diffusion-4-full', plan }).body.parameters.scale, 5.5)
  const v3 = imageChannelRequest({ ...input, model: 'nai-diffusion-3', plan }).body
  assert.equal(v3.parameters.v4_prompt, undefined); assert.equal(v3.parameters.sm, false)
  assert.equal(v3.input.split('black hair').length - 1, 1)
  assert.match(v3.input, /silver hair/)
  for (const size of ['100x100', '0x1024', '4096x4096', '2048x2048', 'large']) assert.throws(() => channelSettings({ ...input, size }), /尺寸|面积/)
  assert.throws(() => channelSettings({ ...input, model: 'unknown' }), /模型/)
  assert.throws(() => imageChannelRequest({ ...input, prompt: '' }), /提示词/)
  assert.throws(() => novelaiPrompts({ plan: { people: [], blocks: [{ owner: 'unknown', tags: 'extra' }] } }), /未知/)
})

test('NovelAI rejects HTML/JSON masquerading as ZIP, corrupt images and oversized responses without paid retries', async () => {
  for (const bytes of [Buffer.from('{"message":"fixture-secret"}'), imageZip(Buffer.from('<svg/>'))]) {
    let count = 0
    await assert.rejects(generateSceneImage(input, { fetch: async () => { count++; return new Response(bytes) } }), error => !error.message.includes('fixture-secret') && /ZIP|图片格式/.test(error.message))
    assert.equal(count, 1)
  }
  await assert.rejects(generateSceneImage(input, { fetch: async () => new Response('<!doctype html><title>fixture-secret</title>') }),
    error => /网页.*接口格式.*对话格式/.test(error.message) && error.imageOutcome === 'rejected' && !error.message.includes('fixture-secret'))
  await assert.rejects(generateSceneImage(input, { fetch: async () => new Response('fixture-secret', { status: 401 }) }), error => error.message.includes('401') && !error.message.includes('fixture-secret'))
  await assert.rejects(generateSceneImage({ ...input, maxBytes: 8 }, { fetch: async () => new Response(imageZip(png)) }), /ZIP|限制/)
  await assert.rejects(generateSceneImage(input, { fetch: async () => new Response('', { headers: { 'content-length': String(1e9) } }) }), /过大/)
})

test('NovelAI prompt controls: untouched settings keep the old caption; sections, weights and presets apply when set', () => {
  const v45 = { model: 'nai-diffusion-4-5-full', size: '832x1216' }
  assert.equal(novelaiPrompts({ plan }, v45).base, '1girl, 1boy, wide shot, rainy station, watercolor')
  const ordered = novelaiPrompts({ plan }, { ...v45, qualityTags: 'masterpiece', artists: [{ id: 'a', name: 'wlop', prompt: 'artist:wlop' }], activeArtist: 'a', promptOrder: 'artist,scene,style,quality' }).base
  assert.equal(ordered, 'artist:wlop, 1girl, 1boy, wide shot, rainy station, watercolor, masterpiece')
  // V4+ take numeric weights, so 1.5 and 3 stay distinct; V3 only has brace emphasis.
  const weighted = weights => novelaiPrompts({ plan }, { ...v45, qualityTags: 'masterpiece', sectionWeights: weights }).base
  assert.equal(weighted('1.5,1,1,1'), '1.5::masterpiece::, 1girl, 1boy, wide shot, rainy station, watercolor')
  assert.equal(weighted('3,1,0.75,1'), '3::masterpiece::, 1girl, 1boy, wide shot, rainy station, 0.75::watercolor::')
  const v3 = novelaiPrompts({ plan }, { model: 'nai-diffusion-3', size: '832x1216', qualityTags: 'masterpiece', sectionWeights: '3,1,0.75' }).base
  assert.equal(v3, '{{masterpiece}}, 1girl, 1boy, wide shot, rainy station, {watercolor}')
  // Official presets are opt-in and dedupe against hand-written tags.
  const preset = novelaiPrompts({ plan }, { ...v45, qualityTags: 'masterpiece', qualityPreset: 'standard' }).base
  assert.equal(preset, 'masterpiece, very aesthetic, no text, 1girl, 1boy, wide shot, rainy station, watercolor')
})

test('NovelAI fixed seed, official negative preset and setting validation', () => {
  const settings = { model: 'nai-diffusion-4-5-full', size: '832x1216', seed: '42', ucPreset: 'light', negativePrompt: 'lowres, extra hands' }
  const first = imageChannelRequest({ ...input, ...settings, plan }), second = imageChannelRequest({ ...input, ...settings, plan })
  assert.equal(first.body.parameters.seed, 42)
  assert.equal(second.body.parameters.seed, 42)
  assert.match(first.body.parameters.negative_prompt, /^lowres, extra hands, artistic error/)
  assert.equal(first.body.parameters.negative_prompt.match(/lowres/g).length, 1)
  assert.equal(first.body.parameters.ucPreset, 1)
  const untouched = imageChannelRequest({ ...input, model: 'nai-diffusion-4-5-full', size: '832x1216', plan })
  assert.equal(untouched.body.action, 'generate')
  for (const key of ['ucPreset', 'qualityToggle', 'image']) assert.ok(!(key in untouched.body.parameters), key)
  const novelai = extra => channelSettings({ provider: 'novelai', baseURL: 'https://image.novelai.net', model: 'nai-diffusion-4-5-full', size: '832x1216', ...extra })
  assert.throws(() => novelai({ promptOrder: 'quality,scene' }), /完整排列/)
  assert.throws(() => novelai({ sectionWeights: '1,-1' }), /正数/)
  assert.throws(() => novelai({ seed: '4294967296' }), /种子/)
  assert.throws(() => novelai({ sampler: 'ddim_v3', model: 'nai-diffusion-5-full' }), /DDIM/)
  assert.throws(() => novelai({ cfgRescale: '2' }), /CFG Rescale/)
  assert.throws(() => novelai({ endpoint: 'missing' }), /接入点不存在/)
  assert.throws(() => novelai({ qualityPreset: 'max' }), /质量词预设/)
})

test('NovelAI artist library: the selected entry supplies artist, quality and negative tags; older free-text settings migrate', () => {
  const base = { provider: 'novelai', baseURL: 'https://image.novelai.net', model: 'nai-diffusion-4-5-full', size: '832x1216', qualityTags: 'channel quality', negativePrompt: 'channel negative' }
  const artists = [{ id: 'a', name: '水彩', prompt: 'artist:wlop', quality: 'very aesthetic', negative: 'lowres' }, { id: 'b', name: '只换画师', prompt: 'artist:ciloranko' }]
  const request = config => imageChannelRequest({ ...input, ...config, plan }).body
  const chosen = request({ ...base, artists, activeArtist: 'a' })
  assert.equal(chosen.parameters.v4_prompt.caption.base_caption, 'very aesthetic, 1girl, 1boy, wide shot, rainy station, watercolor, artist:wlop')
  assert.equal(chosen.parameters.negative_prompt, 'lowres')
  // Empty entry fields fall back to the channel-level tags; no selection uses no artist.
  const partial = request({ ...base, artists, activeArtist: 'b' })
  assert.equal(partial.parameters.v4_prompt.caption.base_caption, 'channel quality, 1girl, 1boy, wide shot, rainy station, watercolor, artist:ciloranko')
  assert.equal(partial.parameters.negative_prompt, 'channel negative')
  assert.equal(request({ ...base, artists, activeArtist: '' }).parameters.v4_prompt.caption.base_caption, 'channel quality, 1girl, 1boy, wide shot, rainy station, watercolor')
  // A deleted selection is cleared rather than failing generation.
  assert.equal(channelSettings({ ...base, artists, activeArtist: 'gone' }).activeArtist, '')
  const migrated = channelSettings({ ...base, artistString: 'artist:old', promptPresets: JSON.stringify({ 日常: { artistString: 'artist:day', qualityTags: 'masterpiece' } }) })
  assert.deepEqual(migrated.artists.map(({ name, prompt, quality }) => ({ name, prompt, quality })), [{ name: '日常', prompt: 'artist:day', quality: 'masterpiece' }, { name: '我的画师串', prompt: 'artist:old', quality: '' }])
  assert.equal(migrated.activeArtist, 'legacy')
  assert.throws(() => channelSettings({ ...base, artists: [{ id: 'A!', name: 'x' }] }), /画师串库格式/)
  assert.throws(() => channelSettings({ ...base, artists: Array.from({ length: 51 }, (_, index) => ({ id: 'a' + index })) }), /最多 50/)
})

test('NovelAI sampling controls: defaults keep the previous payload; sampler, schedule, CFG rescale and Variety Boost apply when set', () => {
  const base = { model: 'nai-diffusion-4-5-full', size: '832x1216' }
  const parameters = config => imageChannelRequest({ ...input, ...config, plan }).body.parameters
  const untouched = parameters(base)
  assert.equal(untouched.sampler, 'k_euler_ancestral')
  assert.equal(untouched.noise_schedule, 'karras')
  assert.equal(untouched.cfg_rescale, 0)
  assert.equal(untouched.prefer_brownian, true)
  assert.ok(!('skip_cfg_above_sigma' in untouched))
  const tuned = parameters({ ...base, sampler: 'k_dpmpp_2m', noiseSchedule: 'exponential', cfgRescale: '0.2', varietyBoost: 'true' })
  assert.equal(tuned.sampler, 'k_dpmpp_2m')
  assert.equal(tuned.noise_schedule, 'exponential')
  assert.equal(tuned.cfg_rescale, 0.2)
  assert.ok(!('prefer_brownian' in tuned) && !('deliberate_euler_ancestral_bug' in tuned))
  assert.ok(Math.abs(tuned.skip_cfg_above_sigma - Math.sqrt(832 * 1216 / 1011712) * 58) < 1e-9)
  assert.ok(Math.abs(parameters({ ...base, model: 'nai-diffusion-4-full', varietyBoost: 'true' }).skip_cfg_above_sigma - Math.sqrt(832 * 1216 / 1011712) * 19) < 1e-9)
  assert.ok(!('skip_cfg_above_sigma' in parameters({ ...base, model: 'nai-diffusion-5-full', varietyBoost: 'true' })))
})

test('NovelAI busy (429) waits and resends; other failures and aborts do not retry', async () => {
  const busy = () => new Response('{"message":"Concurrent generation is locked"}', { status: 429 })
  let count = 0
  const result = await generateSceneImage(input, { retryBaseMs: 1, fetch: async () => ++count < 3 ? busy() : new Response(imageZip(png)) })
  assert.equal(count, 3)
  assert.deepEqual(result.data, png)
  count = 0
  await assert.rejects(generateSceneImage(input, { retryBaseMs: 1, fetch: async () => { count++; return busy() } }), /429/)
  assert.equal(count, 4)
  count = 0
  await assert.rejects(generateSceneImage(input, { retryBaseMs: 1, fetch: async () => { count++; return new Response('', { status: 503 }) } }), /503/)
  assert.equal(count, 1)
  const controller = new AbortController()
  count = 0
  const pending = generateSceneImage({ ...input, signal: controller.signal }, { retryBaseMs: 60000, fetch: async () => { count++; return busy() } })
  setTimeout(() => controller.abort(new Error('cancelled')), 20)
  await assert.rejects(pending, /cancelled/)
  assert.equal(count, 1)
})

test('a picture turns the configured size to its own orientation and adds its own negative tags', async () => {
  const novelai = { ...input, model: 'nai-diffusion-4-5-full', size: '832x1216', negativePrompt: 'lowres' }
  const request = extra => imageChannelRequest({ ...novelai, ...extra }).body.parameters
  const landscape = request({ plan: { ...plan, orientation: 'landscape', negative: 'hat, lowres' } })
  assert.deepEqual([landscape.width, landscape.height], [1216, 832])
  assert.equal(landscape.negative_prompt, 'lowres, hat')
  const portrait = request({ plan: { ...plan, orientation: 'portrait' } })
  assert.deepEqual([portrait.width, portrait.height], [832, 1216])
  const fixed = request({ plan: { ...plan, orientation: 'landscape' }, style: { preset: 'default', custom: '', orientation: 'fixed' } })
  assert.deepEqual([fixed.width, fixed.height], [832, 1216])
  const gemini = imageChannelRequest({ provider: 'gemini', apiKey: 'k', prompt: 'p', model: 'gemini-3.1-flash-image', size: '1K', aspectRatio: '3:4', plan: { orientation: 'landscape' } }).body
  assert.equal(gemini.response_format.aspect_ratio, '4:3')
  assert.equal(imageChannelRequest({ provider: 'gemini', apiKey: 'k', prompt: 'p', model: 'gemini-3.1-flash-image', size: '1K', aspectRatio: '1:1', plan: { orientation: 'landscape' } }).body.response_format.aspect_ratio, '1:1')
  const webui = imageChannelRequest({ provider: 'webui', baseURL: 'http://127.0.0.1:7860', authType: 'none', prompt: 'p', size: '512x768', negativePrompt: 'blurry', plan: { orientation: 'landscape', negative: 'text' } }).body
  assert.deepEqual([webui.width, webui.height, webui.negative_prompt], [768, 512, 'blurry, text'])
  const qwen = imageChannelRequest({ provider: 'qwen', apiKey: 'k', prompt: 'p', model: 'qwen-image-3.0', size: '1328*1024', plan: { orientation: 'portrait', negative: 'text' } }).body.parameters
  assert.deepEqual([qwen.size, qwen.negative_prompt], ['1024*1328', 'text'])
})

test('NovelAI chat-protocol endpoints (Nai2API style) send the field template and read the picture link', async () => {
  const endpoints = [{ id: 'relay', name: '自定义渠道', baseURL: 'https://relay.example', protocol: 'chat' }]
  const config = { ...input, model: 'nai-diffusion-4-5-full', size: '832x1216', baseURL: 'https://relay.example', endpoint: 'relay', endpoints, sampler: 'k_euler', guidance: '6', negativePrompt: 'lowres',
    artists: [{ id: 'a1', name: '画师', prompt: 'artist:foo' }], activeArtist: 'a1' }
  const request = imageChannelRequest({ ...config, plan })
  assert.equal(request.url, 'https://relay.example/v1/chat/completions')
  assert.equal(request.body.model, 'nai-diffusion-4-5-full:k_euler')
  const lines = request.body.messages[0].content.split('\n')
  assert.deepEqual(lines.map(line => line.split(':')[0]), ['提示词', '画师串', '尺寸', '提示词引导值', '缩放引导值', '负面提示词', '采样器'])
  assert.equal(lines[1], '画师串:artist:foo')
  assert.equal(lines[2], '尺寸:竖图')
  assert.match(lines[0], /girl, black hair/)
  assert.doesNotMatch(lines[0], /artist:foo/)
  assert.equal(request.body.nai.size, '竖图')
  assert.equal(request.body.nai.scale, 6)
  assert.equal(imageChannelRequest({ ...config, baseURL: 'https://relay.example/v1', endpoints: [{ ...endpoints[0], baseURL: 'https://relay.example/v1' }], plan }).url, 'https://relay.example/v1/chat/completions')
  const calls = []
  const result = await generateSceneImage({ ...config, plan, prompt: 'x' }, {
    validateDownload: async url => url,
    fetch: async (url, init) => {
      calls.push(url)
      if (url.endsWith('/chat/completions')) return new Response(JSON.stringify({ choices: [{ message: { content: '生成完成 ![image](https://relay.example/files/a.png)' } }] }))
      return new Response(png, { headers: { 'content-type': 'image/png' } })
    } })
  assert.equal(result.mediaType, 'image/png')
  assert.deepEqual(calls, ['https://relay.example/v1/chat/completions', 'https://relay.example/files/a.png'])
  await assert.rejects(generateSceneImage({ ...config, plan, prompt: 'x' }, { fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: '余额不足' } }] })) }), /该接口没有返回图片链接：余额不足/)
  assert.throws(() => imageChannelRequest({ ...config, endpoints: [{ ...endpoints[0], protocol: 'other' }], plan }), /接口格式/)
})
