import test from 'node:test'
import assert from 'node:assert/strict'
import { imagePluginFixture, IMAGE_PNG } from './fixtures/image-plugin-runtime.mjs'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const channel = extra => ({ id: 'test', provider: 'novelai', baseUrl: 'https://image.test', model: 'nai-diffusion-4-5-full', apiKey: 'test', options: {}, sizes: {}, ...extra })
const request = { positive: 'cafe', width: 832, height: 1216 }

test('实际配图作业中，画风预设的开关不会恢复渠道选择不传的 variety_boost', async t => {
  const fixture = await imagePluginFixture(t, { config: {
    imageBackend: 'novelai',
    activeImageChannel: 'test',
    imageChannels: [channel({ options: { varietyBoost: 'omit' } })],
    stylePresets: [
      { id: 'variety-on', name: '开', params: { varietyBoost: true, steps: 23 } },
      { id: 'variety-off', name: '关', params: { varietyBoost: false, steps: 24 } },
    ],
  } })
  const requests = []
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://image.test/ai/generate-image')
    const { parameters } = JSON.parse(init.body)
    requests.push(parameters)
    if (Object.hasOwn(parameters, 'variety_boost')) {
      return new Response('unknown field: variety_boost', { status: 422 })
    }
    return new Response(IMAGE_PNG, { headers: { 'content-type': 'image/png' } })
  }
  const runtime = await fixture.start()
  for (const activePreset of ['variety-on', 'variety-off']) {
    assert.equal((await runtime.request('config', { activePreset })).status, 200)
    const start = await runtime.request('jobs', { tag: 'cafe' })
    assert.equal(start.status, 200)
    assert.equal((await runtime.terminal(start.body.id)).state, 'done')
  }
  assert.deepEqual(requests.map(parameters => parameters.steps), [23, 24])
  assert.ok(requests.every(parameters => !Object.hasOwn(parameters, 'variety_boost')))
})
