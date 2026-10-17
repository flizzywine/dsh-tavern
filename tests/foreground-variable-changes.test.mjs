import assert from 'node:assert/strict'
import test from 'node:test'
import { lastRoundVariableChanges } from '../tavern-plugin/lib/domain/foreground-variable-changes.js'

const message = (stat_data, extra = {}) => ({ role: 'assistant', swipeId: 0, variables: [{ stat_data }], ...extra })
const chat = messages => ({ mode: 'story', mvu: { enabled: true }, messages })

test('只列出上一轮结算后变化的变量及最新值；列表整体给出，对象逐层比较，内部键忽略', () => {
  const before = { 基本: { 时间: '14:00', 地点: '律所' }, 待办: ['买猫粮'], 体力: 70, $meta: { strictSet: true } }
  const after = { 基本: { 时间: '15:25', 地点: '律所' }, 待办: ['买猫粮', '健身'], 体力: 70, $meta: { strictSet: false } }
  const text = lastRoundVariableChanges(chat([message(before), { role: 'user', text: '继续' }, message(after)]))
  assert.match(text, /^【上一轮变量变化】/)
  assert.match(text, /\/基本\/时间 = "15:25"/)
  assert.match(text, /\/待办 = \["买猫粮","健身"\]/)
  assert.doesNotMatch(text, /地点|体力|\$meta/)
  assert.equal(lastRoundVariableChanges(chat([message(after), message(after)])), null, '无变化不注入')
  assert.equal(lastRoundVariableChanges(chat([message(after)])), null, '开局没有上一轮')
  assert.equal(lastRoundVariableChanges({ ...chat([message(before), message(after)]), mvu: { enabled: false } }), null)
})
