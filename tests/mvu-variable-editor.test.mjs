import assert from 'node:assert/strict'
import test from 'node:test'

import {
  mvuSetAtPath,
  mvuVariablesUpdateRequest,
  mvuVariablesWithStatData,
  parseMvuStatData,
  readMvuVariableFloor,
  serializeMvuStatData
} from '../tavern-plugin/lib/domain/mvu-variable-editor.js'

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

test('当前楼层是隐藏楼层或冷启动占位时不回退，切 swipe 时保留楼层 id', () => {
  const helper = {
    turnMessageIds: { 3: 2, 2: 1 },
    messages: [
      message(0, { stat_data: { hp: 1 } }),
      message(1, { stat_data: { hp: 2 } }, { is_hidden: true }),
      { message_id: 2, role: 'assistant', swipe_id: 1, variables: [], stub: true }
    ]
  }
  assert.equal(readMvuVariableFloor(helper, 3), null)
  const visible = {
    turnMessageIds: { 3: 2, 2: 1 },
    messages: [
      message(0, { stat_data: { hp: 1 } }),
      message(1, { stat_data: { hp: 2 } }, { is_hidden: true }),
      message(2, { stat_data: { hp: 3 } }, { swipe_id: 1 })
    ]
  }
  const floor = readMvuVariableFloor(visible, 3)
  assert.equal(floor.messageId, 2)
  assert.equal(floor.swipeId, 1)
})

test('JSON 编辑只接受对象，写入保留 schema 和其他字段', () => {
  assert.deepEqual(parseMvuStatData('{"hp": 7, "背包": ["药"]}'), { hp: 7, 背包: ['药'] })
  assert.throws(() => parseMvuStatData('[]'), /JSON 对象/)
  assert.throws(() => parseMvuStatData('not json'), /不是有效 JSON/)
  assert.equal(serializeMvuStatData({ hp: 7 }), '{\n  "hp": 7\n}')

  const variables = { stat_data: { hp: 7 }, schema: { hp: 'number' }, display_data: { hp: '生命' }, extra: true }
  const next = mvuVariablesWithStatData(variables, { hp: 9 })
  assert.deepEqual(next.stat_data, { hp: 9 })
  assert.deepEqual(next.schema, variables.schema)
  assert.deepEqual(next.display_data, variables.display_data)
  assert.equal(next.extra, true)
  assert.equal(variables.stat_data.hp, 7)

  const request = mvuVariablesUpdateRequest({ sessionId: 's', floor: { messageId: 3, swipeId: 1, variables }, statData: { hp: 9 }, lifecycleRevision: 4 })
  assert.deepEqual(request.option, { type: 'message', message_id: 3, swipe_id: 1 })
  assert.equal(request.expectedLifecycleRevision, 4)
  assert.equal(request.variables.schema.hp, 'number')
  assert.deepEqual(request.variables.stat_data, { hp: 9 })
})

test('字段编辑不改原对象，并拒绝危险属性名', () => {
  const original = { 角色: { 生命: 5, 标签: ['a'] } }
  const next = mvuSetAtPath(original, ['角色', '生命'], 8)
  assert.equal(next.角色.生命, 8)
  assert.equal(original.角色.生命, 5)
  assert.notEqual(next.角色, original.角色)
  assert.throws(() => mvuSetAtPath({}, ['__proto__', 'x'], 1), /不支持的变量名/)
})
