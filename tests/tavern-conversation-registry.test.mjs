import assert from 'node:assert/strict'
import test from 'node:test'
import { createTavernConversationRegistry } from '../tavern-plugin/lib/domain/tavern-conversation-registry.js'

function memoryStore(seed = {}) {
  let links = structuredClone(seed.links || {})
  let index = structuredClone(seed.index || { chats: [] })
  const chats = new Map(Object.entries(structuredClone(seed.chats || {})))
  const failures = seed.failures || {}
  let chatReads = 0
  let linkUpdates = 0
  return {
    adapter: {
      async readLinks() { return structuredClone(links) },
      async updateLinks(updater) {
        linkUpdates += 1
        const result = await updater(structuredClone(links))
        if (result !== undefined) links = structuredClone(result)
      },
      async readIndex() { return structuredClone(index) },
      async updateIndex(updater) { const next = await updater(await this.readIndex()); if (next !== undefined) await this.writeIndex(next); return next },
      async writeIndex(value) {
        if (failures.writeIndex) throw new Error(failures.writeIndex)
        index = structuredClone(value)
      },
      async readChat(id) {
        chatReads += 1
        if (failures.readChat) throw new Error(failures.readChat)
        return chats.has(id) ? structuredClone(chats.get(id)) : undefined
      },
      async writeChat(chat) { chats.set(chat.id, structuredClone(chat)) },
      async removeChat(id) { chats.delete(id) }
    },
    snapshot() { return { links: structuredClone(links), index: structuredClone(index), chats: Object.fromEntries(chats), chatReads } },
    counts() { return { linkUpdates } }
  }
}

test('索引发布失败时回滚 Chat 和 Session 关联', async function () {
  const store = memoryStore({ failures: { writeIndex: 'index locked' } })
  const registry = createTavernConversationRegistry({ store: store.adapter })

  await assert.rejects(registry.publish({ id: 'chat-2', sessionId: 'session-2', cardPath: '', cardName: 'B', updatedAt: 20 }), /index locked/)

  assert.deepEqual(store.snapshot().links, {})
  assert.deepEqual(store.snapshot().chats, {})
})

test('损坏映射会从 Chat 索引自愈并清除失效目标', async function () {
  const chat = { id: 'chat-real', sessionId: 'session-3', cardPath: '', cardName: 'C' }
  const store = memoryStore({
    links: { 'session-3': 'chat-missing' },
    index: { chats: [{ id: 'chat-real' }] },
    chats: { 'chat-real': chat }
  })
  const registry = createTavernConversationRegistry({ store: store.adapter })

  assert.deepEqual(await registry.resolve('session-3'), chat)
  assert.deepEqual(store.snapshot().links, { 'session-3': 'chat-real' })
})

test('后台轮换写入轻量索引，恢复旧后台后重新成为当前，列表不加载历史', async () => {
  const store = memoryStore({ links: { front: 'game' } })
  const registry = createTavernConversationRegistry({ store: store.adapter })
  const chat = { id: 'game', messages: [], timeline: { participants: { background: { sessionId: 'old' } } } }
  await registry.sync(chat)
  chat.timeline.participants.background.sessionId = 'new'
  await registry.sync(chat)
  assert.deepEqual((await registry.list())[0].backgroundHistoryIds, ['old'])
  chat.timeline.participants.background.sessionId = 'old'
  await registry.sync(chat)
  const row = (await registry.list())[0]
  assert.equal(row.backgroundSessionId, 'old')
  assert.deepEqual(row.backgroundHistoryIds, ['new'])
  assert.equal(store.snapshot().chatReads, 0)
})

test('共享磁盘索引的并发发布、同步、打开和删除保留各自改动', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createProfileDataStore } = await import('../tavern-plugin/lib/profile-data-store.js')
  const root = await mkdtemp(join(tmpdir(), 'tavern-registry-race-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const data = createProfileDataStore({ dataRoot: root })
  let racing = true, reads = 0, release
  const readBarrier = new Promise(resolve => { release = resolve })
  const store = {
    readLinks: () => data.readJson('sessions.json'),
    updateLinks: fn => data.updateJson('sessions.json', fn),
    async readIndex() {
      const value = await data.readJson('index.json') || { chats: [] }
      // The old read/overwrite implementation deterministically loses a row.
      if (racing) { if (++reads === 2) release(); await readBarrier }
      return value
    },
    writeIndex: value => data.writeJson('index.json', value),
    updateIndex: fn => data.updateJson('index.json', fn),
    readChat: id => data.readJson('chats/' + id + '.json'),
    writeChat: chat => data.writeJson('chats/' + chat.id + '.json', chat),
    removeChat: id => data.remove('chats/' + id + '.json')
  }
  // Two instances must share the storage transaction, not just an instance lock.
  const first = createTavernConversationRegistry({ store })
  const second = createTavernConversationRegistry({ store })
  const chat = id => ({ id, sessionId: 'session-' + id, title: id, createdAt: 1, updatedAt: 1 })
  await data.writeJson('index.json', { cards: ['kept'], custom: true, chats: [] })
  await Promise.all([first.publish(chat('a')), second.publish(chat('b'))])
  racing = false
  assert.deepEqual((await first.list()).map(row => row.chatId).sort(), ['a', 'b'])
  await first.publish(chat('removed'))
  await Promise.all([
    first.sync({ ...chat('a'), title: 'updated', updatedAt: 2 }),
    second.touch('session-b', 100),
    first.remove('removed'),
    second.publish(chat('c'))
  ])
  const index = await data.readJson('index.json')
  assert.deepEqual(index.chats.map(row => row.id).sort(), ['a', 'b', 'c'])
  assert.equal(index.chats.find(row => row.id === 'a').title, 'updated')
  assert.equal(index.chats.find(row => row.id === 'b').lastOpenedAt, 100)
  assert.deepEqual(index.cards, ['kept'])
  assert.equal(index.custom, true)
  assert.equal(await store.readChat('removed'), undefined)
  assert.deepEqual(Object.keys(await store.readLinks()).sort(), ['session-a', 'session-b', 'session-c'])
})
