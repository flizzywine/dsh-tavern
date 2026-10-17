import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createGuideLibrary } from '../tavern-plugin/lib/domain/guide-library.js'
import { createConversationGuides } from '../tavern-plugin/lib/domain/conversation-guides.js'

async function fixture(t, initial = []) {
  const root = await mkdtemp(join(tmpdir(), 'conversation-guides-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const persistence = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  await persistence.write({ id: 'chat', sessionId: 'game', mode: 'story', messages: [], guides: initial })
  const library = createGuideLibrary({ store: createProfileDataStore({ dataRoot: root }) })
  const chats = { forSession: id => id === 'game' ? persistence.read('chat') : undefined, update: (...args) => persistence.update(...args) }
  const guides = createConversationGuides({ chats, library, isPlay: chat => chat.mode === 'story' })
  return { guides, library, persistence, chats }
}

test('concurrent add and library load retain both edits in durable current state', async t => {
  const { guides, library, persistence } = await fixture(t)
  const saved = await library.save('方案', [{ text: '来自库' }])
  await Promise.all([guides.add('game', '手动添加'), guides.load('game', saved.id)])
  assert.deepEqual((await persistence.read('chat')).guides.map(item => item.text).sort(), ['手动添加', '来自库'].sort())
  const loaded = await guides.load('game', saved.id)
  assert.equal(loaded.length, 2)
  assert.equal(new Set(loaded.map(item => item.id)).size, 2)
  const snapshot = await guides.save('game', '保存本局')
  await library.update({ id: snapshot.id, expected: snapshot, guides: ['库内编辑'] })
  assert.deepEqual((await persistence.read('chat')).guides, loaded)
})

test('ID deletion cannot delete a neighboring guide after another edit shifts its index', async t => {
  const { guides, persistence } = await fixture(t, ['A', 'B', 'C'].map(id => ({ id, text: id })))
  await guides.remove('game', { id: 'A' })
  await guides.remove('game', { id: 'B' })
  await assert.rejects(guides.remove('game', { id: 'B' }), /已删除/)
  assert.deepEqual((await persistence.read('chat')).guides.map(item => item.id), ['C'])
  await assert.rejects(guides.remove('game', { index: 100 }), /序号无效/)
})

test('legacy index requests resolve identity before a concurrent mutation', async t => {
  const { guides, persistence, chats } = await fixture(t, ['A', 'B', 'C'].map(id => ({ id, text: id })))
  chats.update = async (...args) => {
    await persistence.update('chat', chat => { chat.guides.shift(); return chat })
    return persistence.update(...args)
  }
  await guides.remove('game', { index: 1 })
  assert.deepEqual((await persistence.read('chat')).guides.map(item => item.id), ['C'])
})

test('game and library enforce identical text limits without silent truncation or partial writes', async t => {
  const { guides, library, persistence } = await fixture(t)
  const item = await library.save(' 原方案 ', [{ text: ' 原内容 ' }])
  assert.equal(item.name, '原方案')
  assert.deepEqual(item.guides, ['原内容'])
  for (const text of ['', ' ', 'x'.repeat(2001), 12]) {
    await assert.rejects(guides.add('game', text), /非空|2000/)
    await assert.rejects(library.save('新方案', [{ text }]), /非空|2000/)
    await assert.rejects(library.update({ id: item.id, expected: item, name: '不应保存', guides: [text] }), /非空|2000/)
  }
  assert.deepEqual((await persistence.read('chat')).guides, [])
  assert.equal((await library.get(item.id)).name, '原方案')
  await assert.rejects(guides.add('missing', '文本'), /游玩会话/)
})
