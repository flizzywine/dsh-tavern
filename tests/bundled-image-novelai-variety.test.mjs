import test from 'node:test'
import assert from 'node:assert/strict'
import { generateImage } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const channel = extra => ({ id: 'test', provider: 'novelai', baseUrl: 'https://image.test', model: 'nai-diffusion-4-5-full', apiKey: 'test', options: {}, sizes: {}, ...extra })
const request = { positive: 'cafe', width: 832, height: 1216 }

/** 发一次请求，返回真正提交给站点的 parameters。 */
async function parametersOf(extra) {
  let body
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body)
    return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } })
  }
  await generateImage(channel(extra), request, { fetchImpl })
  return body.parameters
}

test('站点不认 variety_boost 时，选 omit 后整条字段不进 payload，其它字段照发', async () => {
  const parameters = await parametersOf({ options: { varietyBoost: 'omit' } })
  assert.equal('variety_boost' in parameters, false)
  assert.equal(parameters.params_version, 3)
  assert.equal(parameters.n_samples, 1)
})

test('variety_boost 默认发 false，显式开启才发 true', async () => {
  assert.equal((await parametersOf({})).variety_boost, false)
  assert.equal((await parametersOf({ options: { varietyBoost: true } })).variety_boost, true)
})

test('v5 模型默认不发真值，omit 同样只是去掉字段', async () => {
  assert.equal((await parametersOf({ model: 'nai-diffusion-5-full' })).variety_boost, false)
  assert.equal('variety_boost' in await parametersOf({ model: 'nai-diffusion-5-full', options: { varietyBoost: 'omit' } }), false)
})
