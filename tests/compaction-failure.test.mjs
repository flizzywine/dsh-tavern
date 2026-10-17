import test from 'node:test'
import assert from 'node:assert/strict'
import { compactionFailureMessage } from '../tavern-plugin/lib/domain/compaction-failure.js'

test('未知失败附上最内层原因，而不是只显示 DSH 的笼统提示 (#148)', () => {
  const inner = new TypeError("Cannot assign to read only property 'x' of object")
  const error = new Error('manual compaction could not produce a smaller summary', { cause: inner })
  assert.equal(compactionFailureMessage(error), "manual compaction could not produce a smaller summary（原因：Cannot assign to read only property 'x' of object）")
  assert.equal(compactionFailureMessage(new Error('plain')), 'plain')
})
