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
