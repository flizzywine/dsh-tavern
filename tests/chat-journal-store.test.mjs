import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { gunzipSync } from 'node:zlib'

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

for (const sealed of [false, true]) test(`损坏的新快照从旧快照与日志恢复，sealed=${sealed}`, async t => {
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createChatJournalStore({ dataRoot: root, frameLimit: sealed ? 1 : 200 })
  await bump(store, 'chat', chat => { chat.counter = 1 })
  await bump(store, 'chat', chat => { chat.counter = 2 })
  const broken = path.join(root, 'chats/chat/snapshots/000000000002.json')
  await writeFile(broken, '{"id":"chat",')
  const recovered = createChatJournalStore({ dataRoot: root, logger: { warn() {} } })
  assert.equal((await recovered.read('chat')).counter, 2)
  assert.equal((await recovered.readRevision('chat', 2)).counter, 2)
  assert.equal(await readFile(broken, 'utf8'), '{"id":"chat",')
  await bump(recovered, 'chat', chat => { chat.counter++ })
  assert.equal((await createChatJournalStore({ dataRoot: root, logger: { warn() {} } }).read('chat')).counter, 3)
})

for (const broken of [false, true]) test(`半迁移目录仍可读取旧存档并完成迁移，broken=${broken}`, async t => {
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'chats/chat/journals'), { recursive: true })
  await mkdir(path.join(root, 'chats/chat/snapshots'), { recursive: true })
  const legacy = path.join(root, 'chats/chat.json')
  await writeFile(legacy, JSON.stringify({ id: 'chat', _storageRevision: 5, counter: 5 }))
  if (broken) await writeFile(path.join(root, 'chats/chat/snapshots/000000000005.json'), '{')
  const store = createChatJournalStore({ dataRoot: root, logger: { warn() {} } })
  assert.equal((await store.read('chat')).counter, 5)
  // A cached legacy fallback must notice external changes despite the directory.
  await writeFile(legacy, JSON.stringify({ id: 'chat', _storageRevision: 5, counter: 50 }))
  assert.equal((await store.read('chat')).counter, 50)
  await bump(store, 'chat', chat => { chat.counter++ })
  const restarted = createChatJournalStore({ dataRoot: root })
  assert.equal((await restarted.read('chat')).counter, 51)
  assert.equal((await restarted.readRevision('chat', 5)).counter, 50)
  await assert.rejects(access(legacy), { code: 'ENOENT' })
})

test('损坏快照缺少完整重放链时拒绝静默退回旧状态', async t => {
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createChatJournalStore({ dataRoot: root, logger: { warn() {} } })
  await bump(store, 'chat', chat => { chat.counter = 1 })
  await writeFile(path.join(root, 'chats/chat/snapshots/000000000003.json'), '{')
  await assert.rejects(store.read('chat'), /snapshot|快照|revision/)
})

for (const compressed of [false, true]) for (const phase of ['create', 'migrate', 'rotate']) test(`快照发布前进程中断可恢复：${phase}, compressed=${compressed}`, { timeout: 10000 }, async t => {
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  const original = { id: 'chat', _storageRevision: 1, counter: 1 }
  if (compressed) original.payload = '完整历史变量'.repeat(10000)
  await mkdir(path.join(root, 'chats'), { recursive: true })
  if (phase === 'migrate') await writeFile(path.join(root, 'chats/chat.json'), JSON.stringify(original))
  if (phase === 'rotate') await createChatJournalStore({ dataRoot: root }).update('chat', () => original)
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.rename;
    fs.rename = async (from, to) => {
      if (from.includes('.staging-')) {
        process.send({ staged: from });
        await new Promise(() => {});
      }
      return rename(from, to);
    };
    syncBuiltinESMExports();
    const { createChatJournalStore } = await import(${JSON.stringify(new URL('../tavern-plugin/lib/domain/chat-journal-store.js', import.meta.url).href)});
    await createChatJournalStore({ dataRoot: ${JSON.stringify(root)}, frameLimit: 1 }).update('chat', chat => ({
      id: 'chat', _storageRevision: (chat?._storageRevision || 0) + 1, counter: (chat?.counter || 0) + 1,
      ...(${compressed} ? { payload: '完整历史变量'.repeat(10000) } : {})
    }));
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  const [message] = await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(([code]) => { throw new Error('writer exited before staging: ' + code) })
  ])
  const staged = await readFile(message.staged)
  assert.equal(JSON.parse(compressed ? gunzipSync(staged).toString() : staged.toString()).id, 'chat')
  const stopped = once(child, 'exit')
  child.kill('SIGKILL')
  await stopped
  const restarted = createChatJournalStore({ dataRoot: root })
  const recovered = await restarted.read('chat')
  assert.equal(recovered?.counter, phase === 'create' ? undefined : phase === 'rotate' ? 2 : 1)
  await bump(restarted, 'chat', chat => { chat.counter = 9 })
  assert.equal((await createChatJournalStore({ dataRoot: root }).read('chat')).counter, 9)
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

test('连续小写入的重放只复制一次完整人物卡，历史 revision 保持隔离', async function (t) {
  const root = await temporary()
  t.after(async function () { await rm(root, { recursive: true, force: true }) })
  const store = createChatJournalStore({ dataRoot: root })
  await bump(store, 'chat-large', chat => { chat.cardPayload = 'unchanged-card'.repeat(1000); chat.counter = 0 })
  for (let index = 1; index <= 20; index++) await bump(store, 'chat-large', chat => { chat.counter = index })
  const clone = globalThis.structuredClone
  let fullCopies = 0
  t.mock.method(globalThis, 'structuredClone', function (value, options) {
    if (value?.cardPayload) fullCopies++
    return clone(value, options)
  })
  const latest = await store.read('chat-large')
  assert.equal(latest.counter, 20)
  assert.ok(fullCopies <= 1, `完整人物卡被复制了 ${fullCopies} 次`)
  const historical = await store.readRevision('chat-large', 11)
  assert.equal(historical.counter, 10)
  historical.cardPayload = 'changed locally'
  assert.equal(latest.cardPayload, 'unchanged-card'.repeat(1000))
})

test('缓存切片使用 JSON 容器拷贝并保持返回值隔离', async t => {
  const root=await temporary();t.after(()=>rm(root,{recursive:true,force:true}))
  const store=createChatJournalStore({dataRoot:root})
  await bump(store,'sliced',chat=>{chat.messages.push({role:'assistant',text:'stored'});chat.cardPayload='SLICE-PAYLOAD'})
  await store.read('sliced')
  t.mock.method(globalThis,'structuredClone',()=>{throw new Error('normalized JSON slice must not use structuredClone')})
  const selected=await store.readSlice('sliced',[0])
  assert.equal(selected.chat.messages[0].text,'stored')
  selected.chat.messages[0].text='outside';selected.chat.cardPayload='outside'
  const latest=await store.read('sliced')
  assert.equal(latest.messages[0].text,'stored')
  assert.equal(latest.cardPayload,'SLICE-PAYLOAD')
})

test('压缩快照膨胀超过上限时明确失败，保留原文件', async t => {
  const { gzipSync } = await import('node:zlib')
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = path.join(root, 'chats/chat/snapshots')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, '000000000001.json.gz')
  const bytes = gzipSync(JSON.stringify({ id: 'chat', _storageRevision: 1, text: 'x'.repeat(5000) }))
  await writeFile(file, bytes)
  const store = createChatJournalStore({ dataRoot: root, maxSnapshotBytes: 1024 })
  await assert.rejects(store.read('chat'), { code: 'ERR_BUFFER_TOO_LARGE' })
  assert.deepEqual(await readFile(file), bytes)
})

test('normalized update returns stay detached from drafts and durable state', async t => {
  const root=await temporary()
  t.after(()=>rm(root,{recursive:true,force:true}))
  const store=createChatJournalStore({dataRoot:root})
  let draft
  const created=await store.update('normalized',()=>({id:'normalized',_storageRevision:1,
    values:{missing:undefined,nan:NaN,date:new Date('2020-01-01T00:00:00Z')},rows:[undefined,Infinity], keys:JSON.parse('{"__proto__":{"safe":true},"constructor":{"label":"own"}}')}))
  assert.deepEqual(created.values,{nan:null,date:'2020-01-01T00:00:00.000Z'})
  assert.deepEqual(created.rows,[null,null])
  assert.equal(Object.hasOwn(created.keys,'__proto__'),true)
  assert.equal(Object.getPrototypeOf(created.keys),Object.prototype)
  created.keys.__proto__.safe=false
  assert.equal((await store.read('normalized')).keys.__proto__.safe,true)
  created.values.nan=100
  const saved=await store.update('normalized',current=>{
    draft=current;current._storageRevision++
    current.values.extra={toJSON(){return {normalized:true}}}
    return current
  })
  assert.deepEqual(saved.values.extra,{normalized:true})
  assert.equal(saved.values.nan,null)
  draft.values.nan=200
  saved.values.extra.normalized=false
  const expected=await store.read('normalized')
  assert.equal(expected.values.nan,null)
  assert.deepEqual(expected.values.extra,{normalized:true})
  assert.deepEqual(await createChatJournalStore({dataRoot:root}).read('normalized'),expected)
})

test('增量写入的 undefined 与磁盘 JSON 一致，后续完整保存和冷读取不会损坏存档', async t => {
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createChatJournalStore({ dataRoot: root })
  await bump(store, 'chat', chat => { chat.delivery = {}; chat.flags = [1] })
  await store.patch('chat', 1, [
    {op:'set',path:['delivery'],value:{taskId:'task',posture:undefined}},
    {op:'set',path:['_storageRevision'],value:2}
  ])
  // Mirrors a full display capture after a fast background checkpoint.
  await bump(store, 'chat', chat => { chat.caption='rendered' })
  const cold = createChatJournalStore({ dataRoot: root })
  assert.deepEqual((await cold.read('chat')).delivery,{taskId:'task'})
  await store.patch('chat',3,[
    {op:'set',path:['delivery','posture'],value:undefined},
    {op:'set',path:['delivery','taskId'],value:undefined},
    {op:'set',path:['flags',0],value:undefined},
    {op:'set',path:['_storageRevision'],value:4}
  ])
  const hot=await store.read('chat'), restored=await createChatJournalStore({dataRoot:root}).read('chat')
  assert.deepEqual(restored,hot)
  assert.deepEqual(restored.delivery,{})
  assert.deepEqual(restored.flags,[null])
})

test('并发冷读只物化一次，外部变版后重新合并读取且副本隔离', async t => {
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  const writer = createChatJournalStore({ dataRoot: root })
  await bump(writer, 'parallel', chat => { chat.cardPayload = 'PARALLEL-COLD-PAYLOAD'; chat.counter = 1 })
  const reader = createChatJournalStore({ dataRoot: root })
  const parse = JSON.parse
  let parses = 0
  t.mock.method(JSON, 'parse', (text, ...args) => {
    if (String(text).includes('PARALLEL-COLD-PAYLOAD')) parses++
    return parse(text, ...args)
  })
  const readBatch = () => Promise.all(Array.from({ length: 20 }, () => reader.read('parallel')))
  const copies = await readBatch()
  assert.equal(parses, 1, '同版本并发读不应重复解析完整快照')
  copies[0].counter = 99
  assert.equal(copies[1].counter, 1)
  await bump(writer, 'parallel', chat => { chat.counter = 2 })
  parses = 0
  assert.ok((await readBatch()).every(chat => chat.counter === 2))
  assert.equal(parses, 1)
})

test('并发物化失败不会留下拒绝的 Promise，修复磁盘后可重读', async t => {
  const root = await temporary()
  t.after(() => rm(root, { recursive: true, force: true }))
  const writer = createChatJournalStore({ dataRoot: root })
  await bump(writer, 'retry-read', chat => { chat.counter = 1 })
  const file = path.join(root, 'chats/retry-read/snapshots/000000000001.json')
  const good = await readFile(file)
  await writeFile(file, '{broken')
  const reader = createChatJournalStore({ dataRoot: root, logger: { warn() {} } })
  const failures = await Promise.allSettled(Array.from({ length: 5 }, () => reader.read('retry-read')))
  assert.ok(failures.every(result => result.status === 'rejected'))
  await writeFile(file, good)
  assert.equal((await reader.read('retry-read')).counter, 1)
})
