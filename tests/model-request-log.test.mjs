import assert from 'node:assert/strict'
import test from 'node:test'

import { createModelRequestLog } from '../tavern-plugin/lib/domain/model-request-log.js'

function presetMessage(phase, text) {
  return {
    role: 'system',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'dsh-tavern', sections: [{ name: 'tavern:runtime-preset-' + phase, text }] }
  }
}

function storageFixture() {
  const files = new Map()
  const operations = []
  let stamp = 1000
  const adapters = {
    readJson: async path => {
      operations.push(['read', path])
      return structuredClone(files.get(path))
    },
    writeJson: async (path, value) => {
      operations.push(['write', path])
      files.set(path, structuredClone(value))
    },
    updateJson: async (path, updater) => {
      files.set(path, structuredClone(await updater(structuredClone(files.get(path)))))
    },
    now: () => stamp,
    id: () => 'fixture'
  }
  return { files, operations, adapters, advance: () => { stamp += 250 } }
}

test('完成请求不再读写正文，阶段消息不重复存储，重启后完整还原', async () => {
  const fixture = storageFixture()
  const log = createModelRequestLog(fixture.adapters)
  const options = { system: '固定前缀', tools: [{ name: 'test' }], messages: [presetMessage('front', 'x'.repeat(1000000))] }
  const original = structuredClone(options)
  const record = await log.record({ chat: { id: 'chat' }, options })
  const path = 'model-requests/chat/' + record.id + '.json'
  const stored = structuredClone(fixture.files.get(path))
  assert.equal(stored.phases, undefined)
  fixture.operations.length = 0
  fixture.advance()
  const restarted = createModelRequestLog(fixture.adapters)
  await restarted.complete({ chatId: 'chat', id: record.id, text: '结果', finish: { kind: 'stop' } })
  assert.equal(fixture.operations.some(([, p]) => p === path), false)
  assert.deepEqual(fixture.files.get(path), stored)
  assert.deepEqual(options, original)
  const evidence = await restarted.evidence('chat')
  assert.deepEqual(evidence.requests[0].request, original)
  assert.deepEqual(evidence.requests[0].phases.front, original.messages)
  assert.equal(evidence.requests[0].durationMs, 250)
  assert.equal(evidence.requests[0].response.text, '结果')
})

test('并发请求的完成结果互不串写，缺少状态文件仍可查看正文', async () => {
  const fixture = storageFixture()
  let sequence = 0
  const log = createModelRequestLog({ ...fixture.adapters, id: () => String(++sequence) })
  const first = await log.record({ chat: { id: 'chat' }, options: { messages: [presetMessage('back', '一')] } })
  const second = await log.record({ chat: { id: 'chat' }, options: { messages: [presetMessage('front', '二')] } })
  await Promise.all([
    log.complete({ chatId: 'chat', id: second.id, text: '结果二' }),
    log.complete({ chatId: 'chat', id: first.id, text: '结果一' })
  ])
  assert.deepEqual((await log.evidence('chat')).requests.map(item => item.response.text), ['结果一', '结果二'])
  fixture.files.delete('model-requests/chat/' + first.id + '.result.json')
  const evidence = await log.evidence('chat')
  assert.equal(evidence.requests[0].status, 'running')
  assert.equal(evidence.requests[0].phases.back[0].content[0].text, '一')
  await log.complete({ chatId: 'chat', id: first.id, text: '恢复结果' })
  assert.equal((await log.evidence('chat')).requests[0].response.text, '恢复结果')
})

test('context browser lists metadata only and retrieves exact snapshots within the owning chat', async () => {
  const files = new Map(), reads = []
  const log = createModelRequestLog({
    readJson: async path => { reads.push(path); return structuredClone(files.get(path)) },
    writeJson: async (path, value) => files.set(path, structuredClone(value)),
    updateJson: async (path, fn) => files.set(path, fn(structuredClone(files.get(path))))
  })
  const options = { system: 'system', messages: [{ role: 'user', content: [{ type: 'text', text: '完整'.repeat(20000) }] }], tools: [{ name: 'test', parameters: { type: 'object' } }] }
  const original = structuredClone(options)
  const item = await log.record({ chat: { id: 'owner', mode: 'card' }, coordinates: { turn: 2, step: 3 }, options })
  assert.equal((await log.latest('owner')).id, item.id)
  reads.length = 0
  assert.deepEqual(await log.latest('owner', item.id), { unchanged: true, id: item.id })
  assert.deepEqual(reads, ['model-requests/owner/index.json'])
  await log.record({ chat: { id: 'owner' }, context: { scope: 'background', turn: 2 }, options: { messages: [] } })
  assert.equal((await log.latest('owner')).id, item.id)
  assert.equal(await log.latest('empty'), null)
  options.messages[0].content[0].text = 'changed later'
  reads.length = 0
  assert.equal((await log.list('owner')).length, 2)
  assert.deepEqual(reads, ['model-requests/owner/index.json'])
  assert.deepEqual((await log.detail('owner', item.id)).request, original)
  await assert.rejects(log.detail('other', item.id), /不存在/)
  await assert.rejects(log.detail('owner', '../private'), /不存在/)
})

test('session ownership writes once under concurrent requests and reuses disk ownership after restart', async () => {
  const files = new Map(), ownerReads = [], ownerWrites = []
  let fail = false
  const adapter = {
    readJson: async path => { if (path.startsWith('model-request-sessions/')) ownerReads.push(path); return structuredClone(files.get(path)) },
    writeJson: async (path, value) => {
      if (path.startsWith('model-request-sessions/')) {
        ownerWrites.push(path)
        if (fail) { fail = false; throw new Error('disk failure') }
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      files.set(path, structuredClone(value))
    },
    updateJson: async (path, fn) => files.set(path, fn(structuredClone(files.get(path))))
  }
  let log = createModelRequestLog(adapter)
  const input = { chat: { id: 'owner' }, options: { sessionId: 'agent', messages: [] } }
  await Promise.all(Array.from({ length: 20 }, () => log.record(input)))
  await log.list('owner')
  assert.equal(ownerReads.length, 1)
  assert.equal(ownerWrites.length, 1)
  await log.record(input)
  assert.equal(ownerReads.length, 1)
  log = createModelRequestLog(adapter)
  await log.record(input)
  await log.list('owner')
  assert.equal(ownerReads.length, 2)
  assert.equal(ownerWrites.length, 1)
  fail = true
  const changed = { ...input, chat: { id: 'new-owner' } }
  // Evidence logging is off the request path: a disk failure is reported, never thrown at the model call.
  await log.record(changed)
  await log.list('new-owner')
  await log.record(changed)
  await log.list('new-owner')
  assert.equal(files.get('model-request-sessions/agent.json').chatId, 'new-owner')
  assert.equal(ownerWrites.length, 3)
})

test('请求凭据脱敏不修改原请求或提示词内容', async () => {
  let stored
  const log = createModelRequestLog({ readJson: async () => undefined, writeJson: async (path, value) => { if (value.request) stored = value }, updateJson: async (_path, fn) => fn(undefined) })
  const options = { sessionId: 's', apiKey: 'secret-a', headers: new Headers({ Authorization: 'Bearer secret-b', 'X-Api-Key': 'secret-c', Accept: 'application/json' }), config: { access_token: 'secret-d' }, messages: [{ role: 'user', content: '不要改写 apiKey 这段文字' }] }
  await log.record({ chat: { id: 'chat' }, options })
  for (const secret of ['secret-a', 'secret-b', 'secret-c', 'secret-d']) assert.equal(JSON.stringify(stored).includes(secret), false)
  assert.equal(stored.request.headers.accept, 'application/json')
  assert.deepEqual(stored.request.messages, options.messages)
  assert.equal(options.apiKey, 'secret-a')
  assert.equal(options.headers.get('Authorization'), 'Bearer secret-b')
})

test('只保留最近 3 轮的请求原文，更早的保留索引与结果', async () => {
  const files = new Map(), removed = []
  const log = createModelRequestLog({
    readJson: async path => structuredClone(files.get(path)),
    writeJson: async (path, value) => files.set(path, structuredClone(value)),
    updateJson: async (path, fn) => files.set(path, fn(structuredClone(files.get(path)))),
    remove: async path => { removed.push(path); files.delete(path) }
  })
  const ids = []
  for (let turn = 1; turn <= 35; turn++) {
    const item = await log.record({ chat: { id: 'c' }, coordinates: { turn, step: 1 }, options: { messages: [{ role: 'user', content: [{ type: 'text', text: '第' + turn + '轮' }] }] } })
    ids.push(item.id)
    await log.complete({ chatId: 'c', id: item.id, text: '回复' + turn })
  }
  const index = await log.list('c')
  assert.equal(index.length, 35)
  assert.deepEqual(index.filter(entry => entry.pruned).map(entry => entry.turn), Array.from({ length: 32 }, (_, i) => i + 1))
  assert.deepEqual(removed, ids.slice(0, 32).map(id => 'model-requests/c/' + id + '.json'))
  await assert.rejects(log.detail('c', ids[0]), /已清理/)
  assert.equal((await log.detail('c', ids[32])).request.messages[0].content[0].text, '第33轮')
  const [old] = (await log.evidence('c', 1)).requests
  assert.equal(old.pruned, true)
  assert.equal(old.request, null)
  assert.equal(old.response.text, '回复1')
})

test('同一轮的大量请求原文按每局大小上限清理，并可整理已有记录', async () => {
  const files = new Map(), removed = []
  const adapters = {
    readJson: async path => structuredClone(files.get(path)),
    writeJson: async (path, value) => files.set(path, structuredClone(value)),
    updateJson: async (path, fn) => files.set(path, fn(structuredClone(files.get(path)))),
    remove: async path => { removed.push(path); files.delete(path) },
    size: async path => files.has(path) ? JSON.stringify(files.get(path)).length : 0
  }
  const log = createModelRequestLog(adapters)
  const big = 'x'.repeat(3 * 1024 * 1024)
  const ids = []
  for (let step = 1; step <= 8; step++) {
    const item = await log.record({ chat: { id: 'c' }, coordinates: { turn: 1, step }, options: { sessionId: 's', messages: [{ role: 'user', content: [{ type: 'text', text: big + step }] }] } })
    ids.push(item.id)
  }
  const index = await log.list('c')
  // About 3 MB each: the newest two fit in 8 MB, the older six go.
  assert.deepEqual(index.filter(entry => entry.pruned).map(entry => entry.step), [1, 2, 3, 4, 5, 6])
  assert.equal((await log.detail('c', ids[7])).request.messages[0].content[0].text, big + 8)
  // Rows written before sizes were recorded are measured by the maintenance pass.
  await adapters.updateJson('model-requests/c/index.json', value => ({ ...value, requests: value.requests.map(({ bytes, ...entry }) => entry) }))
  for (const id of ids.slice(0, 6)) files.set('model-requests/c/' + id + '.json', { request: big })
  await adapters.updateJson('model-requests/c/index.json', value => ({ ...value, requests: value.requests.map(entry => ({ ...entry, pruned: false })) }))
  const result = await log.prune('c')
  assert.equal(result.pruned, 6)
  assert.equal((await log.list('c')).filter(entry => entry.pruned).length, 6)
})
