import assert from 'node:assert/strict'
import test from 'node:test'
import { createSessionInventory } from '../tavern-plugin/lib/domain/session-inventory.js'

test('统计不加载冷会话、不读取正文，区分未知值与零并合并直接引用', async () => {
  const forbidden = () => { throw new Error('不得加载历史') }
  const live = { id: 'hot', seq: 12, get events() { forbidden() }, snapshotEvents: forbidden }
  const reads = []
  const inventory = createSessionInventory({
    persistence: { list: async () => [{ id: 'cold' }, { id: 'hot' }, { id: 'missing' }], load: forbidden, inspect: forbidden,
      locate: meta => ({ path: '/logs/' + meta.id }) },
    sessions: { list: () => [live], get: id => id === 'hot' ? live : undefined },
    agents: { get: id => id === 'hot' ? { phase: { kind: 'running' }, session: live } : undefined, resume: forbidden },
    references: async () => [{ sessionId: 'hot', chatId: 'c1', cardName: '角色', lastOpenedAt: 100 }, { sessionId: 'linked-only', chatId: 'c2', title: '待恢复' }],
    archived: () => ['cold'], fileStat: async path => { reads.push(path); if (path.endsWith('missing')) throw Object.assign(new Error(), { code: 'ENOENT' }); return { size: 0, mtimeMs: 200 } },
    memory: () => ({ rss: 1024, heapUsed: 512, private: 'secret' }), now: () => 300
  })
  const result = await inventory.read()
  const cold = result.rows.find(row => row.sessionId === 'cold')
  assert.equal(cold.loaded, false)
  assert.equal(cold.eventCount, null)
  assert.equal(cold.diskBytes, 0)
  assert.equal(cold.archived, true)
  assert.equal(result.rows[0].eventCount, 12)
  assert.equal(result.rows[0].references[0].title, '角色')
  assert.equal(result.totals.sessions, 4)
  assert.equal(result.totals.unknownDiskSize, 2)
  assert.equal(reads.length, 3)
  assert.doesNotMatch(JSON.stringify(result), /secret|\/logs\//)
})
