import test from 'node:test'
import assert from 'node:assert/strict'
import { plannerTemperatureOf } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

test('blank, non-numeric or out-of-range temperature falls back to 1', () => {
  for (const value of ['', null, undefined, true, 'abc', -1, 2.5]) assert.equal(plannerTemperatureOf(value), 1)
})
