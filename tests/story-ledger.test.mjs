

import assert from 'node:assert/strict'
import test from 'node:test'

import { applyLedgerDelta, emptyLedger, createLedgerSubmission, ledgerFrameInputs } from '../tavern-plugin/lib/domain/story-ledger.js'
import { promptSectionBody } from '../tavern-plugin/lib/domain/prompt-section.js'

test('长台账注入保留完整条目和有效 JSON，三类都有机会展示且优先近期记录', () => {
  const ledger = emptyLedger()
  ledger.items = Array.from({ length: 100 }, (_, i) => ({ name: '物品' + i, desc: '物'.repeat(160), updatedTurn: i }))
  ledger.npcs = Array.from({ length: 60 }, (_, i) => ({ name: '人物' + i, personality: '性'.repeat(120), relation: '关'.repeat(100), updatedTurn: i }))
  ledger.scenes = [{ path: ['城', '客栈'], desc: '住处', updatedTurn: 100 }]
  const before = structuredClone(ledger)
  const input = ledgerFrameInputs({ ledger, ledgerInjection: { through: 100 } })[0]
  const body = promptSectionBody('story_ledger', input.text)
  const text = body.slice(body.indexOf('\n') + 1), injected = JSON.parse(text)
  assert.ok(text.length <= 12000)
  assert.equal(injected.npcs[0].name, '人物59')
  assert.equal(injected.items[0].name, '物品99')
  assert.equal(injected.scenes[0].desc, '住处')
  for (const kind of ['npcs', 'items', 'scenes']) {
    assert.equal(injected[kind].length + injected.omitted[kind], ledger[kind].length)
    for (const row of injected[kind]) assert.ok(ledger[kind].some(original => JSON.stringify(original) === JSON.stringify(row)), 'never cut a row mid-field')
  }
  assert.deepEqual(ledger, before)
})

test('台账保留离场角色和寄存物品，部分消耗、用尽和未知更新原子处理', () => {
  const first = applyLedgerDelta(null, { items: { add: [{ name: '解药', qty: 3 }, { name: '铜匣', carried: false, location: '客栈' }] }, npcs: { add: [{ name: '林岚', relation: '同行者，互相信任', follow: true }] }, scenes: { add: [{ path: ['城', '客栈'], desc: '初遇的客栈' }] }, location: '客栈', locationPath: ['城', '客栈'] }, 1)
  const second = applyLedgerDelta(first, { items: { update: [{ name: '解药', qty: 2 }] }, npcs: { update: [{ name: '林岚', follow: false, location: '客栈' }] }, location: '钟楼' }, 2)
  assert.equal(second.items[1].location, '客栈')
  assert.equal(second.npcs[0].relation, '同行者，互相信任')
  assert.equal(second.npcs[0].follow, false)
  assert.deepEqual(second.locationPath, [])
  assert.equal(first.items[0].qty, 3)
  assert.equal(second.itemLog.at(-1).from, 3)
  assert.equal(second.itemLog.at(-1).to, 2)
  const before = JSON.stringify(second)
  assert.throws(() => applyLedgerDelta(second, { items: { add: [{ name: '新物品' }], update: [{ name: '不存在', qty: 3 }] } }, 3), /尚未登记/)
  assert.equal(JSON.stringify(second), before)
  assert.equal(applyLedgerDelta(second, { items: { remove: ['解药'] } }, 3).items.length, 1)
})

test('工具已接受的提交重复调用不累计数量；无变化也可完成，坏参数可纠正', () => {
  const task = createLedgerSubmission({ enabled: true, current: null, turn: 2 })
  assert.equal(task.complete, false)
  assert.equal(JSON.parse(task.execute({ arguments: { items: { add: [{ name: '药', qty: -1 }] } } })).retryable, true)
  task.execute({ arguments: { items: { add: [{ name: '药', qty: 2 }] } } })
  assert.equal(JSON.parse(task.execute({ arguments: { items: { add: [{ name: '药', qty: 2 }] } } })).alreadySubmitted, true)
  assert.equal(task.result.items[0].qty, 2)
  const noChange = createLedgerSubmission({ enabled: true, current: task.result, turn: 3 })
  noChange.execute({ arguments: {} })
  assert.equal(noChange.result.items[0].qty, 2)
  assert.equal(noChange.complete, true)
  for (const value of [null, [], { items: { add: 'invalid' } }, { npcs: { add: [{ name: '' }] } }, { unexpected: [] }]) assert.throws(() => applyLedgerDelta(null, value, 1))
})

test('地点调整层级保留子树和当前位置，禁止循环和覆盖，删除清理当前位置', () => {
  let ledger = applyLedgerDelta(null, { scenes: { add: [{ path: ['家'], desc: '住处' }, { path: ['家', '卧室'], desc: '卧室' }] }, locationPath: ['家', '卧室'] }, 1)
  ledger = applyLedgerDelta(ledger, { scenes: { reparent: [{ node: ['家'], newPath: ['城', '家'] }] } }, 2)
  assert.deepEqual(ledger.locationPath, ['城', '家', '卧室'])
  assert.throws(() => applyLedgerDelta(ledger, { scenes: { reparent: [{ node: ['城', '家'], newPath: ['城', '家', '家'] }] } }, 3), /自身/)
  const removed = applyLedgerDelta(ledger, { scenes: { remove: [['城', '家']] } }, 3)
  assert.equal(removed.scenes.length, 0)
  assert.deepEqual(removed.locationPath, [])
})
