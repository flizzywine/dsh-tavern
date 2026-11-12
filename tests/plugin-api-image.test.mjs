// tavern.generateImage: one picture on the image plugin's channel, under the asset pictures' limit of four in flight.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssetGeneration } from '../tavern-plugin/lib/domain/asset-generation.js'

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
const store = { readJson: async () => undefined, updateJson: async () => {}, readBytes: async () => undefined, writeBytes: async () => {}, remove: async () => {} }

function generation(t, provider) {
  const service = createAssetGeneration({ store, imageProvider: () => provider, getLibrary: () => null })
  t.after(() => service.dispose())
  return service
}
const channel = (generate, status = { ready: true, model: 'm', maxReferences: 2 }) => ({ label: '配图', status: async () => status, generate })

test('generateImage uses the explicitly resolved provider under the same validation and concurrency limit', async t => {
  const service = generation(t, channel(() => { throw new Error('must not fall back') }))
  const dispatched = []
  const selected = channel(async ({ quality }) => { dispatched.push(quality); return { data: png, mediaType: 'image/png' } })
  await assert.rejects(service.image({ prompt: 'cat', width: 0, height: 64 }, selected), { code: 'INVALID_ARGUMENT' })
  const input = { prompt: 'cat', width: 64, height: 64 }
  await assert.rejects(service.image({ ...input, quality: 'invalid' }, selected), { code: 'INVALID_ARGUMENT' })
  assert.deepEqual(dispatched, [])
  for (const quality of [undefined, 'xhigh', 'max']) {
    const reply = await service.image({ ...input, quality }, selected)
    assert.deepEqual({ data: reply.data, mediaType: reply.mediaType }, { data: png, mediaType: 'image/png' })
    assert.equal(reply.cost.estimated, true)
  }
  assert.deepEqual(dispatched, ['auto', 'xhigh', 'max'])
})
