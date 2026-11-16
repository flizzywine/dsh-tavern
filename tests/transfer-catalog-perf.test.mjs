import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createTransferChats } from '../tavern-plugin/lib/domain/transfer-chats.js'
import { createTransferLogs } from '../tavern-plugin/lib/domain/transfer-logs.js'
import { readZipEntries, writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { createTransferHandlers } from '../tavern-plugin/lib/rpc/transfer.js'

test('transfer-chats list 与 importedHashes 优先使用轻量摘要与头部读取，零次触发全量 readChat', async () => {
  let fullReadCount = 0
  let summaryReadCount = 0
  let headerReadCount = 0

  const chats = createTransferChats({
    async listSessions() {
      return [
        { id: 'chat-a', sessionId: 'sess-a', title: '第一章', cardName: '角色A', mode: 'story', requestMode: 'tavern' },
        { id: 'chat-b', sessionId: 'sess-b', title: '第二章', cardName: '角色B', mode: 'story', requestMode: 'tavern' }
      ]
    },
    async readRecentSummaries(chatId) {
      summaryReadCount += 1
      if (chatId === 'chat-a') {
        return { revision: 5, from: 0, messageCount: 3, messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'assistant' }] }
      }
      return { revision: 1, from: 0, messageCount: 1, messages: [{ role: 'user' }] }
    },
    async readChatHeader(chatId) {
      headerReadCount += 1
      return chatId === 'chat-a'
        ? { id: 'chat-a', importedSave: { sourceHash: 'hash-a' } }
        : { id: 'chat-b', importHistory: { digest: 'digest-b' } }
    },
    async readChat() {
      fullReadCount += 1
      throw new Error('不应回退到全量 readChat')
    },
    async exportSave() { throw new Error('unused') },
    async importSave() { throw new Error('unused') }
  })

  const items = await chats.list()
  assert.equal(fullReadCount, 0)
  assert.equal(summaryReadCount, 2)
  assert.deepEqual(items, [
    { key: 'chat-a', title: '第一章', meta: '2 轮 · 角色A', bytes: 0 },
    { key: 'chat-b', title: '第二章', meta: '0 轮 · 角色B', bytes: 0 }
  ])

  const hashes = await chats.importedHashes()
  assert.equal(fullReadCount, 0)
  assert.equal(headerReadCount, 2)
  assert.deepEqual([...hashes].sort(), ['digest-b', 'hash-a'])
})

test('getTransferCatalog 服务端 single-flight 合并并发请求并共享单次 listTavernSessions', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'transfer-catalog-sf-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  let listSessionsCalls = 0
  let summaryCalls = 0

  const handlers = createTransferHandlers({
    dataRoot: root,
    TAVERN_PACKAGE_VERSION: '3.3.0',
    fileResources: {
      absolute: rel => path.join(root, rel),
      async list() { return [] },
      async readText() { return undefined }
    },
    worldBooks: { async catalog() { return { standalone: [] } } },
    presetLibrary: { async catalog() { return { presets: [] } } },
    promptDocuments: { export: () => ({ name: '默认', prompts: {} }) },
    userPreferenceProfile: { async read() { return { profiles: [] } } },
    regexManager: { async read() { return { global: [] } } },
    async readTavernSettings() { return {} },
    async listTavernSessions() {
      listSessionsCalls += 1
      await new Promise(resolve => setTimeout(resolve, 25))
      return [
        { id: 'chat-1', sessionId: 'sess-1', title: '测试局', cardName: '示范卡', mode: 'story', requestMode: 'tavern' }
      ]
    },
    chatPersistence: {
      async readRecentSummaries() {
        summaryCalls += 1
        return { revision: 2, from: 0, messageCount: 2, messages: [{ role: 'user' }, { role: 'assistant' }] }
      },
      async readSlice(chatId) {
        return { chat: { id: chatId }, messageCount: 2 }
      }
    },
    async readChat() {
      throw new Error('getTransferCatalog 不应调用全量 readChat')
    },
    userPluginInstaller: { pluginsDir: path.join(root, 'plugins'), async list() { return [] } },
    pluginDataStore: {},
    tavernSkills: { async list() { return [] } },
    async exportTavernLogs() { return { filename: 'diag.zip', base64: '' } }
  })

  const [first, second] = await Promise.all([
    handlers.getTransferCatalog(),
    handlers.getTransferCatalog()
  ])

  assert.equal(listSessionsCalls, 1, 'chats/logs 并行拉取及双发 getTransferCatalog 应共享同一次 listTavernSessions')
  assert.equal(summaryCalls, 1)
  const chatPart = first.parts.find(part => part.kind === 'chats')
  assert.deepEqual(chatPart.items, [{ key: 'chat-1', title: '测试局', meta: '1 轮 · 示范卡', bytes: 0 }])
  assert.deepEqual(second, first)
})

test('transfer-logs 多会话导出时对相同的全局 update/diagnostics.json 自动去重，单会话导出保持原样', async () => {
  const repeatedUpdateJson = JSON.stringify({
    version: 1,
    records: Array.from({ length: 80 }, (_, idx) => ({ seq: idx, message: 'update-record-payload-' + idx }))
  })
  function makeDiagZip(sessionName) {
    return writeZipEntries([
      { path: 'session.jsonl', content: `{"session":"${sessionName}"}\n` },
      { path: 'update/diagnostics.json', content: repeatedUpdateJson }
    ])
  }

  const logs = createTransferLogs({
    async listSessions() {
      return [
        { sessionId: 'sess-1', title: '对话一', mode: 'story', requestMode: 'tavern' },
        { sessionId: 'sess-2', title: '对话二', mode: 'story', requestMode: 'tavern' },
        { sessionId: 'sess-3', title: '对话三', mode: 'story', requestMode: 'tavern' }
      ]
    },
    async exportLogs(sessionId) {
      const zip = makeDiagZip(sessionId)
      return { filename: `diag-${sessionId}.zip`, base64: zip.toString('base64') }
    }
  })

  // 单会话导出：完整保留
  const single = await logs.collect(['sess-1'])
  const singleEntries = readZipEntries(single[0].content)
  assert.equal(singleEntries.get('update/diagnostics.json').toString('utf8'), repeatedUpdateJson)

  // 多会话导出：第 1 份完整保留，第 2、3 份替换为合法精简 JSON Stub
  const multi = await logs.collect(['sess-1', 'sess-2', 'sess-3'])
  const firstEntries = readZipEntries(multi[0].content)
  const secondEntries = readZipEntries(multi[1].content)
  const thirdEntries = readZipEntries(multi[2].content)

  assert.equal(firstEntries.get('update/diagnostics.json').toString('utf8'), repeatedUpdateJson)
  assert.equal(secondEntries.get('session.jsonl').toString('utf8'), '{"session":"sess-2"}\n')
  const secondStub = JSON.parse(secondEntries.get('update/diagnostics.json').toString('utf8'))
  assert.equal(secondStub.version, 1)
  assert.equal(secondStub.deduplicatedFrom, 'diag-sess-1.zip')
  assert.deepEqual(secondStub.records, [])
  assert.ok(multi[1].content.length < multi[0].content.length)
  assert.ok(multi[2].content.length < multi[0].content.length)
  assert.equal(thirdEntries.get('session.jsonl').toString('utf8'), '{"session":"sess-3"}\n')
})
