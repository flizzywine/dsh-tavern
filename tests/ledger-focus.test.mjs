import test from 'node:test'
import assert from 'node:assert/strict'
import { applyLedgerDelta } from '../tavern-plugin/lib/domain/story-ledger.js'
import { pickLedgerEntities, focusedLedgerContext, assertLedgerFocus } from '../tavern-plugin/lib/domain/ledger-focus.js'

function fixture() {
  let ledger = applyLedgerDelta(null, {
    npcs: { add: [
      { name: '苏婉', ties: '陈岚是同伴', condition: '受伤', location: '客栈', personality: '温和' },
      { name: '陈岚', ties: '宋英是姐姐', condition: '健康', location: '城外' },
      { name: '宋英', ties: '陈岚是妹妹' },
      { name: '林医师（阿林）', personality: '谨慎' }
    ] },
    items: { add: [{ name: '铜钥匙', qty: 1 }, { name: '旧信', desc: '与本批无关的秘密' }] },
    scenes: { add: [{ path: ['城', '客栈'], desc: '木楼' }, { path: ['城', '客栈', '后院'], desc: '庭院' }, { path: ['城', '钟楼'], desc: '石塔' }] }
  }, 1)
  ledger = applyLedgerDelta(ledger, { items: { update: [{ name: '铜钥匙', qty: 2 }] } }, 2)
  return ledger
}

test('按剧情筛选三类实体，只扩展一跳关系，不泄漏关联人物的状态详情', () => {
  const ledger = fixture(), before = structuredClone(ledger)
  const focus = pickLedgerEntities(ledger, '苏婉在客栈交出铜钥匙。')
  assert.deepEqual(focus.ledger.npcs.map(row => row.name), ['苏婉', '陈岚'])
  assert.deepEqual(focus.related, ['陈岚'])
  assert.deepEqual(focus.ledger.items.map(row => row.name), ['铜钥匙'])
  assert.deepEqual(focus.ledger.scenes.map(row => row.path), [['城', '客栈']])
  assert.equal(focus.ledger.npcs[1].condition, undefined)
  assert.equal(focus.ledger.npcs[1].location, undefined)
  const context = focusedLedgerContext(ledger, focus)
  assert.match(context, /旧信/) // Compact identity index avoids duplicate additions.
  assert.doesNotMatch(context, /与本批无关的秘密/)
  assert.deepEqual(ledger, before)
})

test('反向关系也会入选；已经直接命中的人物可更新完整状态', () => {
  const ledger = fixture()
  const focus = pickLedgerEntities(ledger, '宋英和陈岚重逢。')
  assert.ok(focus.related.includes('苏婉'))
  assertLedgerFocus(ledger, focus, { npcs: { update: [{ name: '陈岚', condition: '疲惫', location: '城内' }] } })
})

test('支持明确别名和名称内别称；不将单独代词绑定给人物', () => {
  const ledger = fixture()
  assert.equal(pickLedgerEntities(ledger, '阿林来了').ledger.npcs[0].name, '林医师（阿林）')
  const options = { aliases: { npcs: { 苏婉: ['婉儿', '她'] } } }
  assert.equal(pickLedgerEntities(ledger, '婉儿开门', options).fallback, false)
  assert.equal(pickLedgerEntities(ledger, '她开门', options).fallback, true)
})

test('全未命中才使用最近三个更新轮次；空账可新增', () => {
  let ledger = fixture()
  for (const turn of [3, 4, 5]) ledger = applyLedgerDelta(ledger, { items: { add: [{ name: '物品' + turn }] } }, turn)
  const focus = pickLedgerEntities(ledger, '她环顾四周。')
  assert.equal(focus.fallback, true)
  assert.deepEqual(focus.ledger.items.map(row => row.name), ['物品3', '物品4', '物品5'])
  assert.equal(focus.ledger.npcs.length, 0)
  assert.equal(pickLedgerEntities(ledger, '铜钥匙').fallback, false)
  const empty = pickLedgerEntities(null, '遇见新人物')
  assertLedgerFocus(null, empty, { npcs: { add: [{ name: '新人' }] } })
})

test('关联人物只能改关系；范围外条目和地点子树不允许被隐式修改', () => {
  const ledger = fixture(), focus = pickLedgerEntities(ledger, '苏婉在客栈。')
  assertLedgerFocus(ledger, focus, { npcs: { update: [{ name: '陈岚', relation: '相识', ties: '苏婉的同伴' }] } })
  for (const delta of [
    { npcs: { update: [{ name: '陈岚', condition: '受伤' }] } },
    { npcs: { add: [{ name: '陈岚', location: '客栈' }] } },
    { npcs: { remove: ['陈岚'] } },
    { npcs: { update: [{ name: '宋英', ties: '无' }] } },
    { items: { remove: ['旧信'] } },
    { scenes: { remove: [['城', '客栈']] } },
    { scenes: { reparent: [{ node: ['城', '客栈'], newPath: ['镇', '客栈'] }] } }
  ]) assert.throws(() => assertLedgerFocus(ledger, focus, delta))
  assertLedgerFocus(ledger, focus, { items: { add: [{ name: '新获得的药' }] } })
})
