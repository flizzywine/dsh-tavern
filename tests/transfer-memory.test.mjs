import assert from 'node:assert/strict'
import test from 'node:test'

import { createTransferMemory } from '../tavern-plugin/lib/domain/transfer-memory.js'

// 一个最小的 profile 数据store：与 profile-data-store 的 JSON 语义一致，只是放在内存里。
function memoryStore(files = new Map()) {
  return {
    files,
    async readJson(path) { const text = files.get(path); return text === undefined ? undefined : JSON.parse(text) },
    async writeJson(path, value) { files.set(path, JSON.stringify(value)) },
    async updateJson(path, updater) {
      const current = files.has(path) ? JSON.parse(files.get(path)) : undefined
      const next = await updater(current)
      if (next === undefined) return current
      files.set(path, JSON.stringify(next))
      return next
    },
    async size(path) { return (files.get(path) || '').length },
    async remove(path) { files.delete(path) }
  }
}

const SESSIONS = [
  { id: 'c1', sessionId: 's1', title: '作家 · 第 3 章', cardName: '作家' },
  { id: 'c2', sessionId: 's2', title: '测试局', cardName: '作家' },
  // 卡工作台与 SillyTavern 导入行不是玩过的局。
  { id: 'card-1', sessionId: 's9', mode: 'card', title: '改卡' },
  { id: 'st-1', sessionId: 's10', requestMode: 'sillytavern', title: '导入的聊天记录' }
]

function log(turn, operationId, text) {
  return { version: 1, status: 'prepared', createdAt: 1700000000000 + turn, chatId: 'c1', sessionId: 's1',
    turn, operationId, branchId: 'b1', basedOnRevision: 1, entries: [{ ref: '世界观', reason: 'selected', text }], outputs: [] }
}

function seeded() {
  const files = new Map()
  const store = memoryStore(files)
  const index = { version: 1, records: [
    { path: 'worldbook-recalls/c1/op-1.json', turn: 3, operationId: 'op-1', branchId: 'b1', createdAt: 1700000000003 },
    { path: 'worldbook-recalls/c1/op-2.json', turn: 4, operationId: 'op-2', branchId: 'b1', createdAt: 1700000000004 }
  ] }
  files.set('worldbook-recalls/c1/index.json', JSON.stringify(index))
  files.set('worldbook-recalls/c1/op-1.json', JSON.stringify(log(3, 'op-1', '第三轮')))
  files.set('worldbook-recalls/c1/op-2.json', JSON.stringify(log(4, 'op-2', '第四轮')))
  const transfer = createTransferMemory({ store, listSessions: async () => SESSIONS })
  return { files, store, transfer }
}

test('collect 把一局的记录合成一项，导入到新局后按 operationId 去重', async () => {
  const { transfer, files } = seeded()
  const items = await transfer.collect(['c1'])
  assert.equal(items.length, 1)
  const document = JSON.parse(items[0].content.toString('utf8'))
  assert.equal(document.spec, 'dsh-tavern.transfer.recalls')
  assert.deepEqual(document.records.map(row => row.turn), [3, 4])
  assert.equal(document.records[1].log.entries[0].text, '第四轮')

  const result = await transfer.importOne({ key: 'c1', chatId: 'new-chat', sessionId: 'new-session', content: items[0].content })
  assert.deepEqual(result, { added: 2, skipped: 0 })
  const index = JSON.parse(files.get('worldbook-recalls/new-chat/index.json'))
  assert.deepEqual(index.records.map(row => row.operationId), ['op-1', 'op-2'])
  assert.equal(index.records[0].path, 'worldbook-recalls/new-chat/op-1.json')
  const record = JSON.parse(files.get('worldbook-recalls/new-chat/op-1.json'))
  assert.equal(record.chatId, 'new-chat')
  assert.equal(record.sessionId, 'new-session')

  // 同一个包再导一次：操作 id 都在，直接跳过。
  const again = await transfer.importOne({ key: 'c1', chatId: 'new-chat', sessionId: 'new-session', content: items[0].content })
  assert.deepEqual(again, { added: 0, skipped: 2 })
})
