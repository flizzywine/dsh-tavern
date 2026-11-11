import test from 'node:test'
import assert from 'node:assert/strict'
import { registerModelSamplingHook } from '../tavern-plugin/lib/hooks/model-sampling.js'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'

const provider = { api: 'anthropic-messages', compat: { forceAdaptiveThinking: true }, models: [{ id: 'text' }] }
function settingsFor(value) {
  return { describe: () => [{ ns: 'llm-pi-ai', value: { providers: { 'initialization-fixture': value } } }] }
}

test('native prepared and direct streams omit sampling before adapter dispatch', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const received = []
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { modelStream: async function* (request) {
    received.push(request)
    yield { type: 'finish', reason: { kind: 'stop' } }
  } })
  t.after(() => h.dispose())
  registerModelSamplingHook({ on: h.ctx.on.bind(h.ctx), get: () => settingsFor(provider), llm: h.ctx.llm })
  const config = { provider: 'initialization-fixture', model: 'text', temperature: 0.2 }
  const prepared = await h.ctx.llm.prepareCall(config)
  for (const stream of [() => h.ctx.llm.stream({ ...config, messages: [] }), () => prepared.stream({ ...prepared.config, messages: [] })]) {
    for await (const chunk of stream()) assert.equal(chunk.reason?.kind, 'stop', JSON.stringify(chunk))
  }
  assert.equal(received.length, 2)
  for (const request of received) assert.equal('temperature' in request, false)
})
