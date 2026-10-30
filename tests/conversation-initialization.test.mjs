import assert from 'node:assert/strict'
import test from 'node:test'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

import { createUserPreferenceProfile } from '../tavern-plugin/lib/domain/user-preference-profile.js'

const messages = session => session.events.filter(event => event.type === 'assistant/message' && event.data?.message?.source?.model === 'character-card')

const seedMessages = session => session.events.filter(event => {
  const source = event.type === 'assistant/message' ? event.data?.message?.source : event.data?.source
  return source?.form === 'synthetic-trajectory' || source?.model === 'synthetic-trajectory'
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

test('missing cards, invalid openings, missing scripts and readiness failures do not publish partial chats', async () => {
  for (const input of [{ cardPath: 'missing' }, { openingId: 'missing' }, { mode: 'script' }]) {
    const h = initializationFixture()
    await assert.rejects(h.make().start({ ...h.input, ...input }))
    assert.equal(h.saved.size, 0)
    assert.deepEqual(h.state.links, {})
  }
  for (const first_mes of ['开场白', '']) {
    const h = initializationFixture(); h.card.first_mes = first_mes; h.card.alternate_greetings = []
    h.state.failures.wait = async () => { throw Error('not writable') }
    const api = h.make()
    await assert.rejects(api.start(h.input), /not writable/)
    assert.equal(h.saved.size, 0)
    delete h.state.failures.wait
    assert.equal((await api.start(h.input)).nativeOpeningAppended, true)
    assert.equal(messages(h.session()).length, first_mes ? 1 : 0)
  }
})

test('missing binding recovers through registry; old standalone UUID greeting is adopted without rewriting its events', async () => {
  const h = initializationFixture()
  const first = await h.make().start(h.input)
  const stored = h.saved.get(first.id); delete stored.nativeOpeningAppended
  const old = messages(h.session())[0]
  old.data.message.id = '11111111-1111-4111-8111-111111111111'
  old.data.message.source = { kind: 'model', provider: 'fixture', model: 'text' }
  h.state.links = {}
  const before = structuredClone(h.session().events)
  await h.make().ensureOpening('session')
  assert.deepEqual(h.session().events, before)
  assert.equal(h.state.links.session, first.id)
  assert.equal(await h.make().ensureOpening('missing'), null)
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

test('DSH 人物卡带的开局默认：新局用卡里的预设和设置，其余沿用玩家的全局默认', async () => {
  const h = initializationFixture()
  h.state.startDefaults = { presetPath: 'presets/大肥鱼 · 舞台演出.json', settings: { statusBarPlacement: 'body', backgroundTasks: { posture: false } } }
  const chat = await h.make().start(h.input)
  assert.equal(chat.runtimePresetPath, 'presets/大肥鱼 · 舞台演出.json')
  assert.deepEqual(h.state.presetPaths.at(-1), 'presets/大肥鱼 · 舞台演出.json')
  assert.equal(chat.statusBarPlacement, 'body')
  assert.equal(chat.backgroundTasks.posture, false)
  assert.equal(chat.backgroundTasks.variables, true, '卡没提到的设置沿用全局默认')
  assert.equal(chat.macroState.userName, '玩家', '玩家称呼不由卡决定')
})

test('新游戏忽略旧机制默认值，旧局数据不被覆盖', async () => {
  const h = initializationFixture()
  const first = await h.make().start(h.input)
  assert.equal(first.worldbookStrategy, 'native-skills')
  h.state.settings.defaultPlaySettings = { worldbookStrategy: 'legacy' }
  assert.equal((await h.make().start({ ...h.input, sessionId: 'legacy-new' })).worldbookStrategy, 'native-skills')
  assert.equal((await h.make().start(h.input)).worldbookStrategy, 'native-skills')
  delete h.saved.get(first.id).worldbookStrategy
  assert.equal((await h.make().start(h.input)).worldbookStrategy, undefined)
})
