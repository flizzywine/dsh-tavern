import assert from 'node:assert/strict'
import test from 'node:test'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

import { createUserPreferenceProfile } from '../tavern-plugin/lib/domain/user-preference-profile.js'
import { ensureSessionSeedTrajectory, sessionSeedTrajectoryMessages } from '../tavern-plugin/lib/domain/session-seed-trajectory.js'

const messages = session => session.events.filter(event => event.type === 'assistant/message' && event.data?.message?.source?.model === 'character-card')

const seedMessages = session => session.events.filter(event => {
  const source = event.type === 'assistant/message' ? event.data?.message?.source : event.data?.source
  return source?.form === 'synthetic-trajectory' || source?.model === 'synthetic-trajectory'
})

test('新开局保留人物卡开场，种子轨迹只写用户消息', async () => {
  const h = initializationFixture()
  await h.make().start(h.input)
  const session = h.session()
  assert.deepEqual(seedMessages(session).map(event => event.type), ['user/message', 'user/message'])
  assert.equal(messages(session).length, 1)
})

test('半写入的旧种子轨迹可以续接，模拟助手回复不会使恢复重复写入', async () => {
  const session = initializationFixture().session()
  await ensureSessionSeedTrajectory(session)
  const [first, last] = sessionSeedTrajectoryMessages(session.id)
  session.events.pop()
  session.append('assistant/message', { message: {
    id: 'tavern-seed-trajectory:v1:session:2', role: 'assistant',
    source: { kind: 'model', provider: 'dsh-tavern', model: 'synthetic-trajectory' }
  } })
  const recovered = await ensureSessionSeedTrajectory(session)
  assert.deepEqual(recovered.events.map(event => event.data.id), [first.data.id, last.data.id])
  const before = structuredClone(session.events)
  await ensureSessionSeedTrajectory(session)
  assert.deepEqual(session.events, before)
})

test('新局默认少量候选，修改开局默认只影响之后创建的对局', async () => {
  const h = initializationFixture()
  const first = await h.make().start(h.input)
  assert.equal(h.saved.get(first.id).candidateTabs, false)
  h.state.settings.defaultPlaySettings = { candidateTabs: true }
  const next = await h.make().start({ ...h.input, sessionId: 'next-candidates' })
  assert.equal(h.saved.get(next.id).candidateTabs, true)
  const reopened = await h.make().start(h.input)
  assert.equal(h.saved.get(reopened.id).candidateTabs, false)
})

test('删除默认模型渠道后仍可创建游玩对话和卡片工作台', async () => {
  const h = initializationFixture()
  h.state.settings.defaultForegroundModel = { provider: 'deleted', model: 'chat' }
  h.state.failures.selectModel = () => {
    throw Object.assign(new Error('no adapter registered for provider "deleted"'), { code: 'NO_ADAPTER' })
  }
  const initializer = h.make()
  const story = await initializer.start(h.input)
  assert.equal(story.nativeOpeningAppended, true)
  assert.equal(messages(h.session()).length, 1)
  const workbench = await initializer.start({ ...h.input, sessionId: 'workbench', mode: 'card' })
  assert.equal(workbench.nativeOpeningAppended, true)
  assert.equal(h.session('workbench').selectedModel, undefined)

  h.state.failures.selectModel = () => { throw new Error('unexpected selection error') }
  await assert.rejects(initializer.start({ ...h.input, sessionId: 'other-error' }), /unexpected selection error/)
  assert.equal(await h.registry.resolve('other-error'), undefined)
})

async function profileFixture() {
  let value
  const profile = createUserPreferenceProfile({ store: {
    readJson: async () => structuredClone(value),
    updateJson: async (_path, update) => { value = await update(structuredClone(value)); return structuredClone(value) }
  } })
  const draft = await profile.saveDraft({ summary: '偏好', injectionText: '偏好慢热但持续推进。' })
  await profile.confirm({ draftRevision: draft.draft.revision, confirmation: '确认保存用户画像' })
  return profile
}

test('画像开关和确认版本只影响新局，不改写已创建的游戏', async () => {
  const profile = await profileFixture()
  await profile.setDefaultEnabled(true)
  const h = initializationFixture({ userPreferenceProfile: profile })
  const first = await h.make().start(h.input)
  assert.equal(h.saved.get(first.id).messages.find(row => row.role === 'assistant').stagePageVersion, 2)
  await profile.updateConfirmed({ expectedRevision: first.userProfileRevision, summary: '新偏好', injectionText: '改为快节奏冒险。' })
  await profile.setDefaultEnabled(false)
  const existing = await h.make().start(h.input)
  assert.equal(existing.userProfileEnabled, true)
  assert.equal(existing.userProfileRevision, first.userProfileRevision)
  assert.equal(existing.userProfileContextSnapshot, first.userProfileContextSnapshot)
  assert.equal((await h.make().start({ ...h.input, sessionId: 'next' })).userProfileEnabled, false)
})

test('新游戏复制全局 Skill 开关，本局调整和后续全局修改互不覆盖', async () => {
  const h = initializationFixture()
  h.state.settings.defaultDisabledWritingSkills = ['writing-a']
  const first = await h.make().start(h.input)
  assert.deepEqual(first.disabledWritingSkills, ['writing-a'])
  h.state.settings.defaultDisabledWritingSkills.push('writing-b')
  assert.deepEqual((await h.make().start(h.input)).disabledWritingSkills, ['writing-a'])
  const local = h.saved.get(first.id)
  local.disabledWritingSkills = []
  assert.deepEqual((await h.make().start(h.input)).disabledWritingSkills, [])
  const next = await h.make().start({ ...h.input, sessionId: 'next-skills' })
  assert.deepEqual(next.disabledWritingSkills, ['writing-a', 'writing-b'])
  const card = await h.make().start({ ...h.input, sessionId: 'card-skills', mode: 'card', cardPath: '' })
  assert.deepEqual(card.disabledWritingSkills, [])
})
