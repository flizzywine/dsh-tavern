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

test('draft remains separate until the user confirms its exact revision', async function () {
  const profile = createUserPreferenceProfile({ store: memoryStore(), now: () => 100 })
  const draft = await profile.saveDraft({
    rawAnswers: [{ question: '喜欢什么节奏？', answer: '慢热，但不要停滞。' }],
    dimensions: [{ id: 'pacing', label: '节奏', conclusion: '慢热且持续推进', confidence: 'likely', evidence: '用户原话' }],
    summary: '偏好慢热且持续推进。',
    injectionText: '节奏可以慢热，但每轮都应有可感知的推进。'
  })
  assert.equal(draft.hasDraft, true)
  assert.equal(draft.hasConfirmed, false)
  assert.equal(await profile.stableContext(), null)
  await assert.rejects(profile.confirm({ draftRevision: draft.draft.revision, confirmation: '' }), /明确确认/)

  const confirmed = await profile.confirm({ draftRevision: draft.draft.revision, confirmation: '确认保存用户画像' })
  assert.equal(confirmed.hasConfirmed, true)
  assert.equal(confirmed.hasDraft, false)
  assert.match((await profile.stableContext()).text, /每轮都应有可感知的推进/)
})

test('default enablement is profile-wide but remains off until explicitly changed', async function () {
  const profile = createUserPreferenceProfile({ store: memoryStore(), now: () => 100 })
  assert.equal((await profile.read()).defaultEnabled, false)
  await assert.rejects(profile.setDefaultEnabled(true), /尚无已确认/)
  const draft = await profile.saveDraft({ summary: '画像', injectionText: '注入摘要' })
  await profile.confirm({ draftRevision: draft.draft.revision, confirmation: '确认保存用户画像' })
  assert.equal((await profile.setDefaultEnabled(true)).defaultEnabled, true)
  assert.equal((await profile.setDefaultEnabled(false)).defaultEnabled, false)
})

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
