// tagged English defaults; retain protocol, payload, cache and budget assertions.
import assert from 'node:assert/strict'
import test from 'node:test'
import { lastRoundVariableChanges, lastRoundVariableValues } from '../tavern-plugin/lib/domain/foreground-variable-changes.js'

const message = (stat_data, extra = {}) => ({ role: 'assistant', swipeId: 0, variables: [{ stat_data }], ...extra })
const chat = messages => ({ mode: 'story', mvu: { enabled: true }, messages })

test('只列出上一轮结算后变化的变量及最新值；列表整体给出，对象逐层比较，内部键忽略', () => {
  const before = { 基本: { 时间: '14:00', 地点: '律所' }, 待办: ['买猫粮'], 体力: 70, $meta: { strictSet: true } }
  const after = { 基本: { 时间: '15:25', 地点: '律所' }, 待办: ['买猫粮', '健身'], 体力: 70, $meta: { strictSet: false } }
  const text = lastRoundVariableChanges(chat([message(before), { role: 'user', text: '继续' }, message(after)]))
  assert.match(text, /^<variable_changes>/)
  assert.match(text, /\/基本\/时间 = "15:25"/)
  assert.match(text, /\/待办 = \["买猫粮","健身"\]/)
  assert.doesNotMatch(text, /地点|体力|\$meta/)
  assert.equal(lastRoundVariableChanges(chat([message(after), message(after)])), null, '无变化不注入')
  assert.equal(lastRoundVariableChanges(chat([message(after)])), null, '开局没有上一轮')
  assert.equal(lastRoundVariableChanges({ ...chat([message(before), message(after)]), mvu: { enabled: false } }), null)
})

test('用本轮结算前的快照比较，开场初始化不会变成第一轮的变量变化', () => {
  const baseline = { 游戏: { 玩家: '陈言', 金币: 10, 关卡: '城镇' } }
  const saved = message({ 游戏: { ...baseline.游戏, 金币: 8 } }, {
    mvuBaseline: { swipeId: 0, variables: { stat_data: baseline } }
  })
  const run = chat([message({ 游戏: null }, { greeting: true }), { role: 'user', text: '买票。' }, saved])
  assert.deepEqual(lastRoundVariableValues(run), [{ names: ['游戏', '金币'], value: 8 }])
  assert.match(lastRoundVariableChanges(run), /\/游戏\/金币 = 8/)
  assert.doesNotMatch(lastRoundVariableChanges(run), /陈言|城镇/)
  assert.deepEqual(lastRoundVariableValues(chat([saved])), [{ names: ['游戏', '金币'], value: 8 }])
})

test('由结算回执确定反馈字段，读取保存后的最新值并保留手动修改反馈', () => {
  const run = chat([message({ 游戏: { 金币: 8, 操作次数: 3, 地点: '车站' } }, {
    mvuBaseline: { swipeId: 0, variables: { stat_data: { 游戏: { 金币: 10, 操作次数: 2, 道具: '车票', 地点: '城镇' } } } },
    mvu: { receipt: {
      changes: [{ path: '/stat_data/游戏/金币', after: 9 }, { path: '/stat_data/游戏/道具' }],
      sideEffects: [{ path: '/stat_data/游戏/操作次数' }]
    } },
    variableEdits: [{ editedAfterSettlement: true, feedbackPaths: ['/游戏/地点'] }]
  })])
  assert.deepEqual(lastRoundVariableValues(run), [
    { names: ['游戏', '金币'], value: 8 },
    { names: ['游戏', '道具'], value: undefined },
    { names: ['游戏', '地点'], value: '车站' }
  ])
  assert.doesNotMatch(lastRoundVariableChanges(run), /操作次数/)
})
