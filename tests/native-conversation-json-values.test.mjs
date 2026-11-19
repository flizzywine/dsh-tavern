import test from 'node:test'
import assert from 'node:assert/strict'
import {diffJson} from '../tavern-plugin/lib/domain/json-mutation.js'

test('diffJson reports values JSON cannot serialize at all instead of leaking a storage code', () => {
  assert.throws(() => diffJson({}, {big: 1n}), /可序列化/)
})
