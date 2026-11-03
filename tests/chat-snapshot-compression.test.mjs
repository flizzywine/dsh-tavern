import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { gzipSync, gunzipSync } from 'node:zlib'

import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { applyTavernHelperVariableMacros } from '../tavern-plugin/lib/domain/tavern-helper-variable-macros.js'

function fixture() {
  // Intentionally nonalphabetical keys, numeric keys, nulls and inactive swipes.
  const variables = { stat_data: { z: '最后', a: '最先', nested: { y: [null, false, 2], b: '😀\n引号"' }, '10': 10, '2': 2 },
    schema: { z: true, a: false }, initialized_lorebooks: ['世界'], delta_data: { z: '旧->新 (说明)' } }
  variables.stat_data.long = '完整变量保留用于历史回退。'.repeat(100)
  return { id: 'chat', _storageRevision: 1, variables: { z: { b: 1, a: 2 } }, messages: Array.from({ length: 80 }, (_, i) => ({
    id: 'm' + i, role: i % 2 ? 'assistant' : 'user', text: '正文' + i, swipeId: 0,
    variables: [structuredClone(variables), null, { stat_data: { a: i, z: i + 1 } }]
  })) }
}

async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tavern-compressed-snapshot-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const open = () => createChatJournalStore({ dataRoot: root, logger: { warn() {} }, ...options })
  return { root, open, store: open(), snapshots: path.join(root, 'chats/chat/snapshots') }
}

function request(chat) {
  const projected = applyTavernHelperVariableMacros([
    { role: 'system', content: '{{get_chat_variable::z}}\n{{get_message_variable::stat_data}}\n  {{format_message_variable::stat_data}}' },
    ...chat.messages.map(m => ({ role: m.role, content: m.text }))
  ], { chat: chat.variables, message: chat.messages[0].variables[0] })
  return JSON.stringify({ provider: 'test', model: 'test-model', sessionId: 's',
    messages: projected.messages.map((m, i) => ({ id: String(i), role: m.role, content: [{ type: 'text', text: m.content }] })) })
}

test('压缩重启和历史读取保持 JSON 键顺序、JSON/YAML 变量宏及请求字节不变', async t => {
  const { store, open, snapshots } = await setup(t, { frameLimit: 1 })
  const initial = fixture()
  const expectedJson = JSON.stringify(initial), expectedRequest = request(initial)
  await store.update('chat', () => initial)
  const file = await fs.readFile(path.join(snapshots, '000000000001.json.gz'))
  assert.equal(gunzipSync(file).toString(), expectedJson)
  assert.ok(file.length < Buffer.byteLength(expectedJson) / 5)
  assert.equal(JSON.stringify(await open().read('chat')), expectedJson)
  assert.equal(request(await open().read('chat')), expectedRequest)
  await store.update('chat', chat => {
    chat._storageRevision++
    chat.messages[0].variables[0].stat_data.newKey = { z: 3, a: 4 }
    chat.messages[1].variables[2] = { stat_data: { hp: 7 } }
    return chat
  })
  assert.equal(request(await open().readRevision('chat', 1)), expectedRequest)
  assert.equal(JSON.stringify(await open().read('chat')), JSON.stringify(await store.read('chat')))
  const detached = await store.read('chat')
  detached.messages[0].variables[0].stat_data.z = '修改'
  assert.equal((await store.read('chat')).messages[0].variables[0].stat_data.z, '最后')
  assert.equal(detached.messages[1].variables[0].stat_data.z, '最后')
})

for (const damage of ['truncated', 'checksum', 'invalid-json']) test(`损坏 gzip 快照从完整 journal 恢复，不静默回到旧状态：${damage}`, async t => {
  const { store, open, snapshots, root } = await setup(t, { frameLimit: 1 })
  await store.update('chat', () => fixture())
  const expected = await store.update('chat', chat => { chat._storageRevision++; chat.messages[0].text = '新正文'; return chat })
  const target = path.join(snapshots, '000000000002.json.gz')
  let bytes = await fs.readFile(target)
  if (damage === 'truncated') bytes = bytes.subarray(0, bytes.length / 2)
  else if (damage === 'checksum') bytes[bytes.length - 8] ^= 1
  else bytes = gzipSync('{')
  await fs.writeFile(target, bytes)
  assert.deepEqual(await store.read('chat'), expected) // invalidate a warm cache too
  assert.deepEqual(await open().readRevision('chat', 2), expected)
  await fs.rm(path.join(root, 'chats/chat/journals'), { recursive: true })
  await assert.rejects(open().read('chat'), /缺少完整 journal/)
})

for (const method of ['create', 'update', 'patch']) test(`快照发布后 ${method} 保留缓存并能继续追加，文件变化仍触发失效`, async t => {
  const { store, snapshots, open } = await setup(t, { frameLimit: 1 })
  await store.update('chat', () => fixture())
  if (method === 'update') await store.update('chat', chat => { chat._storageRevision++; chat.messages[0].text = '轮换'; return chat })
  else if (method === 'patch') await store.patch('chat', 1, [{ op: 'set', path: ['messages', 0, 'text'], value: '轮换' }, { op: 'set', path: ['_storageRevision'], value: 2 }])
  const revision = method === 'create' ? 1 : 2
  let snapshotReads = 0
  const readFile = fs.readFile
  t.mock.method(fs, 'readFile', async (name, ...args) => {
    if (/[\\/]snapshots[\\/]/.test(String(name))) snapshotReads++
    return readFile(name, ...args)
  })
  syncBuiltinESMExports()
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports() })
  assert.equal((await store.readSlice('chat', [0])).chat.messages[0].text, method === 'create' ? '正文0' : '轮换')
  if (method !== 'create') assert.deepEqual((await store.readChangedSlice('chat', 1)).indices, [0])
  assert.equal((await store.read('chat'))._storageRevision, revision)
  assert.equal(snapshotReads, 0)
  const edited = await store.read('chat')
  edited.messages[0].text = '外部更新'
  await fs.writeFile(path.join(snapshots, String(revision).padStart(12, '0') + '.json.gz'), gzipSync(JSON.stringify(edited)))
  assert.equal((await store.read('chat')).messages[0].text, '外部更新')
  assert.ok(snapshotReads > 0)
  await store.patch('chat', revision, [{ op: 'set', path: ['_storageRevision'], value: revision + 1 }])
  assert.deepEqual(await open().read('chat'), await store.read('chat'))
})
