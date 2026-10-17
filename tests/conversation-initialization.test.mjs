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
  await profile.updateConfirmed({ expectedRevision: first.userProfileRevision, summary: '新偏好', injectionText: '改为快节奏冒险。' })
  await profile.setDefaultEnabled(false)
  const existing = await h.make().start(h.input)
  assert.equal(existing.userProfileEnabled, true)
  assert.equal(existing.userProfileRevision, first.userProfileRevision)
  assert.equal(existing.userProfileContextSnapshot, first.userProfileContextSnapshot)
  assert.equal((await h.make().start({ ...h.input, sessionId: 'next' })).userProfileEnabled, false)
})

test('原生游玩把固定会话种子写在人物卡背景之后、开场白之前，重入不重复', async () => {
  const h = initializationFixture()
  await h.make().start(h.input)
  const first = structuredClone(h.session().events)
  const seed = seedMessages(h.session())

  assert.deepEqual(seed.map(event => event.type), ['user/message', 'assistant/message', 'user/message'])
  assert.ok(seed.every(event => event.seq < messages(h.session())[0].seq))
  assert.ok(h.trace.indexOf('prefix') < h.trace.indexOf('flush'))
  await h.make().start(h.input)
  assert.deepEqual(h.session().events, first)

  const compatibility = initializationFixture()
  await assert.rejects(compatibility.make().start({ ...compatibility.input, requestMode: 'sillytavern' }), /已停用/)
  assert.equal(seedMessages(compatibility.session()).length, 0)

  const card = initializationFixture()
  await card.make().start({ ...card.input, mode: 'card', cardPath: '' })
  // The plain card workbench gets no scripted exchange; its role is in the system prompt.
  assert.equal(seedMessages(card.session()).length, 0)
  const cardEvents = structuredClone(card.session().events)
  await card.make().start({ ...card.input, mode: 'card', cardPath: '' })
  assert.deepEqual(card.session().events, cardEvents)
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

test('every partial native append boundary is resumable without deleting history or duplicating events', async () => {
  for (const stage of ['turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end']) {
    const h = initializationFixture()
    h.state.failures.append = (type, data) => {
      if (type === stage && (stage !== 'assistant/message' || data?.message?.source?.model === 'character-card')) throw Error('append failed')
    }
    await assert.rejects(h.make().start(h.input), /append failed/)
    const before = structuredClone(h.session().events)
    delete h.state.failures.append
    await h.make().ensureOpening('session')
    assert.deepEqual(h.session().events.slice(0, before.length), before)
    assert.deepEqual(h.session().events.map(x => x.type), [
      'user/message', 'assistant/message', 'user/message',
      'turn/start', 'step/start', 'assistant/message', 'step/end', 'turn/end'
    ])
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

test('开局草稿世界书在第一次保存前固化，再次打开不覆盖本局配置', async () => {
  const h = initializationFixture()
  const snapshot = { version: 1, source: null, document: null }
  const chat = await h.make().start({ ...h.input, preparation: { worldbookSnapshot: snapshot } })
  assert.deepEqual(chat.openingWorldbookSnapshot, snapshot)
  assert.deepEqual(h.writes[0].chat.openingWorldbookSnapshot, snapshot)
  const reopened = await h.make().start({ ...h.input, preparation: { worldbookSnapshot: { version: 99 } } })
  assert.deepEqual(reopened.openingWorldbookSnapshot, snapshot)
})

test('新局采用全局默认模型，重入不覆盖本局选择', async () => {
  const h = initializationFixture()
  const foreground = { provider: 'p', model: 'story', reasoningEffort: 'low' }
  const background = { provider: 'p', model: 'fast', reasoningEffort: 'high' }
  h.state.settings.defaultForegroundModel = foreground
  h.state.settings.defaultBackgroundModel = background
  const first = await h.make().start(h.input)
  assert.deepEqual(h.session().selectedModel, foreground)
  assert.deepEqual(first.backgroundModelSelection, background)
  h.session().selectedModel = { provider: 'p', model: 'manual' }
  h.state.settings.defaultForegroundModel = { provider: 'p', model: 'new' }
  h.state.settings.defaultBackgroundModel = null
  const existing = await h.make().start(h.input)
  assert.equal(h.session().selectedModel.model, 'manual')
  assert.deepEqual(existing.backgroundModelSelection, background)
  const next = await h.make().start({ ...h.input, sessionId: 'next-default' })
  assert.equal(h.session('next-default').selectedModel.model, 'new')
  assert.equal(next.backgroundModelSelection, null)
  assert.equal(h.trace.filter(x => x === 'model.select').length, 2)
})

test('卡片工作台默认跟随前台模型，单独设置后改用工作台模型；重入不覆盖', async () => {
  const h = initializationFixture()
  h.state.settings.defaultForegroundModel = { provider: 'p', model: 'story' }
  h.state.settings.defaultBackgroundModel = { provider: 'p', model: 'fast' }
  const follow = await h.make().start({ ...h.input, sessionId: 'workbench-follow', mode: 'card', cardPath: '' })
  assert.equal(follow.backgroundModelSelection, null)
  assert.equal(h.session('workbench-follow').selectedModel.model, 'story')
  h.state.settings.defaultWorkbenchModel = { provider: 'p', model: 'editor', reasoningEffort: 'high' }
  await h.make().start({ ...h.input, sessionId: 'workbench-own', mode: 'card', cardPath: '' })
  assert.deepEqual(h.session('workbench-own').selectedModel, { provider: 'p', model: 'editor', reasoningEffort: 'high' })
  h.session('workbench-own').selectedModel = { provider: 'p', model: 'manual' }
  await h.make().start({ ...h.input, sessionId: 'workbench-own', mode: 'card', cardPath: '' })
  assert.equal(h.session('workbench-own').selectedModel.model, 'manual')
  h.state.settings.defaultForegroundModel = null
  h.state.settings.defaultWorkbenchModel = null
  await h.make().start({ ...h.input, sessionId: 'workbench-dsh', mode: 'card', cardPath: '' })
  assert.equal(h.session('workbench-dsh').selectedModel, undefined)
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
