import test from 'node:test'
import assert from 'node:assert/strict'

import { generateSceneImage } from '../tavern-plugin/lib/domain/scene-image-provider.js'
import { channelSettings, channelImageResult, imageChannelRequest, imageExpressionProfile } from '../tavern-plugin/lib/domain/scene-image-channels.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aKfoAAAAASUVORK5CYII=', 'base64')

test('response extraction ignores prose/thoughts, tolerates malformed responses and rejects unsupported config', () => {
  assert.equal(channelImageResult('gemini', { steps: [{ type: 'thought', content: [{ type: 'image', data: 'x' }] }] }), undefined)
  assert.equal(channelImageResult('gemini', { output_image: { data: 'abc' } }).b64_json, 'abc')
  assert.equal(channelImageResult('qwen', { output: { choices: [{ message: { content: 'text' } }] } }), undefined)
  assert.equal(channelImageResult('banana', { choices: [{ message: { content: 'Please open https://example.com' } }] }), undefined)
  assert.deepEqual(channelImageResult('banana', { choices: [{ message: { images: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] } }] }), { url: 'https://example.com/a.png' })
  assert.throws(() => channelImageResult('qwen', { code: 'failed', message: 'secret' }), error => !error.message.includes('secret'))
  assert.throws(() => channelSettings({}, 'unknown'))
  assert.throws(() => imageChannelRequest({ provider: 'grok', size: '1024x1024', apiKey: 'key' }), /分辨率/)
  assert.throws(() => imageChannelRequest({ provider: 'qwen', model: 'wanx', apiKey: 'key' }), /Qwen/)
  assert.throws(() => imageChannelRequest({ provider: 'banana', apiKey: 'key' }), /配置/)
  assert.notEqual(imageExpressionProfile({ provider: 'openai', model: 'same' }), imageExpressionProfile({ provider: 'banana', model: 'same' }))
})

test('WebUI sends one image request, keeps the server model and handles raw base64 results', async () => {
  for (const authType of ['none', 'basic', 'bearer']) {
    let calls = 0
    const result = await generateSceneImage({ provider: 'webui', baseURL: 'http://localhost:7860/prefix', size: '768x512', prompt: 'window scene', authType, username: 'reader', apiKey: ' secret ' }, { fetch: async (url, init) => {
      calls++
      assert.equal(url, 'http://localhost:7860/prefix/sdapi/v1/txt2img')
      const body = JSON.parse(init.body)
      assert.deepEqual(body, { prompt: 'window scene', width: 768, height: 512, batch_size: 1, n_iter: 1, seed: -1, send_images: true, save_images: false })
      assert.equal(init.headers.authorization, authType === 'none' ? undefined : authType === 'basic' ? 'Basic ' + Buffer.from('reader: secret ').toString('base64') : 'Bearer  secret ')
      return Response.json({ images: [png.toString('base64')], info: '{}' })
    } })
    assert.deepEqual(result.data, png)
    assert.equal(calls, 1)
  }
  const input = { provider: 'webui', baseURL: 'http://localhost:7860' }
  const encoded = await generateSceneImage(input, { fetch: async () => Response.json({ images: ['data:image/png;base64,' + png.toString('base64')] }) })
  assert.deepEqual(encoded.data, png)
  assert.throws(() => channelSettings({ ...input, authType: 'unknown' }), /鉴权/)
  assert.throws(() => channelSettings({ ...input, username: 'name:extra' }), /用户名/)
  for (const size of ['4096x4096', '0x512', '500x500', 'large']) assert.throws(() => channelSettings({ ...input, size }), /尺寸/)
  await assert.rejects(generateSceneImage({ ...input, authType: 'basic', username: 'reader' }), /配置/)
})

test('WebUI keeps only reported model/seed metadata and tolerates missing or malformed info', async () => {
  const call = info => generateSceneImage({ provider: 'webui', baseURL: 'http://localhost:7860' }, { fetch: async () => Response.json({ images: [png.toString('base64')], info }) })
  const image = await call(JSON.stringify({ seed: 123, sd_model_name: 'my-checkpoint', sd_model_hash: 'abcdef12', api_key: 'must-not-copy', prompt: 'full secret input' }))
  assert.deepEqual(image.metadata, { seed: 123, model: 'my-checkpoint', modelHash: 'abcdef12' })
  assert.equal(JSON.stringify(image.metadata).includes('secret'), false)
  assert.equal((await call('invalid json')).metadata, undefined)
  assert.equal((await call(JSON.stringify({ seed: -1 }))).metadata, undefined)
})
