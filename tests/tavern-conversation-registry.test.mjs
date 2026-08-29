import assert from 'node:assert/strict'
import test from 'node:test'
import { createTavernConversationRegistry } from '../tavern-plugin/lib/domain/tavern-conversation-registry.js'

function memoryStore(seed = {}) {
  let links = structuredClone(seed.links || {})
  let index = structuredClone(seed.index || { chats: [] })
  const chats = new Map(Object.entries(structuredClone(seed.chats || {})))
  const failures = seed.failures || {}
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
      async writeIndex(value) {
        if (failures.writeIndex) throw new Error(failures.writeIndex)
        index = structuredClone(value)
      },
      async readChat(id) { return chats.has(id) ? structuredClone(chats.get(id)) : undefined },
      async writeChat(chat) { chats.set(chat.id, structuredClone(chat)) },
      async removeChat(id) { chats.delete(id) }
    },
    snapshot() { return { links: structuredClone(links), index: structuredClone(index), chats: Object.fromEntries(chats) } },
    counts() { return { linkUpdates } }
  }
}

test('有效 Session 映射只做普通读取，不进入加锁更新', async function () {
  const chat = { id: 'chat-fast', sessionId: 'session-fast', cardPath: '', cardName: 'Fast' }
  const store = memoryStore({ links: { 'session-fast': 'chat-fast' }, chats: { 'chat-fast': chat } })
  const registry = createTavernConversationRegistry({ store: store.adapter })

  assert.deepEqual(await registry.resolve('session-fast'), chat)
  assert.equal(store.counts().linkUpdates, 0)
})

test('发布 Tavern Chat 时一次完成 Chat、索引和 Session 关联', async function () {
  const store = memoryStore()
  const registry = createTavernConversationRegistry({ store: store.adapter })
  const chat = { id: 'chat-1', sessionId: 'session-1', cardPath: 'cards/a.json', cardName: 'A', updatedAt: 10 }

  await registry.publish(chat)

  assert.deepEqual(store.snapshot().links, { 'session-1': 'chat-1' })
  assert.deepEqual(store.snapshot().index.chats, [{ id: 'chat-1', cardPath: 'cards/a.json', cardName: 'A', updatedAt: 10 }])
  assert.deepEqual(await registry.resolve('session-1'), chat)
})

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

test('删除 Chat 同时移除所有 Session 关联和索引记录', async function () {
  const store = memoryStore({
    links: { one: 'chat-4', two: 'chat-4', keep: 'chat-5' },
    index: { chats: [{ id: 'chat-4' }, { id: 'chat-5' }] },
    chats: { 'chat-4': { id: 'chat-4' }, 'chat-5': { id: 'chat-5' } }
  })
  const registry = createTavernConversationRegistry({ store: store.adapter })

  assert.deepEqual(await registry.remove('chat-4'), { deleted: true })
  assert.deepEqual(store.snapshot().links, { keep: 'chat-5' })
  assert.deepEqual(store.snapshot().index.chats, [{ id: 'chat-5' }])
  assert.equal(store.snapshot().chats['chat-4'], undefined)
})
