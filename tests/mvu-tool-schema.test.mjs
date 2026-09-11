import assert from 'node:assert/strict'
import test from 'node:test'
import { MVU_SUBMIT_UPDATE_TOOL } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

test('MVU operation discriminators explicitly declare their type for Google function calling', () => {
  const branches = MVU_SUBMIT_UPDATE_TOOL.parameters.properties.operations.items.oneOf
  const operations = []
  for (const branch of branches) {
    const op = branch.properties.op
    assert.equal(op.type, 'string', 'operations.op schema must explicitly declare string type')
    operations.push(...(op.enum ?? [op.const]))
  }
  assert.deepEqual(operations, ['replace', 'insert', 'add', 'delta', 'remove', 'move'])
})
