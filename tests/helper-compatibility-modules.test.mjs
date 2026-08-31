import assert from 'node:assert/strict'
import test from 'node:test'
import { helperClient } from './fixtures/helper-host-harness.mjs'

const tick = () => new Promise(resolve => setImmediate(resolve))

test('生产通信模块校验窗口与token，拒绝伪造回复并在更新上下文后完成请求', async () => {
  let receive, eventId = 'event-1', scriptId = 'script-1'
  const sent = [], contexts = [], events = []
  const parent = { postMessage: message => sent.push(message) }
  const transport = helperClient.createTavernHelperTransport({ parent, token: 'secret', copy: structuredClone,
    identity: () => ({ eventId, scriptId }), listen: listener => { receive = listener },
    onContext: value => contexts.push(value), onEvent: value => events.push(value) })
  const args = { values: { count: 1 } }
  let settled = false
  const result = transport.request('updateVariables', args).then(value => { settled = true; assert.equal(contexts.length, 1); return value })
  args.values.count = 7
  assert.equal(sent[0].args.values.count, 1)
  assert.equal(sent[0].eventId, 'event-1')
  assert.equal(sent[0].scriptId, 'script-1')
  const response = { type: 'dsh-tavern-helper-response', token: 'secret', requestId: sent[0].requestId, ok: true, result: { context: { revision: 3 } } }
  receive({ source: {}, data: response })
  receive({ source: parent, data: { ...response, token: 'wrong' } })
  await tick(); assert.equal(settled, false); assert.equal(contexts.length, 0)
  receive({ source: parent, data: response })
  assert.deepEqual(await result, response.result)
  receive({ source: parent, data: response })
  assert.equal(contexts.length, 1, '重复回复不再次应用上下文')
  receive({ source: parent, data: { type: 'dsh-tavern-helper-event', token: 'wrong' } })
  assert.equal(events.length, 0)
  receive({ source: parent, data: { type: 'dsh-tavern-helper-event', token: 'secret', name: 'MESSAGE_SENT' } })
  assert.equal(events[0].name, 'MESSAGE_SENT')
  eventId = 'event-2'; scriptId = 'script-2'
  const failed = transport.request('write', {})
  assert.equal(sent[1].eventId, eventId); assert.equal(sent[1].scriptId, scriptId)
  const rejection = assert.rejects(failed, /revision conflict/)
  receive({ source: parent, data: { ...response, requestId: sent[1].requestId, ok: false, error: 'revision conflict' } })
  await rejection
})

test('生产事件模块保留脚本身份、失败进度和once递归保护', async () => {
  let script = 'a', reports = 0
  const progress = [], seen = []
  const bus = helperClient.createTavernHelperEventBus({ currentScript: () => ({ id: script }),
    async withScript(id, run) { const old = script; script = id; try { return await run() } finally { script = old } },
    reportSubscriptions() { reports++ }, post: value => progress.push(value) })
  bus.listen('message_sent', async () => { seen.push(script); await bus.emit('MESSAGE_SENT') }, null, true)
  script = 'b'
  bus.listen('MESSAGE_SENT', () => { seen.push(script) })
  assert.deepEqual(Array.from(bus.subscriptionsFor('a')), ['MESSAGE_SENT'])
  await bus.emitHost('host-event', 'message_sent', [])
  assert.deepEqual(seen, ['a', 'b', 'b'])
  assert.equal(script, 'b')
  assert.equal(progress[0].scriptId, 'a')
  assert.equal(progress[0].eventId, 'host-event')
  assert.equal(progress.at(-1).phase, 'completed')
  bus.listen('bad', () => { throw new Error('broken script') })
  await assert.rejects(bus.emitHost('failure', 'bad', []), error => error.message === 'broken script' && error.dshTavernScriptId === 'b')
  assert.equal(progress.at(-1).phase, 'failed')
  assert.ok(reports >= 4)
})
