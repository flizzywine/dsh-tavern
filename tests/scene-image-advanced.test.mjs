import test from 'node:test'
import assert from 'node:assert/strict'
import { channelSettings, imageChannelRequest } from '../tavern-plugin/lib/domain/scene-image-channels.js'

import { createImageConfiguration } from '../tavern-plugin/packages/dsh-image-gen/src/configuration.js'

const config = (provider, extras = {}) => ({ ...channelSettings({}, provider), baseURL: 'http://127.0.0.1:9999', apiKey: 'fixture', prompt: 'a quiet garden', ...extras })

test('invalid controls fail before dispatch rather than being silently clamped', () => {
  for (const [provider, patch] of [['novelai', { steps: '51' }], ['webui', { steps: '0' }], ['webui', { steps: '1.5' }], ['webui', { guidance: 'NaN' }], ['novelai', { guidance: '11' }], ['webui', { steps: '1e2' }], ['qwen', { negativePrompt: 'x'.repeat(4001) }]]) {
    assert.throws(() => channelSettings(patch, provider))
  }
})

test('saved controls survive module recreation and channel switches; stale capture never sends a paid request', async () => {
  let saved = {}, calls = []
  const make = () => createImageConfiguration({ read: async () => saved, write: async patch => { saved = { ...saved, ...patch } }, credentials: { resolve: async () => ({ value: 'fixture' }) },
    generateImpl: async input => { calls.push(imageChannelRequest(input).body); return { data: Buffer.from('fixture') } } })
  let service = make()
  await service.configure(config('webui', { steps: '31', guidance: '5.5', negativePrompt: 'blur' }))
  await service.configure(config('qwen', { negativePrompt: 'watermark' }))
  service = make()
  assert.equal((await service.inspect('webui')).steps, '31')
  assert.equal((await service.inspect('qwen')).negativePrompt, 'watermark')
  const { active, apiKey } = await service.capture('webui')
  await service.generate({ ...active, apiKey, prompt: 'first' })
  assert.equal(calls[0].steps, 31)
  await service.configure({ ...active, steps: '35' })
  await assert.rejects(service.generate({ ...active, apiKey, prompt: 'stale' }), error => error.imageOutcome === 'not_requested')
  assert.equal(calls.length, 1)
  const next = await service.capture('webui')
  await service.generate({ ...next.active, apiKey: next.apiKey, prompt: 'redraw' })
  assert.equal(calls[1].steps, 35)
  assert.equal(calls[1].negative_prompt, 'blur')
  await service.configure({ ...next.active, steps: '', guidance: '', negativePrompt: '' })
  const reset = await service.capture('webui')
  await service.generate({ ...reset.active, apiKey: reset.apiKey, prompt: 'default' })
  assert.equal(calls[2].steps, undefined)
})
