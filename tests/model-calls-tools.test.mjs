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

test('fragmented tools and block-end replay through fresh prepared calls with fixed controls and summed SDK usage', async () => {
  const replayState = { response: { opaque: 'provider-state' } }
  const usage = { inputTokens: 10, outputTokens: 2, totalTokens: 12, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 1 }
  const f = fixture([
    [{ type: 'tool-call-delta', index: 0, id: 'a', name: 'lookup', argumentsDelta: '{"q":' },
      { type: 'tool-call-delta', index: 0, id: 'a', argumentsDelta: '"first"}' }, tool('b'),
      { type: 'usage', usage }, { ...finish, replayState }],
    [tool('c'), { type: 'usage', usage }, finish],
    [...answer, { type: 'usage', usage }]
  ])
  const calls = [], texts = [], chunks = []
  assert.deepEqual(await f.run({ temperature: 0.4, maxTokens: 99, returnUsage: true,
    onText: text => texts.push(text), onChunk: chunk => chunks.push(chunk.type),
    onToolCall(call, { signal }) { calls.push(call); assert.equal(signal, undefined); return result }
  }), { output: 'answer', usage: Object.fromEntries(Object.entries(usage).map(([k, v]) => [k, v * 3])) })
  assert.deepEqual(calls.map(call => call.id), ['a', 'b', 'c'])
  assert.equal(calls[0].arguments, '{"q":"first"}')
  assert.deepEqual(texts, [' answer '])
  assert.ok(chunks.includes('tool-call-delta'))
  assert.equal(f.selections(), 1)
  assert.deepEqual(f.dispatched, [0, 1, 2])
  for (const config of f.configs) assert.deepEqual(config, { ...selection, temperature: 0.4, maxTokens: 99 })
  const [assistant, first, second] = f.requests[1].messages
  assert.equal(assistant.role, 'assistant')
  assert.deepEqual(assistant.source, { kind: 'model', provider: selection.provider, model: selection.model, replayState })
  assert.deepEqual(assistant.content.map(call => call.id), ['a', 'b'])
  for (const [message, id] of [[first, 'a'], [second, 'b']]) {
    assert.equal(message.role, 'tool'); assert.equal(message.toolCallId, id)
    assert.deepEqual(message.source, { kind: 'tool', callId: id })
    assert.deepEqual(message.content, result.content)
    assert.ok(message.id)
  }
  assert.equal(f.requests[2].messages.length, 5)
})

test('JSON and execution errors are repairable results; unknown tools never reach callback', async () => {
  const f = fixture([[tool('bad', '{'), tool('throws'), tool('unknown', '{}', 'other'), finish], answer])
  let called = 0
  assert.equal(await f.run({ onToolCall() { called++; throw new Error('use a narrower query') } }), 'answer')
  assert.equal(called, 1)
  const results = f.requests[1].messages.slice(1)
  assert.ok(results.every(message => message.isError))
  assert.match(results[1].content[0].text, /narrower query/)
})

test('call budget bounds multi-tool batches and repeated rounds', async () => {
  let called = 0
  const batch = fixture([[tool('a'), tool('b'), finish]])
  await assert.rejects(batch.run({ maxToolCalls: 1, onToolCall() { called++; return result } }), /上限/)
  assert.equal(called, 0)
  const repeated = fixture([[tool(), finish], [tool('b'), finish]])
  await assert.rejects(repeated.run({ maxToolCalls: 1, onToolCall() { called++; return result } }), /上限/)
  assert.equal(called, 1)
  assert.equal(repeated.configs.length, 2)
  assert.equal(await fixture([[tool(), finish], answer]).run({ maxToolCalls: 1 }), 'answer')
  await assert.rejects(fixture([[tool()]]).run({ maxToolCalls: 0 }), /上限/)
})

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

test('no-tools request bytes, callbacks, trim and single usage remain unchanged', async () => {
  const usage = { inputTokens: 2, outputTokens: 1, providerExtension: 'unchanged' }
  const messages = [{ id: 'existing', role: 'user', source: { kind: 'human' }, content: [{ type: 'text', text: 'hello' }] }]
  for (const supplied of [undefined, []]) {
    const f = fixture([[...answer, { type: 'usage', usage }]])
    const texts = [], chunks = []
    assert.deepEqual(await f.run({ tools: supplied, messages, system: 'system\n', returnUsage: true,
      onText: text => texts.push(text), onChunk: chunk => chunks.push(chunk) }), { output: 'answer', usage })
    assert.equal(JSON.stringify(f.requests[0]), JSON.stringify({ ...selection, messages, system: 'system\n' }))
    assert.deepEqual(texts, [' answer ']); assert.deepEqual(chunks, [...answer, { type: 'usage', usage }])
  }
})

test('empty, finish failures and stream failures retain errors with and without tools', async () => {
  for (const supplied of [undefined, tools]) {
    for (const [chunks, error] of [
      [[], /模型返回为空/],
      [[{ type: 'finish', reason: { kind: 'max-tokens' } }], /token 上限/],
      [[{ type: 'finish', reason: { kind: 'error', failure: { message: 'failure' } } }], /模型调用失败: failure/],
      [[{ type: 'finish', reason: { kind: 'aborted' } }], /模型调用失败: aborted/],
      [[() => { throw new Error('broken') }], /模型流失败: broken/]
    ]) await assert.rejects(fixture([chunks]).run({ tools: supplied }), error)
  }
})
