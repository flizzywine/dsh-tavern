import test from 'node:test'
import assert from 'node:assert/strict'
import { createModelCalls } from '../tavern-plugin/lib/domain/model-calls.js'

const tools = [{ name: 'lookup', description: 'Read', parameters: { type: 'object' } }]
const selection = { provider: 'fixture', model: 'initial', reasoningEffort: 'low' }
const finish = { type: 'finish', reason: { kind: 'stop' } }
const answer = [{ type: 'text-delta', index: 0, text: ' answer ' }, finish]
const tool = (id = 'a', args = '{}', name = 'lookup') => ({ type: 'block-end', index: id, block: { type: 'tool-call', id, name, arguments: args } })
const result = { content: [{ type: 'text', text: 'private tool result' }] }
function fixture(rounds) {
  const configs = [], requests = [], dispatched = []
  let selections = 0
  const llm = { async prepareCall(config, signal) {
    const index = configs.length
    configs.push(structuredClone(config))
    let used = false
    return { config: { ...config }, stream(options) {
      assert.equal(used, false, 'INVALID_PREPARED_CALL: prepared.stream is single-use')
      used = true
      dispatched.push(index)
      requests.push(structuredClone({ ...options, signal: undefined }))
      assert.equal(options.signal, signal)
      return (async function * () {
        for (const chunk of rounds[index]) {
          if (typeof chunk === 'function') await chunk()
          else yield chunk
        }
      })()
    } }
  } }
  const { callModel } = createModelCalls({ llm, agents: () => new Map(), sessionProjections: () => undefined,
    agentDefaultModel: { currentSelection() { selections++; return selections === 1 ? selection : { provider: 'changed', model: 'changed' } } } })
  return { configs, requests, dispatched, selections: () => selections,
    run: opts => callModel({ messages: [], tools, onToolCall: () => result, ...opts }) }
}

test('pre-abort, stream abort and callback abort never dispatch another tool or round', async () => {
  for (const at of ['before', 'stream', 'callback']) {
    const controller = new AbortController()
    let called = 0
    const f = fixture([[tool('a'), ...(at === 'stream' ? [() => controller.abort()] : []), tool('b'), finish], answer])
    if (at === 'before') controller.abort()
    await assert.rejects(f.run({ signal: controller.signal, onToolCall() { called++; controller.abort(); return result } }), { name: 'AbortError' })
    assert.equal(called, at === 'callback' ? 1 : 0)
    assert.equal(f.configs.length, at === 'before' ? 0 : 1)
  }
})
