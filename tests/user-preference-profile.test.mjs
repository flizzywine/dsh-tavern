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

test('manual edits create a new confirmed version without changing an existing game snapshot', async function () {
  let tick = 0
  const profile = createUserPreferenceProfile({ store: memoryStore(), now: () => ++tick })
  const draft = await profile.saveDraft({ summary: '旧画像', injectionText: '旧注入摘要' })
  const first = await profile.confirm({ draftRevision: draft.draft.revision, confirmation: '确认保存用户画像' })
  const frozen = await profile.stableContext()
  await assert.rejects(profile.updateConfirmed({ expectedRevision: 999, summary: '新画像', injectionText: '新注入摘要' }), /已被其他操作修改/)
  const changed = await profile.updateConfirmed({ expectedRevision: first.confirmed.profileRevision, summary: '新画像', injectionText: '新注入摘要' })
  assert.equal(changed.confirmed.profileRevision > first.confirmed.profileRevision, true)
  assert.equal(changed.hasDraft, false)
  assert.match((await profile.stableContext()).text, /新注入摘要/)
  assert.match(frozen.text, /旧注入摘要/)
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

test('legacy literal newline escapes render and inject as real line breaks', async function () {
  const profile = createUserPreferenceProfile({ store: memoryStore({
    spec: 'dsh-tavern.user-preference-profile',
    version: 2,
    revision: 4,
    confirmed: { revision: 4, profileRevision: 4, summary: '第一行\\n第二行', injectionText: '偏好一\\n偏好二' }
  }) })
  const value = await profile.read()
  assert.equal(value.confirmed.summary, '第一行\n第二行')
  assert.match((await profile.stableContext()).text, /偏好一\n偏好二/)
})
