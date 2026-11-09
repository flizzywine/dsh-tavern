import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSaveUpgrade, detachSaveSessions, saveSessionIds, unreadySaveSessions } from '../tavern-plugin/lib/domain/save-upgrade.js'
import { storedSessionVersion } from '../tavern-plugin/lib/domain/session-upgrade.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'

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

test('sessions written after startup count as upgraded by their log on disk', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'tavern-session-version-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const project = path.join(root, '--project--')
  for (const [id, files] of [['fresh-bg', ['session.v4.jsonl.zstd']], ['old', ['session.jsonl']], ['migrated', ['session.jsonl', 'session.v4.jsonl.zstd']]]) {
    await mkdir(path.join(project, id), { recursive: true })
    for (const file of files) await writeFile(path.join(project, id, file), '')
  }
  assert.equal(await storedSessionVersion(root, 'fresh-bg'), 4)
  assert.equal(await storedSessionVersion(root, 'missing'), null)
  assert.equal(await storedSessionVersion(root, '../escape'), null)
  const prepared = { refused: { ready: false } }
  const failed = await unreadySaveSessions(['live', 'fresh-bg', 'old', 'migrated', 'missing', 'refused'], {
    live: id => id === 'live' ? { header: { version: 4 } } : undefined,
    stored: id => storedSessionVersion(root, id),
    prepared: id => prepared[id],
  })
  assert.deepEqual(failed, ['old', 'refused'])
})

test('a background or undo session that cannot be upgraded is let go; the foreground one still blocks', async () => {
  const chat = { id: 'old', sessionId: 'front', candidateAgent: { sessionId: 'bad-bg' },
    timeline: { participants: { background: { role: 'background', lifetime: 'chat', sessionId: 'bad-bg', status: 'bound', boundary: 3 } },
      checkpoints: [{ participants: { background: { sessionId: 'bad-bg', boundary: 2 } } }, { participants: { background: { sessionId: 'ok-bg', boundary: 1 } } }] },
    rollbackUndo: { foreground: { sessionId: 'undo-front' }, background: [{ sessionId: 'bad-bg' }] } }
  const detached = detachSaveSessions(structuredClone(chat), ['bad-bg'])
  assert.equal(detached.timeline.participants.background.status, 'needs-session')
  assert.equal(detached.timeline.participants.background.sessionId, '')
  assert.equal(detached.candidateAgent, null)
  assert.deepEqual(detached.timeline.checkpoints.map(checkpoint => Object.keys(checkpoint.participants)), [[], ['background']])
  assert.equal(detached.rollbackUndo, undefined)
  assert.equal(detachSaveSessions(structuredClone(chat), ['unrelated']), undefined)
  assert.throws(() => detachSaveSessions(structuredClone(chat), ['front']), /前台/)

  let current = structuredClone(chat), version = 'journal:old'
  const unready = () => saveSessionIds(current).filter(id => id === 'bad-bg')
  const service = createSaveUpgrade({
    inspectSessions: async value => unready().length ? { ready: false, error: '无法升级', detachable: unready() } : { ready: true, version: 4 },
    detachSessions: async (id, ids) => { current = detachSaveSessions(current, ids) || current },
    store: { version: async () => version, readSessionState: async () => current,
      upgradeStorage: async (id, options) => { await options.assertCanMigrate(current); version = 'native:new'; return { status: 'native' } } },
  })
  assert.equal((await service.status('old')).phase, 'idle', 'a game blocked only by detachable sessions can migrate')
  service.start('old'); await service.dispose()
  assert.equal((await service.status('old')).phase, 'completed')
  assert.equal(current.timeline.participants.background.status, 'needs-session')
})
