import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationDeletion } from '../tavern-plugin/lib/domain/conversation-deletion.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createTavernConversationRegistry } from '../tavern-plugin/lib/domain/tavern-conversation-registry.js'

const source = readFileSync(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const section = source.slice(source.indexOf('  async function stopChatForDeletion'), source.indexOf('  async function exportConversation'))
async function temporaryStore(t) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'tavern-chat-deletion-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  return createProfileDataStore({ dataRoot })
}

async function setup(t, { projection = true } = {}) {
  const events = []
  const store = await temporaryStore(t)
  const deletedChatIds = new Set()
  const workers = new Map(['a', 'background'].map(id => [id, { cancel: () => events.push('cancel:' + id), whenIdle: async () => events.push('idle:' + id) }]))
  const gameFootprint = {
    describe: async chat => ({ foregroundSessionId: chat.sessionId, items: [{ category: 'log', path: 'log-' + chat.id }, { category: 'subsession', sessionId: 'background', path: 'live' }, { category: 'subsession', sessionId: 'gone', path: 'gone-' + chat.id }] }),
    removeLeftovers: async footprint => { events.push('cleanup:' + footprint.items.map(item => item.path).join(',')); return { failures: [] } },
    deferSessionDeletion: async items => { events.push('defer:' + items.map(item => item.path).join(',')) }
  }
  const backgroundAgentRunner = { releaseFor: async id => { events.push('release:' + id) } }
  // Deletion reads a header projection, not the whole save: a play save's preset
  // snapshot and foreground frames must never be materialized just to stop a session.
  const chatPersistence = {
    readSlice: async (id, indices, fields) => {
      events.push('project:' + id + ':' + (fields || []).join(','))
      if (!projection) return { chat: { id, sessionId: id, messages: [] } }
      return { chat: { id, sessionId: id, backgroundConfigVersion: 1, conversationFeaturesVersion: 1, messages: [] } }
    }
  }
  let cleanup
  const conversationDeletion = createConversationDeletion({
    store, deletedChatIds,
    removeCore: async id => {
      events.push('remove:' + id)
      if (id === 'bad') throw new Error('disk error')
      return { deleted: true }
    },
    cleanup: (...args) => cleanup(...args)
  })
  const api = new Function('readChat', 'chatPersistence', 'str', 'storyTimeline', 'agentRegistry', 'cancelSettlement', 'conversationDeletion', 'deletedChatIds', 'gameFootprint', 'backgroundAgentRunner', 'deletedSessionIds', 'apiDiagnostics', 'pluginMedia', 'pluginData', 'pluginApi', 'displayRuntimeStore', 'sceneWorldbookArchive', 'profileData', 'writingPreparationBindingPath', section + '; return { deleteChats, cleanupDeletedChat };')(
    async id => { events.push('whole:' + id); return { id, sessionId: id } }, chatPersistence, String,
    { inspect: () => ({ participants: { worker: { sessionId: 'background' } } }) }, workers,
    async id => { events.push('settlement:' + id) },
    conversationDeletion, deletedChatIds, gameFootprint, backgroundAgentRunner, new Set(), { forget: async id => { events.push('forget:' + id) } },
    { removeChat: async id => { events.push('media:' + id) } }, { removeChat: async () => {} }, { gameRemoved: id => events.push('removed:' + id) }, { remove: async () => {} }, { forgetChat: async () => {} },
    { remove: async path => { events.push('profile-remove:' + path) } }, id => 'writing-preparation/' + id)
  cleanup = api.cleanupDeletedChat
  return { ...api, events, conversationDeletion }
}
test('batch deletion stops foreground and background before removing, deduplicates, and continues after a failure', async t => {
  const api = await setup(t)
  const result = await api.deleteChats(['a', 'bad', 'a', 'c'])
  assert.deepEqual(result.results, [{ chatId: 'a', ok: true }, { chatId: 'bad', ok: false, error: 'disk error' }, { chatId: 'c', ok: true }])
  assert.ok(api.events.indexOf('idle:a') < api.events.indexOf('remove:a'))
  assert.ok(api.events.indexOf('idle:background') < api.events.indexOf('remove:a'))
  assert.deepEqual(await api.conversationDeletion.pendingIds(), ['bad'])
  // Leftovers go only after the save is removed; a session DSH still holds live stays archived.
  assert.ok(api.events.indexOf('remove:a') < api.events.indexOf('release:a'))
  assert.ok(api.events.includes('cleanup:log-a,gone-a'))
  assert.ok(api.events.includes('defer:live'), '仍被 DSH 持有的会话下次启动时再删')
  assert.ok(api.events.includes('forget:a'), '已删局的调用诊断不再写回')
  assert.ok(api.events.includes('profile-remove:writing-preparation/a'), '清理写作准备绑定')
  assert.ok(api.events.includes('media:a') && api.events.includes('removed:a'), '清理插件媒体并通知插件')
  assert.ok(!api.events.includes('removed:bad'), '删除失败的局不通知')
  assert.ok(!api.events.some(event => event.startsWith('cleanup:log-bad')))
})

test('索引写入在删档后失败，重启后仍能清理映射和原存档的残留', async t => {
  const store = await temporaryStore(t)
  const chat = { id: 'chat-a', sessionId: 'session-a', cardName: '测试卡', messages: [] }
  await store.writeJson('save.json', chat)
  await store.writeJson('index.json', { chats: [chat] })
  await store.writeJson('links.json', { 'session-a': chat.id })
  await store.writeJson('leftover.json', { sessionId: chat.sessionId })
  let failIndex = true
  const footprint = { chatId: chat.id, foregroundSessionId: chat.sessionId, items: [{ path: 'leftover.json' }] }
  function reopen() {
    const deletedChatIds = new Set()
    const registry = createTavernConversationRegistry({
      isDeleted: id => deletedChatIds.has(id),
      store: {
        readLinks: () => store.readJson('links.json'),
        updateLinks: update => store.updateJson('links.json', update),
        readIndex: () => store.readJson('index.json'),
        updateIndex: async update => {
          if (failIndex) throw new Error('index write failed')
          return await store.updateJson('index.json', update)
        },
        readChat: () => store.readJson('save.json'),
        writeChat: value => store.writeJson('save.json', value),
        removeChat: () => store.remove('save.json')
      }
    })
    const deletion = createConversationDeletion({
      store, deletedChatIds, removeCore: registry.remove,
      cleanup: async (id, plan) => {
        assert.equal(id, chat.id)
        assert.deepEqual(plan, footprint)
        await store.remove(plan.items[0].path)
      }
    })
    return { deletion, registry, deletedChatIds }
  }
  const first = reopen()
  await assert.rejects(first.deletion.remove(chat.id, footprint), /index write failed/)
  assert.equal(await store.readJson('save.json'), undefined)
  assert.deepEqual(await first.registry.links(), { 'session-a': chat.id })
  assert.deepEqual(await first.deletion.pendingIds(), [chat.id])

  failIndex = false
  const restarted = reopen()
  const pending = await restarted.deletion.pendingIds()
  for (const id of pending) restarted.deletedChatIds.add(id)
  await restarted.deletion.resumePending(pending)
  assert.deepEqual(await restarted.registry.links(), {})
  assert.deepEqual(await restarted.registry.list(), [])
  assert.equal(await store.readJson('leftover.json'), undefined)
  assert.deepEqual(await restarted.deletion.pendingIds(), [])
  await restarted.registry.sync(chat)
  assert.deepEqual((await store.readJson('index.json')).chats, [])
})

test('主存档删除后残留清理失败，保留清理计划供重试', async t => {
  const store = await temporaryStore(t)
  const deletedChatIds = new Set()
  const footprint = { foregroundSessionId: 'session-a', items: [{ path: 'leftover.json' }] }
  const warnings = []
  let failCleanup = true
  const deletion = createConversationDeletion({
    store, deletedChatIds, removeCore: async () => ({ deleted: true }),
    cleanup: async (_id, plan) => {
      assert.deepEqual(plan, footprint)
      if (failCleanup) throw new Error('cleanup failed')
    },
    logger: { warn: (...args) => warnings.push(args.join(' ')) }
  })
  assert.deepEqual(await deletion.remove('chat-a', footprint), { deleted: true })
  assert.deepEqual(await deletion.pendingIds(), ['chat-a'])
  assert.match(warnings[0], /cleanup failed/)
  failCleanup = false
  await deletion.remove('chat-a')
  assert.deepEqual(await deletion.pendingIds(), [])
})

test('清理计划写入失败时保留存档，并发重试只删除一次', async t => {
  const store = await temporaryStore(t)
  const deletedChatIds = new Set()
  let canWrite = false
  let removals = 0
  const deletion = createConversationDeletion({
    store: {
      ...store,
      updateJson: async (...args) => {
        if (!canWrite) throw new Error('journal write failed')
        return await store.updateJson(...args)
      }
    },
    deletedChatIds,
    removeCore: async () => { removals++; return { deleted: true } },
    cleanup: async () => {}
  })
  await assert.rejects(deletion.remove('chat-a'), /journal write failed/)
  assert.equal(removals, 0)
  assert.equal(deletedChatIds.has('chat-a'), false)
  canWrite = true
  await Promise.all([deletion.remove('chat-a'), deletion.remove('chat-a')])
  assert.equal(removals, 1)
  assert.deepEqual(await deletion.pendingIds(), [])
})
