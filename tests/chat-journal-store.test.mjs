import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'

async function temporary() {
  return await mkdtemp(path.join(os.tmpdir(), 'dsh-tavern-chat-journal-'))
}

function bump(store, chatId, mutate, metadata) {
  return store.update(chatId, function (chat) {
    const next = chat === undefined ? { id: chatId, messages: [], _storageRevision: 0 } : chat
    mutate(next)
    next._storageRevision += 1
    return next
  }, metadata)
}

test('首次保存写 snapshot，后续保存只追加 journal', async function (t) {
  const root = await temporary()
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const store = createChatJournalStore({ dataRoot: root, now: () => 1000 })
  await bump(store, 'chat-1', function (chat) { chat.posture = '门边' }, { source: 'chat.create' })
  const snapshot = path.join(root, 'chats/chat-1/snapshots/000000000001.json')
  const initial = await readFile(snapshot, 'utf8')
  const initialMtime = (await stat(snapshot)).mtimeMs

  await bump(store, 'chat-1', function (chat) { chat.posture = '窗边' }, { source: 'settlement.commit', operationId: 'op-1' })

  assert.equal(await readFile(snapshot, 'utf8'), initial)
  assert.equal((await stat(snapshot)).mtimeMs, initialMtime)
  assert.equal((await store.read('chat-1')).posture, '窗边')
  const journal = await readFile(path.join(root, 'chats/chat-1/journals/000000000002-open.jsonl'), 'utf8')
  assert.match(journal, /"source":"settlement.commit"/)
  assert.match(journal, /"path":\["posture"\]/)
  assert.doesNotMatch(journal, /"messages":\[\]/)
})

test('重新创建 Store 后从 snapshot 与 journal 重放当前 Chat', async function (t) {
  const root = await temporary()
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const first = createChatJournalStore({ dataRoot: root })
  await bump(first, 'chat-1', function (chat) { chat.messages.push({ role: 'user', text: '开门' }) })
  await bump(first, 'chat-1', function (chat) { chat.messages.push({ role: 'assistant', text: '门开了' }) })
  await bump(first, 'chat-1', function (chat) { chat.timeline = { revision: 1 } })

  const restarted = createChatJournalStore({ dataRoot: root })
  const chat = await restarted.read('chat-1')
  assert.deepEqual(chat.messages.map(function (message) { return message.text }), ['开门', '门开了'])
  assert.equal(chat.timeline.revision, 1)
  assert.equal(chat._storageRevision, 3)
  assert.match(await restarted.version('chat-1'), /^journal:000000000001\.json:/)
})

test('旧 Chat 第一次更新时惰性迁移并保留可读备份', async function (t) {
  const root = await temporary()
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  await mkdir(path.join(root, 'chats'), { recursive: true })
  await writeFile(path.join(root, 'chats/chat-old.json'), JSON.stringify({ id: 'chat-old', messages: [{ text: '旧正文' }], posture: '旧状态', _storageRevision: 4 }))
  const store = createChatJournalStore({ dataRoot: root, now: () => 12345 })
  assert.equal((await store.read('chat-old')).posture, '旧状态')

  await bump(store, 'chat-old', function (chat) { chat.posture = '新状态' }, { source: 'settlement.commit' })

  assert.equal((await store.read('chat-old')).posture, '新状态')
  assert.equal(JSON.parse(await readFile(path.join(root, 'chats/chat-old.legacy-12345.json'), 'utf8')).posture, '旧状态')
  assert.deepEqual(await readdir(path.join(root, 'chats/chat-old/snapshots')), ['000000000004.json'])
})

test('达到 frame 阈值后生成新 snapshot 并封存 journal', async function (t) {
  const root = await temporary()
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const store = createChatJournalStore({ dataRoot: root, frameLimit: 2, byteLimit: 999999 })
  await bump(store, 'chat-1', function (chat) { chat.counter = 0 })
  await bump(store, 'chat-1', function (chat) { chat.counter += 1 })
  await bump(store, 'chat-1', function (chat) { chat.counter += 1 })

  assert.deepEqual((await readdir(path.join(root, 'chats/chat-1/snapshots'))).sort(), ['000000000001.json', '000000000003.json'])
  assert.deepEqual(await readdir(path.join(root, 'chats/chat-1/journals')), ['000000000002-000000000003.jsonl'])

  await bump(store, 'chat-1', function (chat) { chat.counter += 1 })
  assert.equal((await store.read('chat-1')).counter, 3)
  assert.match((await readdir(path.join(root, 'chats/chat-1/journals'))).join(','), /000000000004-open\.jsonl/)
})

test('可以按 storage revision 读取历史 Chat', async function (t) {
  const root = await temporary()
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const store = createChatJournalStore({ dataRoot: root, frameLimit: 2 })
  await bump(store, 'chat-1', function (chat) { chat.posture = '一' })
  await bump(store, 'chat-1', function (chat) { chat.posture = '二' })
  await bump(store, 'chat-1', function (chat) { chat.posture = '三' })
  await bump(store, 'chat-1', function (chat) { chat.posture = '四' })

  assert.equal((await store.readRevision('chat-1', 2)).posture, '二')
  assert.equal((await store.readRevision('chat-1', 3)).posture, '三')
  assert.equal((await store.readRevision('chat-1', 4)).posture, '四')
})

test('损坏的最后一行被明确警告并保留此前 revision', async function (t) {
  const root = await temporary()
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const warnings = []
  const store = createChatJournalStore({ dataRoot: root, logger: { warn(...args) { warnings.push(args.join(' ')) } } })
  await bump(store, 'chat-1', function (chat) { chat.counter = 1 })
  await bump(store, 'chat-1', function (chat) { chat.counter = 2 })
  const journal = path.join(root, 'chats/chat-1/journals/000000000002-open.jsonl')
  await writeFile(journal, (await readFile(journal, 'utf8')) + '{"revision":3')

  const restarted = createChatJournalStore({ dataRoot: root, logger: { warn(...args) { warnings.push(args.join(' ')) } } })
  assert.equal((await restarted.read('chat-1')).counter, 2)
  assert.match(warnings.join('\n'), /尾行损坏/)

  await bump(restarted, 'chat-1', function (chat) { chat.counter = 3 })
  const afterRepair = createChatJournalStore({ dataRoot: root })
  assert.equal((await afterRepair.read('chat-1')).counter, 3)
})

test('journal revision 断档时报告具体文件和期望 revision', async function (t) {
  const root = await temporary()
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const store = createChatJournalStore({ dataRoot: root })
  await bump(store, 'chat-1', function (chat) { chat.counter = 1 })
  await bump(store, 'chat-1', function (chat) { chat.counter = 2 })
  const journal = path.join(root, 'chats/chat-1/journals/000000000002-open.jsonl')
  const frame = JSON.parse((await readFile(journal, 'utf8')).trim())
  frame.revision = 4
  await writeFile(journal, JSON.stringify(frame) + '\n')

  await assert.rejects(
    createChatJournalStore({ dataRoot: root }).read('chat-1'),
    function (error) {
      assert.equal(error.code, 'DSH_TAVERN_JOURNAL_GAP')
      assert.match(error.message, /000000000002-open\.jsonl/)
      assert.match(error.message, /期望 2，实际 4/)
      return true
    }
  )
})

test('删除 Chat 会清理 journal 目录和 legacy 备份', async function (t) {
  const root = await temporary()
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  await mkdir(path.join(root, 'chats'), { recursive: true })
  await writeFile(path.join(root, 'chats/chat-old.json'), JSON.stringify({ id: 'chat-old', _storageRevision: 2 }))
  const store = createChatJournalStore({ dataRoot: root, now: () => 12345 })
  await bump(store, 'chat-old', function (chat) { chat.counter = 1 })
  await store.remove('chat-old')

  await assert.rejects(access(path.join(root, 'chats/chat-old')), { code: 'ENOENT' })
  assert.deepEqual((await readdir(path.join(root, 'chats'))).filter(function (name) { return name.startsWith('chat-old') }), [])
  assert.equal(await store.read('chat-old'), undefined)
})
