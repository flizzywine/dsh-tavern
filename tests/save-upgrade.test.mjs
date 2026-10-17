import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSaveUpgrade, saveSessionIds } from '../tavern-plugin/lib/domain/save-upgrade.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'

test('one upgrade job checks host logs before storage and survives repeated clicks', async () => {
  let release, calls = 0, version = 'journal:old', notifications = 0
  const order = [], gate = new Promise(resolve => { release = resolve })
  const service = createSaveUpgrade({
    inspectSessions: async () => { order.push('sessions'); return { ready: true, version: 4 } },
    store: { version: async () => version, readSessionState: async () => ({ id: 'old', sessionId: 's' }),
      upgradeStorage: async (id, options) => {
        calls++; await options.assertCanMigrate({ id }); order.push('storage')
        options.onProgress('converting'); await gate; version = 'native:new'; return { status: 'native' }
      } }, notify: () => notifications++,
  })
  assert.equal((await service.status('old')).storage, 'legacy')
  service.start('old'); service.start('old')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  assert.equal((await service.status('old')).stage, 'converting')
  assert.ok(order.indexOf('sessions') < order.indexOf('storage'))
  release(); await service.dispose()
  assert.equal((await service.status('old')).phase, 'completed')
  assert.equal(notifications, 1)
})

test('failed host conversion cannot report complete or start storage; restart and busy failures can retry', async () => {
  let ready = false, busy = true, version = 'journal:old', writes = 0
  const service = createSaveUpgrade({
    inspectSessions: async () => ({ ready, error: ready ? undefined : '会话原档保留，请重启后重试' }),
    assertIdle: () => { if (busy) throw Error('busy') },
    store: { version: async () => version, readSessionState: async () => ({}), upgradeStorage: async (id, options) => {
      await options.assertCanMigrate({}); writes++; version = 'native:new'; throw Error('lost acknowledgement')
    } },
  })
  service.start('old'); await service.dispose()
  assert.equal((await service.status('old')).error, 'busy')
  busy = false; service.start('old'); await service.dispose()
  assert.equal(writes, 0)
  assert.equal((await service.status('old')).phase, 'failed')
  ready = true; service.start('old'); await service.dispose()
  assert.equal((await service.status('old')).phase, 'completed')
  ready = false
  assert.notEqual((await service.status('old')).phase, 'completed', 'paged storage alone does not complete the whole upgrade')
})

test('unified storage stage preserves history, variables, plugin data and original files', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-save-upgrade-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = createChatJournalStore({ dataRoot: root })
  const initial = { id: 'old', sessionId: 'session', mode: 'story', _storageRevision: 1,
    variables: { hp: 10 }, pluginData: { opaque: [null, 'keep'] },
    messages: [{ role: 'user', turn: 2, text: '行动' }, { role: 'assistant', turn: 2, text: '正文', nativeAnchor: { turn: 2, input: 10, reply: 11 } }] }
  await store.update('old', () => initial)
  await store.patch('old', 1, [{ op: 'set', path: ['_storageRevision'], value: 2 }, { op: 'set', path: ['variables', 'hp'], value: 8 }])
  const before = await store.read('old')
  const originals = new Map()
  async function capture(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) await capture(file); else originals.set(file, await readFile(file))
  } }
  await capture(root)
  const service = createSaveUpgrade({ store, inspectSessions: async chat => {
    assert.equal(chat.sessionId, 'session'); return { ready: true, version: 4 }
  } })
  service.start('old'); await service.dispose()
  assert.equal((await service.status('old')).phase, 'completed')
  const reopened = createChatJournalStore({ dataRoot: root })
  assert.deepEqual(await reopened.read('old'), before)
  assert.deepEqual(await reopened.readRevision('old', 1), initial)
  for (const [file, bytes] of originals) assert.deepEqual(await readFile(file), bytes)
  await reopened.patch('old', 2, [{ op: 'set', path: ['_storageRevision'], value: 3 }, { op: 'set', path: ['variables', 'hp'], value: 7 }])
  assert.equal((await createChatJournalStore({ dataRoot: root }).read('old')).variables.hp, 7)
})

test('upgrade includes the foreground, persistent workers and saved undo workers', () => {
  assert.deepEqual(saveSessionIds({ sessionId: 's', candidateAgent: { sessionId: 'c' }, timeline: { participants: { background: { sessionId: 'b' } } }, rollbackUndo: { foreground: { sessionId: 's' }, background: [{ sessionId: 'old-b' }] } }), ['s', 'c', 'b', 'old-b'])
})
