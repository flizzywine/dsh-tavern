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
  assert.match((await profile.stableContext()).text, /每轮都应有可感知的推进/)
})

test('a newer draft does not silently replace the confirmed profile', async function () {
  let tick = 0
  const profile = createUserPreferenceProfile({ store: memoryStore(), now: () => ++tick })
  const first = await profile.saveDraft({ summary: '第一版', injectionText: '采用第一版偏好。' })
  await profile.confirm({ draftRevision: first.draft.revision, confirmation: '确认保存用户画像' })
  const second = await profile.saveDraft({ summary: '第二版', injectionText: '采用第二版偏好。' })
  assert.match((await profile.stableContext()).text, /第一版/)
  await assert.rejects(profile.confirm({ draftRevision: first.draft.revision, confirmation: '确认保存用户画像' }), /已变化/)
  await profile.confirm({ draftRevision: second.draft.revision, confirmation: '确认保存用户画像' })
  assert.match((await profile.stableContext()).text, /第二版/)
})
