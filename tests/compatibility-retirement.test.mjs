import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

const server = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const client = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const chats = [{ id: 'old', sessionId: 'old-session', requestMode: 'sillytavern' }, { id: 'native', sessionId: 'native-session', requestMode: 'dsh' }]

test('RPC refuses legacy sessions, chat ids and mixed targets before executing operations', async () => {
  const start = server.indexOf('async function dispatch(method, args)')
  const context = {
    chatForSession: async id => chats.find(chat => chat.sessionId === id),
    readChat: async id => chats.find(chat => chat.id === id)
  }
  vm.runInNewContext(server.slice(start, server.indexOf('switch (method)', start)) + 'return "allowed"; }; this.dispatch = dispatch;', context)
  for (const method of ['startChat', 'getSession', 'syncSession', 'submitTask', 'startChoices', 'regenBody', 'retrySettlement', 'setRequestMode']) {
    for (const args of [{ requestMode: 'sillytavern' }, { sessionId: 'old-session' }, { chatId: 'old' }, { sessionId: 'native-session', chatId: 'old' }]) {
      await assert.rejects(context.dispatch(method, args), /兼容模式已停用/)
    }
    assert.equal(await context.dispatch(method, { sessionId: 'native-session' }), 'allowed')
  }
})

test('session listing hides retired chats without deleting or changing the stored list', async () => {
  const start = server.indexOf("case 'listSessions': {")
  const context = { readTavernSettings: async () => ({ compatibilityMode: true, trustedCardMode: true }), listTavernSessions: async () => chats }
  vm.runInNewContext('this.list = async () => { switch ("listSessions") {' + server.slice(start, server.indexOf("case 'importCard'", start)) + '} };', context)
  const result = await context.list()
  assert.deepEqual(Array.from(result.sessions, chat => chat.id), ['native'])
  assert.equal(result.capabilities.compatibilityMode, false)
  assert.equal(chats.length, 2)
  assert.equal(chats[0].requestMode, 'sillytavern')
})

test('sidebar ignores stale capability flags and saved mode and excludes legacy history', async () => {
  const context = {
    call: async method => method === 'listCards' ? { cards: [] } : { sessions: chats, capabilities: { compatibilityMode: true } },
    setCards() {}, setTrustedCardMode() {}, publishSessionModes() {},
    setHistory: value => { context.history = value }, setRequestMode: value => { context.mode = value },
    window: { localStorage: { removeItem: key => { context.removed = key } } },
    tavernErrorHub: { resolve() {}, report(_scope, error) { throw error } }
  }
  const start = client.indexOf('function refresh() {', client.indexOf('function TavernSidebar'))
  vm.runInNewContext(client.slice(start, client.indexOf('React.useEffect', start)) + '; this.refresh = refresh;', context)
  await context.refresh()
  assert.deepEqual(Array.from(context.history, chat => chat.id), ['native'])
  assert.equal(context.mode, 'dsh')
  assert.equal(context.removed, 'dsh-tavern-request-mode')
})

test('reentering a legacy chat does not convert its request mode or rewrite its history', async () => {
  const h = initializationFixture()
  const chat = await h.make().start(h.input)
  h.saved.set(chat.id, { ...h.saved.get(chat.id), requestMode: 'sillytavern' })
  const before = structuredClone(h.saved)
  const history = structuredClone(h.session().events)
  await assert.rejects(h.make().start(h.input), /兼容模式已停用/)
  assert.deepEqual(h.saved, before)
  assert.deepEqual(h.session().events, history)
})

test('startup does not migrate, resume or settle retired conversations', async () => {
  const calls = []
  const context = {
    readChat: async id => chats.find(chat => chat.id === id),
    presetLibrary: { migrateChat: async chat => { calls.push(chat.id); return false } },
    syncChatSummary: async () => {},
    foregroundHandoff: { recover: async ids => { context.foreground = ids } },
    candidateTasks: { recover: async ids => { context.background = ids } },
    characterDesignTasks: { recover: async ids => { context.characterDesign = ids } }
  }
  const start = server.indexOf('async function recoverRuntimeHistory(')
  vm.runInNewContext(server.slice(start, server.indexOf('// ---------- 重新生成正文', start)) + '; this.recover = recoverRuntimeHistory;', context)
  await context.recover({ chats })
  assert.deepEqual(calls, ['native'])
  assert.deepEqual(Array.from(context.foreground), ['native'])
  assert.deepEqual(Array.from(context.background), ['native'])
  assert.deepEqual(Array.from(context.characterDesign), ['native'])
})
