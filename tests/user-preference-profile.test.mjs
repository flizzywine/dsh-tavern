import assert from 'node:assert/strict'
import test from 'node:test'
import { createUserPreferenceProfile } from '../tavern-plugin/lib/domain/user-preference-profile.js'

function memoryStore(initial) {
  let value = initial
  return {
    async readJson() { return structuredClone(value) },
    async updateJson(_path, updater) {
      value = await updater(structuredClone(value))
      return structuredClone(value)
    }
  }
}

test('direct save updates the same profile atomically without confirmation or enabling it', async () => {
  const profile = createUserPreferenceProfile({ store: memoryStore() })
  const first = await profile.save({ summary: '慢热', injectionText: '慢热' })
  assert.equal(first.hasConfirmed, true)
  assert.equal(first.hasDraft, false)
  const second = await profile.save({ summary: '快节奏', injectionText: '快节奏' })
  assert.equal(second.profileId, first.profileId)
  assert.equal(second.profiles.length, 1)
  assert.equal(second.confirmed.summary, '快节奏')
  assert.equal(second.hasDraft, false)
  assert.equal(second.defaultEnabled, false)
})
