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

test('generateImage sends one request with the references and returns the channel bytes', async t => {
  const calls = []
  const service = generation(t, channel(async input => { calls.push(input); return { data: new Uint8Array([9]), mediaType: 'image/png' } }))
  const reply = await service.image({ prompt: '一只猫', width: 1024, height: 1536, background: 'transparent', quality: 'high', references: [{ data: png, mediaType: 'image/png' }] })
  assert.deepEqual(reply, { data: new Uint8Array([9]), mediaType: 'image/png' })
  assert.equal(calls.length, 1)
  assert.deepEqual({ ...calls[0], signal: undefined }, { prompt: '一只猫', width: 1024, height: 1536, background: 'transparent', quality: 'high', references: [{ data: png, mediaType: 'image/png' }], signal: undefined })
  assert.ok(calls[0].signal instanceof AbortSignal)
})

test('generateImage refuses before dispatch: no channel, channel not ready, bad input, too many references', async t => {
  const sent = []
  const generate = async input => { sent.push(input); return { data: png, mediaType: 'image/png' } }
  const request = { prompt: 'a', width: 512, height: 512 }
  await assert.rejects(generation(t, null).image(request), { code: 'NOT_CONFIGURED' })
  await assert.rejects(generation(t, channel(generate, { ready: false, reason: '没填 Key', maxReferences: 4 })).image(request), { code: 'NOT_CONFIGURED', message: '没填 Key' })
  const service = generation(t, channel(generate))
  await assert.rejects(service.image({ ...request, width: 0 }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(service.image({ ...request, quality: 'ultra' }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(service.image({ ...request, references: [{ data: png, mediaType: 'image/jpeg' }] }), { code: 'INVALID_ARGUMENT' })
  await assert.rejects(service.image({ ...request, references: [png, png, png].map(data => ({ data, mediaType: 'image/png' })) }), { code: 'UNSUPPORTED_CHANNEL' })
  assert.equal(sent.length, 0)
})

test('generateImage says whether a failed request may have been billed, and holds four in flight', async t => {
  const waiting = []
  const service = generation(t, channel(({ prompt }) => {
    if (prompt === 'refused') throw Object.assign(new Error('额度\n不足'), { requestMayHaveSucceeded: false })
    if (prompt === 'lost') throw new Error('连接断开')
    if (prompt === 'empty') return {}
    return new Promise(resolve => waiting.push(() => resolve({ data: png, mediaType: 'image/png' })))
  }))
  const request = prompt => service.image({ prompt, width: 64, height: 64 })
  await assert.rejects(request('refused'), { code: 'GENERATION_FAILED', message: '额度 不足', mayHaveCharged: false })
  await assert.rejects(request('lost'), { code: 'GENERATION_FAILED', mayHaveCharged: true })
  await assert.rejects(request('empty'), { code: 'GENERATION_FAILED', mayHaveCharged: true })
  const running = [1, 2, 3, 4].map(() => request('slow'))
  await new Promise(resolve => setImmediate(resolve))
  await assert.rejects(request('fifth'), { code: 'BUSY' })
  waiting.forEach(done => done())
  assert.equal((await Promise.all(running)).length, 4)
  await assert.rejects(request('empty'), { code: 'GENERATION_FAILED' }, 'the four slots are free again')
})
