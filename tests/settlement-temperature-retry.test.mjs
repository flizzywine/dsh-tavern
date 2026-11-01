import assert from 'node:assert/strict'
import test from 'node:test'
import { registerModelStreamHooks } from '../tavern-plugin/lib/hooks/model-stream.js'
import { isTemperatureRejection } from '../tavern-plugin/lib/domain/temperature-rejection.js'

const rejection = '400: {"message":"invalid temperature: only 0.6 is allowed for this model","type":"invalid_request_error"}'
const failure = () => ({ type: 'finish', reason: { kind: 'error', failure: { message: rejection } } })
const success = [{ type: 'text-delta', text: '已结算' }, { type: 'finish', reason: { kind: 'stop' } }]

function harness(provider, { task = 'settlement', onComplete } = {}) {
  let hook
  const requests = [], records = [], completed = [], cancelled = []
  const context = task ? { task, parentSessionId: 'parent', turn: 1 } : undefined
  const ctx = {
    on(name, callback) { if (name === 'llm/stream') hook = callback },
    llm: { stream(request) { requests.push(request); return hook(request, () => provider(request, requests.length)) } },
    get() {}, logger: () => ({ warn() {} })
  }
  registerModelStreamHooks({
    ctx, agentRegistry: { get: () => ({ cancel: value => cancelled.push(value) }) },
    sessionStore: { get() {}, flush() {} },
    backgroundAgentRunner: { owns: () => !!task, requestContext: () => context },
    chatForSession: async () => undefined,
    chatHeaderForSession: async () => ({ id: 'game', mode: 'card' }),
    foregroundStrategies: { projectRequest: () => null, completeRequest() {} },
    fullTemplateRuntime: {},
    modelRequestLog: {
      async record({ options }) { records.push(options); return { id: String(records.length) } },
      async complete(result) { completed.push(result); await onComplete?.(result) }
    },
    requestCoordinates: new Map(), str: value => typeof value === 'string' ? value : '',
    sessionStateForSession: async () => null, updateChat: async () => {},
    worldbookRecallLog: { requested: async () => {} }, runtimePrompt: () => '', storyRetention: async () => ({})
  })
  return { requests, records, completed, cancelled, async send(extra = {}) {
    const chunks = []
    for await (const chunk of ctx.llm.stream(Object.freeze({ sessionId: 'background', provider: 'kimi', model: 'fixed',
      messages: [], system: 'Keep me', temperature: 0.1, maxTokens: 123, tools: [{ name: 'submit' }], ...extra }))) chunks.push(chunk)
    return chunks
  } }
}

for (const mode of ['finish', 'throw']) test(`settlement temperature rejection retries one request without temperature (${mode})`, async () => {
  const state = harness(async function * (request, attempt) {
    if (attempt === 1) { if (mode === 'throw') throw new Error(rejection); yield failure(); return }
    assert.equal(Object.hasOwn(request, 'temperature'), false)
    yield * success
  })
  const controller = new AbortController()
  assert.deepEqual(await state.send({ signal: controller.signal }), success)
  assert.equal(state.requests.length, 2)
  assert.equal(state.requests[0].temperature, 0.1)
  for (const key of ['messages', 'tools', 'system', 'maxTokens', 'signal', 'provider', 'model', 'sessionId']) assert.equal(state.requests[1][key], state.requests[0][key])
  assert.equal(state.records.length, 2)
  assert.equal(state.completed.length, 2)
  assert.match(state.completed[0].error || state.completed[0].finish.failure.message, /invalid temperature/)
  assert.equal(state.completed[1].finish.kind, 'stop')
  assert.deepEqual(state.cancelled, [])
})

for (const task of ['phone', 'candidate', 'stage-director', 'plugin', null]) test(`no temperature retry outside settlement: ${task}`, async () => {
  const state = harness(async function * () { yield failure() }, { task })
  assert.deepEqual(await state.send(), [failure()])
  assert.equal(state.requests.length, 1)
})

for (const chunk of [
  { type: 'text-delta', text: 'partial' },
  { type: 'reasoning-delta', text: 'thinking' },
  { type: 'tool-call-delta', text: '{}' },
  { type: 'block-start', index: 0, blockType: 'tool-call' },
  { type: 'block-end', index: 0, block: { type: 'tool-call', name: 'submit', arguments: {} } }
]) test(`no replay after ${chunk.type}`, async () => {
  const state = harness(async function * () { yield chunk; yield failure() })
  assert.deepEqual(await state.send(), [chunk, failure()])
  assert.equal(state.requests.length, 1)
})

test('second rejection is surfaced and cannot recurse', async () => {
  const state = harness(async function * () { yield failure() })
  assert.deepEqual(await state.send(), [failure()])
  assert.equal(state.requests.length, 2)
})

test('second thrown rejection is surfaced', async () => {
  const state = harness(async function * () { throw new Error(rejection) })
  await assert.rejects(state.send(), /invalid temperature/)
  assert.equal(state.requests.length, 2)
})

test('abort between attempts prevents retry', async () => {
  const controller = new AbortController()
  const state = harness(async function * () { yield failure() }, { onComplete: () => controller.abort() })
  await assert.rejects(state.send({ signal: controller.signal }), /abort/i)
  assert.equal(state.requests.length, 1)
})

for (const message of ['400: invalid model', '401: invalid temperature', '429: invalid temperature', '500: invalid temperature', 'network timeout temperature', '400: request contains temperature but invalid api key']) test(`does not retry unrelated failure: ${message}`, async () => {
  const state = harness(async function * () { throw new Error(message) })
  await assert.rejects(state.send())
  assert.equal(state.requests.length, 1)
})

test('no fallback for absent temperature or compaction', async () => {
  for (const extra of [{ temperature: undefined }, { purpose: 'compaction' }]) {
    const state = harness(async function * () { yield failure() })
    assert.deepEqual(await state.send(extra), [failure()])
    assert.equal(state.requests.length, 1)
  }
})

test('recognizes fixed-temperature messages without scanning echoed request data', () => {
  assert.equal(isTemperatureRejection({ status: 400, message: 'invalid temperature: only 1 is allowed for this model' }), true)
  assert.equal(isTemperatureRejection({ message: '400: {"error":{"message":"Unsupported temperature value"}}' }), true)
  assert.equal(isTemperatureRejection({ message: '400: {"message":"invalid API key","request":{"temperature":"invalid temperature"}}' }), false)
  assert.equal(isTemperatureRejection({ message: '400: {invalid temperature' }), false)
})


test('successful request preserves the configured temperature', async () => {
  const state = harness(async function * () { yield * success })
  assert.deepEqual(await state.send(), success)
  assert.equal(state.requests.length, 1)
  assert.equal(state.requests[0].temperature, 0.1)
})

test('temperature unsupported-value response is recognized', () => {
  assert.equal(isTemperatureRejection({ statusCode: 400, message: "Unsupported value: 'temperature' does not support 0.1 with this model. Only the default (1) value is supported." }), true)
})

for (const mode of ['finish', 'throw']) test(`pi-ai usage before Kimi only-1 rejection preserves independent attempt accounting (${mode})`, async () => {
  const rejectedUsage = { inputTokens: 0, outputTokens: 0 }
  const acceptedUsage = { inputTokens: 12, outputTokens: 4 }
  const message = '400: {"message":"invalid temperature: only 1 is allowed for this model","type":"invalid_request_error"}'
  const state = harness(async function * (request, attempt) {
    if (attempt === 1) {
      assert.equal(request.temperature, 0.2)
      yield { type: 'usage', usage: rejectedUsage }
      if (mode === 'throw') throw new Error(message)
      yield { type: 'finish', reason: { kind: 'error', failure: { message } } }
      return
    }
    assert.equal(Object.hasOwn(request, 'temperature'), false)
    yield success[0]
    yield { type: 'usage', usage: acceptedUsage }
    yield success[1]
  })
  assert.deepEqual(await state.send({ temperature: 0.2 }), [
    { type: 'usage', usage: rejectedUsage }, success[0],
    { type: 'usage', usage: acceptedUsage }, success[1]
  ])
  assert.equal(state.requests.length, 2)
  assert.deepEqual(state.completed.map(result => result.usage), [rejectedUsage, acceptedUsage])
  assert.equal(state.completed[0].text, '')
  assert.equal(state.completed[1].text, '已结算')
  assert.equal(state.completed[1].finish.kind, 'stop')
})
