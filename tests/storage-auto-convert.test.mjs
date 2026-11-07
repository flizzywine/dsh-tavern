import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createNativeConversationStorage } from '../tavern-plugin/lib/domain/native-conversation-storage.js'

async function fixture(t) {
  const dataRoot = await mkdtemp(join(tmpdir(), 'storage-auto-convert-'))
  t.after(() => rm(dataRoot, { recursive: true, force: true }))
  return dataRoot
}
async function capture(root) {
  const files = new Map()
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name), key = prefix + entry.name
      if (entry.isDirectory()) await visit(file, key + '/')
      else files.set(key, await readFile(file))
    }
  }
  await visit(root)
  return files
}
function assertBytes(before, root) {
  return Promise.all([...before].map(async ([file, bytes]) => assert.deepEqual(await readFile(join(root, file)), bytes, file)))
}

test('first read automatically imports every revision once and later writes stay native', async t => {
  const dataRoot = await fixture(t), legacy = createChatJournalStore({ dataRoot })
  const first = { id: 'old', _storageRevision: 1, messages: [{ role: 'assistant', turn: 8, text: 'first' }] }
  await legacy.update('old', () => first)
  await legacy.patch('old', 1, [{ op: 'set', path: ['_storageRevision'], value: 2 }, { op: 'set', path: ['messages', 0, 'text'], value: 'second' }])
  const current = await legacy.read('old'), before = await capture(join(dataRoot, 'chats'))
  const store = createChatJournalStore({ dataRoot, autoMigrate: true })
  const [read, header] = await Promise.all([store.read('old'), store.readSessionState('old')])
  assert.deepEqual(read, current)
  assert.equal(header._storageRevision, 2)
  const native = createNativeConversationStorage({ dataRoot })
  assert.deepEqual((await native.read('old', 1)).chat, first)
  assert.deepEqual((await native.read('old', 2)).chat, current)
  assert.equal((await native.readRetentionHeader('old')).legacyInitialRevision, undefined)
  assert.equal((await store.ensureCurrent('old')).historyImported, 0)
  await assertBytes(before, join(dataRoot, 'chats'))
  await store.patch('old', 2, [{ op: 'set', path: ['_storageRevision'], value: 3 }, { op: 'set', path: ['messages', 0, 'text'], value: 'native write' }])
  assert.equal((await native.read('old', 3)).chat.messages[0].text, 'native write')
  await assertBytes(before, join(dataRoot, 'chats'))
  await rm(join(dataRoot, 'chats', 'old', 'snapshots'), { recursive: true, force: true })
  await rm(join(dataRoot, 'chats', 'old', 'journals'), { recursive: true, force: true })
  assert.deepEqual((await store.readRevision('old', 1)).messages, first.messages, 'runtime history reads no longer need legacy files')
})

test('automatic history import crosses sealed journals and snapshot rotations', async t => {
  const dataRoot = await fixture(t), legacy = createChatJournalStore({ dataRoot, frameLimit: 3 })
  await legacy.update('old', () => ({ id: 'old', _storageRevision: 1, messages: [{ role: 'assistant', text: 'revision 1' }] }))
  for (let revision = 2; revision <= 9; revision++) await legacy.patch('old', revision - 1, [
    { op: 'set', path: ['_storageRevision'], value: revision },
    { op: 'set', path: ['messages', 0, 'text'], value: 'revision ' + revision }
  ])
  const expected = []
  for (let revision = 1; revision <= 9; revision++) expected.push(await legacy.readRevision('old', revision))
  const store = createChatJournalStore({ dataRoot, autoMigrate: true })
  assert.deepEqual(await store.read('old'), expected.at(-1))
  const native = createNativeConversationStorage({ dataRoot })
  for (let revision = 1; revision <= 9; revision++) assert.deepEqual((await native.read('old', revision)).chat, expected[revision - 1])
})

test('bounded reads and historical reads share automatic cutover', async t => {
  const dataRoot = await fixture(t), legacy = createChatJournalStore({ dataRoot })
  await legacy.update('old', () => ({ id: 'old', _storageRevision: 1, messages: [{ role: 'assistant', text: 'one' }] }))
  await legacy.patch('old', 1, [{ op: 'set', path: ['_storageRevision'], value: 2 }, { op: 'splice', path: ['messages'], index: 1, deleteCount: 0, items: [{ role: 'assistant', text: 'two' }] }])
  const store = createChatJournalStore({ dataRoot, autoMigrate: true })
  assert.equal((await store.readWindow('old', { limit: 1 })).chat.messages[0].text, 'two')
  assert.equal((await store.readRevision('old', 1)).messages[0].text, 'one')
  assert.deepEqual((await createNativeConversationStorage({ dataRoot }).read('old', 1)).chat.messages, [{ role: 'assistant', text: 'one' }])
})

test('partial native saves with pruned legacy files complete without rescanning revisions', async t => {
  const dataRoot = await fixture(t), native = createNativeConversationStorage({ dataRoot })
  const current = { id: 'old', _storageRevision: 500, messages: [{ role: 'assistant', text: 'current' }] }
  await native.create('old', current, undefined, { migration: true })
  const store = createChatJournalStore({ dataRoot, autoMigrate: true })
  assert.deepEqual(await store.read('old'), current)
  assert.equal((await native.migrationStatus('old')).status, 'native')
  assert.equal((await native.readRetentionHeader('old')).legacyInitialRevision, undefined)
})

test('failed automatic conversion does not fall through to the legacy writer', async t => {
  const dataRoot = await fixture(t), legacy = createChatJournalStore({ dataRoot })
  const first = { id: 'old', _storageRevision: 1, messages: [{ role: 'assistant', text: 'first' }] }
  await legacy.update('old', () => first)
  const snapshot = join(dataRoot, 'chats', 'old', 'snapshots', '000000000001.json'), before = await readFile(snapshot)
  let injected = false
  const store = createChatJournalStore({ dataRoot, autoMigrate: true, onNativeIO: event => {
    if (!injected && event.kind === 'write') { injected = true; throw Error('injected native failure') }
  } })
  await assert.rejects(store.update('old', chat => ({ ...chat, _storageRevision: 2, posture: 'new' })), /injected native failure/)
  assert.equal(await createNativeConversationStorage({ dataRoot }).version('old'), null)
  assert.deepEqual(await readFile(snapshot), before)
  assert.deepEqual(await legacy.read('old'), first)
  await store.update('old', chat => ({ ...chat, _storageRevision: 2, posture: 'new' }))
  assert.equal((await createNativeConversationStorage({ dataRoot }).read('old', 2)).chat.posture, 'new')
  assert.deepEqual(await readFile(snapshot), before)
})

test('revision zero and card workspaces use the same native write path', async t => {
  const dataRoot = await fixture(t)
  await mkdir(join(dataRoot, 'chats'), { recursive: true })
  await writeFile(join(dataRoot, 'chats', 'zero.json'), JSON.stringify({ id: 'zero', messages: [{ role: 'assistant', text: 'opening' }] }), { flag: 'wx' })
  const store = createChatJournalStore({ dataRoot, autoMigrate: true })
  assert.equal((await store.read('zero'))._storageRevision, 0)
  const native = createNativeConversationStorage({ dataRoot })
  assert.equal((await native.read('zero', 0)).chat._storageRevision, 0)
  await store.patch('zero', 0, [{ op: 'set', path: ['_storageRevision'], value: 1 }, { op: 'set', path: ['posture'], value: 'continued' }])
  assert.equal((await native.read('zero', 1)).chat.posture, 'continued')
  const legacy = createChatJournalStore({ dataRoot })
  await legacy.update('card-old', () => ({ id: 'card-old', mode: 'card', _storageRevision: 1, messages: [], workspace: { draft: { name: 'keep' } } }))
  assert.equal((await store.read('card-old')).workspace.draft.name, 'keep')
  assert.equal((await native.read('card-old')).chat.mode, 'card')
  await store.update('card-new', () => ({ id: 'card-new', mode: 'card', _storageRevision: 1, messages: [] }))
  assert.equal((await native.read('card-new')).chat.mode, 'card')
})
