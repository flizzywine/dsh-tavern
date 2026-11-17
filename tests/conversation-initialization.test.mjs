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

test('blank alternate persists an empty native chat and accepts its first player floor', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createChatJournalStore } = await import('../tavern-plugin/lib/domain/chat-journal-store.js')
  const { createChatPersistence } = await import('../tavern-plugin/lib/domain/chat-persistence.js')
  const root = await mkdtemp(join(tmpdir(), 'blank-opening-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  const { fixture: managedFixture } = await import('./helpers/mod-system-production-host.mjs')
  const skinReads = []
  const managed = await managedFixture(t, { readSkin: async (_path, { sessionId }) => {
    skinReads.push(sessionId)
    if (sessionId) {
      const existing = await h.registry.resolve(sessionId)
      assert.ok(existing._storageRevision > 0)
    }
    return null
  } })
  const h = initializationFixture({ persistence })
  h.card.alternate_greetings = ['']
  const started = await h.make().start({ ...h.input, openingId: 'alternate:0' })
  const chat = await persistence.read(started.id)
  assert.deepEqual(chat.messages, [])
  assert.ok(chat._storageRevision > 0)
  assert.equal(messages(h.session()).length, 0)
  assert.deepEqual(skinReads, [], 'The opening projects no foreground capabilities, so it never reads an unpublished session')
  await managed.production.foreground(chat, { nativeSession: h.session(chat.sessionId) })
  assert.equal(skinReads.at(-1), chat.sessionId, 'First player request uses the published session skin')
  chat.messages.push({ role: 'user', text: 'Begin from nothing.', turn: 2 })
  await persistence.write(chat)
  const cold = createChatPersistence({ store: createChatJournalStore({ dataRoot: root, newConversations: true }) })
  assert.deepEqual((await cold.read(chat.id)).messages, chat.messages)
})

test('an explicitly empty alternate starts without a Tavern or native opening message', async () => {
  const h = initializationFixture()
  h.card.first_mes = 'Existing opening'
  h.card.alternate_greetings = ['Another opening', '']
  const chat = await h.make().start({ ...h.input, openingId: 'alternate:1' })
  assert.equal(chat.openingText, '')
  assert.deepEqual(h.saved.get(chat.id).messages, [])
  assert.equal(messages(h.session()).length, 0)
  assert.equal(chat.nativeOpeningAppended, true)
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
