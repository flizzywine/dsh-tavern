import assert from 'node:assert/strict'
import test from 'node:test'

import { mvuSetAtPath, readMvuVariableFloor } from '../tavern-plugin/lib/domain/mvu-variable-editor.js'

function message(id, variables, extra = {}) {
  return { message_id: id, role: 'assistant', swipe_id: 0, ...(variables === undefined ? {} : { variables }), ...extra }
}

test('只读取当前楼层，当前楼层没有状态时不回退到更早楼层', () => {
  const messages = [
    { message_id: 0, role: 'user', variables: [] },
    message(1, { stat_data: { hp: 5 }, schema: { hp: 'number' } }),
    message(2, { stat_data: { hp: 8 }, schema: { hp: 'number' } })
  ]
  const helper = { messages, turnMessageIds: { 1: 1, 2: 2 }, mvuEnabled: true }
  const current = readMvuVariableFloor(helper, 2)
  assert.equal(current.messageId, 2)
  assert.equal(current.turn, 2)
  assert.deepEqual(current.statData, { hp: 8 })

  messages[2] = message(2, { schema: {} })
  const withoutData = readMvuVariableFloor(helper, 2)
  assert.equal(withoutData.messageId, 2)
  assert.equal(withoutData.statData, null)
})

test('字段编辑不改原对象，并拒绝危险属性名', () => {
  const original = { 角色: { 生命: 5, 标签: ['a'] } }
  const next = mvuSetAtPath(original, ['角色', '生命'], 8)
  assert.equal(next.角色.生命, 8)
  assert.equal(original.角色.生命, 5)
  assert.notEqual(next.角色, original.角色)
  assert.throws(() => mvuSetAtPath({}, ['__proto__', 'x'], 1), /不支持的变量名/)
})
