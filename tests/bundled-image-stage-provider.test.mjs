import assert from 'node:assert/strict'
import test from 'node:test'
import { stageImageProvider } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'
import { generateImage } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const channel = (provider, extra = {}) => ({ id: 'c1', provider, name: provider, baseUrl: 'https://image.example/v1', model: 'gpt-image-2', authMode: 'bearer', apiKey: 'k', options: {}, ...extra })
const config = (ch, extra = {}) => ({ imageBackend: ch.provider, imageChannels: [ch], activeImageChannel: ch.id, maxImageBytes: 1024 * 1024, ...extra })

test('素材出图：状态按当前渠道报告参考图上限，ComfyUI 与未配渠道说明原因', () => {
  assert.deepEqual(stageImageProvider(() => config(channel('openai'))).status(), { ready: true, model: 'gpt-image-2', maxReferences: 4 })
  assert.equal(stageImageProvider(() => config(channel('grok'))).status().maxReferences, 1)
  assert.equal(stageImageProvider(() => config(channel('novelai'))).status().maxReferences, 0)
  const comfy = stageImageProvider(() => config(channel('openai'), { imageBackend: 'comfyui' })).status()
  assert.equal(comfy.ready, false)
  assert.match(comfy.reason, /ComfyUI/)
  assert.equal(stageImageProvider(() => ({ imageBackend: 'openai', imageChannels: [] })).status().ready, false)
})

test('素材出图：按请求尺寸、透明背景出图，参考图原样交给渠道', async () => {
  let seen
  const provider = stageImageProvider(() => config(channel('openai', { options: { size: '1024x1024', quality: 'low' } })), async (ch, request) => {
    seen = { ch, request }
    return { bytes: Buffer.from('png'), mediaType: 'image/png' }
  })
  const reference = { data: Buffer.from('ref'), mediaType: 'image/png' }
  const result = await provider.generate({ prompt: 'sprite', references: [reference], width: 1024, height: 1536, background: 'transparent', quality: 'high' })
  assert.deepEqual(result, { data: Buffer.from('png'), mediaType: 'image/png' })
  assert.equal(seen.request.exactSize, true)
  assert.deepEqual(seen.request.references, [reference])
  assert.equal(seen.request.positive, 'sprite')
})

test('OpenAI 渠道：素材请求压过渠道自带的尺寸与质量，并带透明背景', async () => {
  let body
  const fetchImpl = async (_url, init) => {
    body = init.body
    return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), { headers: { 'content-type': 'application/json' } })
  }
  const ch = channel('openai', { options: { size: '1024x1024', quality: 'low' } })
  await generateImage(ch, { positive: 'p', width: 1024, height: 1536, exactSize: true, background: 'transparent', quality: 'high' }, { fetchImpl })
  const json = JSON.parse(body)
  assert.equal(json.size, '1024x1536')
  assert.equal(json.quality, 'high')
  assert.equal(json.background, 'transparent')
  assert.equal(json.output_format, 'png')
  await generateImage(ch, { positive: 'p', width: 1024, height: 1536, exactSize: true, background: 'transparent', references: [{ data: PNG, mediaType: 'image/png' }] }, { fetchImpl })
  assert.equal(body.get('background'), 'transparent')
  assert.equal(body.get('size'), '1024x1536')
})
