import assert from 'node:assert/strict'
import test from 'node:test'
import { MVU_SUBMIT_UPDATE_TOOL, normalizeMvuToolSubmission } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

test('MVU wire schema uses explicit types without unions that gateways can narrow', () => {
  const item = MVU_SUBMIT_UPDATE_TOOL.parameters.properties.operations.items
  assert.equal(item.type, 'object')
  assert.equal(item.properties.op.type, 'string')
  assert.deepEqual(item.properties.op.enum, ['replace', 'insert', 'add', 'delta', 'remove', 'move'])
  assert.equal(item.properties.valueJson.type, 'string')
  assert.equal(item.properties.value, undefined)
  assert.doesNotMatch(JSON.stringify(MVU_SUBMIT_UPDATE_TOOL.parameters), /"(?:anyOf|oneOf)"/)
})

test('invalid or ambiguous encoded values fail before dispatch; legacy persisted operations survive', () => {
  for (const extra of [{ valueJson: '{' }, { valueJson: false }, { valueJson: '1', value: false }, { valueJson: '1e999' }]) {
    assert.throws(() => normalizeMvuToolSubmission({ operations: [{ op: 'replace', path: '/hp', ...extra }] }))
  }
  assert.throws(() => normalizeMvuToolSubmission({ operations: [{ op: 'delta', path: '/hp', valueJson: 'false' }] }))
  const operations = [{ op: 'replace', path: '/hp', value: 3 }, { op: 'remove', path: '/old' }, { op: 'move', from: '/a', path: '/b' }]
  assert.deepEqual(normalizeMvuToolSubmission({ operations }).operations, operations)
})

test('valueJson 解析失败时报出路径与常见原因，模型重提时能对症修正', () => {
  assert.throws(() => normalizeMvuToolSubmission({ operations: [{ op: 'replace', path: '/地点', valueJson: '城市街道' }] }),
    /变量操作 #1（\/地点）的 valueJson 不是有效 JSON：无法解析；文本值须带 JSON 双引号/)
  assert.throws(() => normalizeMvuToolSubmission({ operations: [{ op: 'replace', path: '/hp', valueJson: '1e999' }] }), /（\/hp）.*数字必须有限/)
})
