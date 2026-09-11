import assert from 'node:assert/strict'
import test from 'node:test'
import { helperClient } from './fixtures/helper-host-harness.mjs'

const group = helperClient.groupTavernHistory

test('按人物卡路径隔离同名卡，组内和组间按最新活动排序', () => {
  const history = [
    { chatId: '1', sessionId: 's1', cardPath: 'a.json', cardName: '同名卡', updatedAt: 10 },
    { chatId: '2', sessionId: 's2', cardPath: 'b.json', cardName: '同名卡', lastOpenedAt: 30 },
    { chatId: '3', sessionId: 's3', cardPath: 'a.json', cardName: '同名卡', updatedAt: 20 },
  ]
  const original = structuredClone(history)
  const result = group(history, { s1: { updatedAt: 40 } })
  assert.deepEqual(Array.from(result, g => [g.path, Array.from(g.items, i => i.chatId)]), [['a.json', ['1', '3']], ['b.json', ['2']]])
  assert.deepEqual(history, original)
})

test('删除人物卡后仍按存档路径保留历史，旧存档无路径时不误合并', () => {
  const result = group([
    { chatId: 'deleted', cardPath: 'removed.json', cardName: '旧卡', updatedAt: '2026-09-11T10:00:00Z' },
    { chatId: 'legacy1', cardName: '旧卡' },
    { chatId: 'legacy2', cardName: '旧卡' },
  ])
  assert.equal(result.length, 3)
  assert.equal(result[0].path, 'removed.json')
  assert.equal(new Set(result.map(g => g.key)).size, 3)
  assert.equal(group([]).length, 0)
})
