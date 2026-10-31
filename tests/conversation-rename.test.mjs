import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from './fixtures/client-vm.mjs'
import { createConversationHandlers } from '../tavern-plugin/lib/rpc/conversations.js'
import { createTavernConversationRegistry } from '../tavern-plugin/lib/domain/tavern-conversation-registry.js'

const client = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const renameSource = client.match(/renameSession: (async function \(sessionId, title\) \{[\s\S]*?\n\s*\}),/)[1]
function fixture() {
  let chat = { id: 'chat', sessionId: 'session', title: '旧标题', messages: ['正文'], updatedAt: 1 }
  let index = { chats: [structuredClone(chat)] }
  let failSave = false, failIndex = false
  const store = {
    readLinks: async () => ({ session: 'chat' }), updateLinks: async () => {},
    readIndex: async () => structuredClone(index), async updateIndex(updater) { const next = await updater(await this.readIndex()); if (next !== undefined) await this.writeIndex(next); return next }, writeIndex: async value => { if (failIndex) throw Error('索引保存失败'); index = structuredClone(value) },
    readChat: async () => structuredClone(chat), writeChat: async () => {}, removeChat: async () => {}
  }
  const registry = createTavernConversationRegistry({ store })
  const handlers = createConversationHandlers({
    chatForSession: async id => id === 'session' ? structuredClone(chat) : undefined,
    async updateChat(id, mutate) {
      if (failSave) throw Error('存档保存失败')
      chat = mutate({ ...chat, messages: [...chat.messages, '并发剧情'] })
      // Match updateChat: normal summary sync is best effort.
      try { await registry.sync(chat) } catch {}
      return structuredClone(chat)
    },
    conversationRegistry: registry, str: value => String(value ?? '')
  })
  const invoke = (method, args) => handlers[method](args)
  const session = { title: '旧标题', async rename(title) { this.title = title; return { ok: true } } }
  let notifications = 0
  const rename = vm.runInNewContext('(' + renameSource + ')', {
    ctx: { sessions: { binding: () => ({ session }) } },
    rpc: (method, args) => invoke(method, args),
    notifyTavernDataChanged: () => { notifications++ }
  })
  return { rename, invoke, session, registry, store, chat: () => chat, notifications: () => notifications,
    failSave: () => { failSave = true }, failIndex: value => { failIndex = value } }
}

test('重命名同时更新 Session、Chat 与列表，刷新和后续保存保留新标题及并发剧情', async () => {
  const f = fixture()
  for (const title of ['新标题', '新标题 · 分支']) {
    await f.rename('session', title)
    assert.equal(f.session.title, title)
    assert.equal(f.chat().title, title)
    assert.equal((await f.registry.list())[0].title, title)
    const reloaded = createTavernConversationRegistry({ store: f.store })
    await reloaded.sync(f.chat())
    assert.equal((await reloaded.list())[0].title, title)
  }
  assert.deepEqual(f.chat().messages, ['正文', '并发剧情', '并发剧情'])
  assert.equal(f.notifications(), 2)
})
