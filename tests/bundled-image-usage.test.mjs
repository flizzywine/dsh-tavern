import test from 'node:test'
import assert from 'node:assert/strict'
import { generateImage } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/image-providers.js'
import { createImageGenerator } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/model-provider.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082', 'hex')
const USAGE = { total_tokens: 140, input_tokens: 60, output_tokens: 80, input_tokens_details: { text_tokens: 20, image_tokens: 40 }, output_tokens_details: { image_tokens: 80, text_tokens: 0 } }
const reply = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const channel = { id: 'o', provider: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2', apiKey: 'k' }

test('the OpenAI Images usage block is returned with the picture, for generations and edits', async () => {
  const fetchImpl = async () => reply({ data: [{ b64_json: PNG.toString('base64') }], usage: USAGE })
  assert.deepEqual((await generateImage(channel, { positive: 'lake' }, { fetchImpl })).usage, USAGE)
  const edit = await generateImage(channel, { positive: 'lake', references: [{ data: PNG, mediaType: 'image/png' }] }, { fetchImpl })
  assert.deepEqual(edit.usage, USAGE)
})

test('a response without usage has no usage key, and the model provider passes the usage on', async () => {
  const plain = await generateImage(channel, { positive: 'lake' }, { fetchImpl: async () => reply({ data: [{ b64_json: PNG.toString('base64') }] }) })
  assert.equal('usage' in plain, false)
  const provider = createImageGenerator(() => ({ imageBackend: 'openai', activeImageChannel: 'o', imageChannels: [channel] }),
    async () => ({ bytes: PNG, mediaType: 'image/png', usage: USAGE }))
  assert.deepEqual((await provider.generate({ prompt: 'lake', width: 1024, height: 1024 })).usage, USAGE)
})