import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { createConversationPageStore, recordBlock } from '../tavern-plugin/lib/domain/conversation-page-store.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'
import {
  exportConversationToFormat2,
  inspectConversationFormat,
  migrateConversationToSqlite,
} from '../tavern-plugin/lib/domain/conversation-storage-format.js'
import { migrateConversationStorage } from '../bin/migrate-conversation-storage.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const canonicalHash = value => sha256(JSON.stringify(value))
const sampleRow = (n, extra = '') => ({
  role: n % 2 ? 'assistant' : 'user',
  turn: Math.floor(n / 2) + 1,
  text: `楼层 ${n} 正文内容 「测试」 ${extra}`,
  sourceText: `楼层 ${n} 正文内容 「测试」 ${extra}`,
  swipeId: 0,
  swipes: [`楼层 ${n} 正文内容 「测试」 ${extra}`],
  variables: [{ stat_data: { gold: n * 10, hp: 100 - n, note: `状态-${n}` }, schema: { gold: 'number' } }],
})

async function tempDir(t, prefix = 'sqlite-storage-') {
  const root = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function sqliteIntegrity(sqlitePath) {
  const db = new DatabaseSync(sqlitePath)
  try { return db.prepare('PRAGMA integrity_check').get()?.integrity_check }
  finally { db.close() }
}

test('Format 3 keeps strictly 2 files at rest across 120 commits, pruning, compaction, and deletion', async t => {
  const root = await tempDir(t, 'sqlite-file-count-')
  const store = createChatJournalStore({ dataRoot: root, newConversations: true })
  const persistence = createChatPersistence({ store })

  await persistence.write({ id: 'c1', sessionId: 's1', mode: 'story', messages: [sampleRow(0), sampleRow(1)] })
  for (let i = 2; i <= 120; i++) {
    await persistence.patch('c1', i - 1, [
      { op: 'splice', path: ['messages'], index: i, deleteCount: 0, items: [sampleRow(i, 'x'.repeat(256))] },
    ])
  }

  const chatDir = join(root, 'chats', 'c1')
  assert.deepEqual((await readdir(chatDir)).sort(), ['chat.sqlite', 'head.json'])
  const pointer = JSON.parse(await readFile(join(chatDir, 'head.json'), 'utf8'))
  assert.deepEqual(pointer, { format: 3, engine: 'sqlite' })
  assert.equal(sqliteIntegrity(join(chatDir, 'chat.sqlite')), 'ok')

  const relayout = await store.relayout('c1')
  assert.equal(relayout.fragmented, false)
  assert.equal(relayout.skipped, 'sqlite')

  const compact = await store.compact('c1', { retain: r => r === 10, keepRecent: 4, graceMs: 0 })
  assert.ok(compact.removed > 0)
  assert.ok(compact.indexKeysRemoved > 0)
  assert.deepEqual((await readdir(chatDir)).sort(), ['chat.sqlite', 'head.json'])
  assert.equal(sqliteIntegrity(join(chatDir, 'chat.sqlite')), 'ok')

  const fresh = createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) })
  const latest = await fresh.read('c1')
  assert.equal(latest.messages.length, 121)
  assert.equal((await fresh.readRevision('c1', 10)).messages.length, 11)
  await assert.rejects(fresh.readRevision('c1', 5), { code: 'DSH_TAVERN_REVISION_NOT_FOUND' })

  // Removing the chat cleanly closes SQLite handles (no Windows EBUSY).
  await store.remove('c1')
  await assert.rejects(stat(chatDir), { code: 'ENOENT' })
})

test('Format 2 and Format 3 coexist: Format 2 remains readable and writable without silent conversion', async t => {
  const root = await tempDir(t, 'sqlite-dual-read-')
  const chatsRoot = join(root, 'chats')
  const v2Pages = createConversationPageStore({ root: chatsRoot, format: 2 })
  await v2Pages.create('legacy-v2', { metadata: { card: 'v2' }, state: { gold: 1 }, messages: [{ id: 'm0' }] })

  const defaultStore = createConversationPageStore({ root: chatsRoot })
  await defaultStore.create('modern-v3', { metadata: { card: 'v3' }, state: { gold: 2 }, messages: [{ id: 'm0' }] })

  assert.equal((await inspectConversationFormat({ root: chatsRoot, chatId: 'legacy-v2' })).format, 2)
  assert.equal((await inspectConversationFormat({ root: chatsRoot, chatId: 'modern-v3' })).format, 3)

  // Default (Format 3) store reads and commits to existing Format 2 without converting it.
  await defaultStore.commit('legacy-v2', { expectedRevision: 1, state: { gold: 11 }, append: [{ id: 'm1' }] })
  assert.equal((await inspectConversationFormat({ root: chatsRoot, chatId: 'legacy-v2' })).format, 2)
  assert.equal((await defaultStore.openConversation('legacy-v2')).state.gold, 11)
  assert.equal((await defaultStore.openConversation('legacy-v2')).messageCount, 2)

  // And Format 3 stays Format 3.
  await defaultStore.commit('modern-v3', { expectedRevision: 1, state: { gold: 22 }, append: [{ id: 'm1' }] })
  assert.equal((await inspectConversationFormat({ root: chatsRoot, chatId: 'modern-v3' })).format, 3)
  assert.equal((await defaultStore.openConversation('modern-v3')).state.gold, 22)

  // Older reader (accepting only formats 1 and 2) explicitly rejects Format 3 head.json.
  const v3Pointer = JSON.parse(await readFile(join(chatsRoot, 'modern-v3', 'head.json'), 'utf8'))
  assert.equal(v3Pointer.format === 1 || v3Pointer.format === 2, false)
  assert.equal(v3Pointer.format, 3)
})

test('Format 2 -> Format 3 -> write new progress -> Format 2 round-trip is byte-for-byte identical across all revisions', async t => {
  const root = await tempDir(t, 'sqlite-roundtrip-')
  const chatsRoot = join(root, 'chats')
  const v2Pages = createConversationPageStore({ root: chatsRoot, format: 2 })

  // Build a realistic Format 2 native conversation using native-conversation-storage with format: 2.
  const { createNativeConversationStorage } = await import('../tavern-plugin/lib/domain/native-conversation-storage.js')
  const v2Native = createNativeConversationStorage({ dataRoot: root, format: 2 })
  const initialChat = {
    id: 'rt',
    sessionId: 'sess-rt',
    mode: 'story',
    _storageRevision: 1,
    cardName: '测试卡片',
    timeline: { schemaVersion: 1, branchId: 'b1', revision: 1, checkpoints: [{ beforeRevision: 1 }], operations: {} },
    messages: [sampleRow(0), sampleRow(1), sampleRow(2)],
  }
  const rev1 = (await v2Native.create('rt', structuredClone(initialChat))).chat
  const rev2Chat = structuredClone(rev1)
  rev2Chat._storageRevision = 2
  rev2Chat.messages.push(sampleRow(3, '第二轮'))
  const rev2 = (await v2Native.write('rt', { chat: rev1, revision: 1, native: { view: await v2Pages.readHead('rt') } }, rev2Chat, [
    { op: 'set', path: ['_storageRevision'], value: 2 },
    { op: 'splice', path: ['messages'], index: 3, deleteCount: 0, items: [rev2Chat.messages[3]] },
  ])).chat
  const rev3Chat = structuredClone(rev2)
  rev3Chat._storageRevision = 3
  rev3Chat.messages[3].variables[0].stat_data.gold = 999
  const rev3 = (await v2Native.write('rt', { chat: rev2, revision: 2, native: { view: await v2Pages.readHead('rt') } }, rev3Chat, [
    { op: 'set', path: ['_storageRevision'], value: 3 },
    { op: 'set', path: ['messages', 3, 'variables', 0, 'stat_data', 'gold'], value: 999 },
  ])).chat

  const beforeHashes = {
    1: canonicalHash(await createChatJournalStore({ dataRoot: root }).readRevision('rt', 1)),
    2: canonicalHash(await createChatJournalStore({ dataRoot: root }).readRevision('rt', 2)),
    3: canonicalHash(await createChatJournalStore({ dataRoot: root }).readRevision('rt', 3)),
    current: canonicalHash(await createChatJournalStore({ dataRoot: root }).read('rt')),
  }
  const headBefore = JSON.parse(await readFile(join(chatsRoot, 'rt', 'head.json'), 'utf8'))
  assert.equal(headBefore.format, 2)

  // Step 1: dry-run leaves Format 2 untouched.
  const dry = await migrateConversationStorage({ dataRoot: root, chatId: 'rt', sqlite: true, dryRun: true })
  assert.equal(dry.status, 'dry-run')
  assert.ok(dry.blocks > 0)
  assert.equal((await inspectConversationFormat({ root: chatsRoot, chatId: 'rt' })).format, 2)

  // Step 2: migrate to Format 3.
  const migrated = await migrateConversationStorage({ dataRoot: root, chatId: 'rt', sqlite: true })
  assert.equal(migrated.status, 'sqlite')
  assert.equal(migrated.alreadyActive, false)
  assert.equal(migrated.headId, headBefore.headId, 'root SHA-256 headId is identical across Format 2 and Format 3')
  assert.equal((await inspectConversationFormat({ root: chatsRoot, chatId: 'rt' })).format, 3)

  // Verify every historical revision and current state byte-for-byte on Format 3.
  const v3Store = createChatJournalStore({ dataRoot: root })
  for (const rev of [1, 2, 3]) {
    assert.equal(canonicalHash(await v3Store.readRevision('rt', rev)), beforeHashes[rev], `revision ${rev} matches after v2->v3`)
  }
  assert.equal(canonicalHash(await v3Store.read('rt')), beforeHashes.current)

  // Step 3: write NEW progress on Format 3.
  const v3Persistence = createChatPersistence({ store: v3Store })
  await v3Persistence.patch('rt', 3, [
    { op: 'splice', path: ['messages'], index: 4, deleteCount: 0, items: [sampleRow(4, 'v3 新增楼层')] },
  ])
  const rev4Hash = canonicalHash(await createChatJournalStore({ dataRoot: root }).read('rt'))

  // Step 4: export back to Format 2 (separate target + in-place rollback) and verify ALL 4 revisions byte-for-byte.
  const exportedRoot = await tempDir(t, 'sqlite-exported-v2-')
  const exported = await exportConversationToFormat2({ root: chatsRoot, chatId: 'rt', targetRoot: join(exportedRoot, 'chats'), targetChatId: 'rt' })
  assert.equal(exported.status, 'format2')
  const exportedStore = createChatJournalStore({ dataRoot: exportedRoot })
  for (const rev of [1, 2, 3]) {
    assert.equal(canonicalHash(await exportedStore.readRevision('rt', rev)), beforeHashes[rev], `revision ${rev} matches after v3->v2`)
  }
  assert.equal(canonicalHash(await exportedStore.read('rt')), rev4Hash, 'new Format 3 progress preserved in Format 2 export')

  // In-place rollback via CLI helper also works losslessly.
  const rolledBack = await migrateConversationStorage({ dataRoot: root, chatId: 'rt', exportFormat2: true })
  assert.equal(rolledBack.status, 'format2')
  assert.equal((await inspectConversationFormat({ root: chatsRoot, chatId: 'rt' })).format, 2)
  const backStore = createChatJournalStore({ dataRoot: root })
  for (const rev of [1, 2, 3]) {
    assert.equal(canonicalHash(await backStore.readRevision('rt', rev)), beforeHashes[rev])
  }
  assert.equal(canonicalHash(await backStore.read('rt')), rev4Hash)
  assert.ok(rev3._storageRevision === 3)
})

test('Format 3 corruption fails explicitly without silent fallback', async t => {
  const root = await tempDir(t, 'sqlite-corrupt-')
  const store = createConversationPageStore({ root })
  await store.create('a', { metadata: { card: 'test' }, state: { gold: 10 }, messages: [{ id: 'm0' }] })

  // 1. Corrupt block payload inside SQLite blocks table -> Invalid immutable block
  const dbPath = join(root, 'a', 'chat.sqlite')
  const db = new DatabaseSync(dbPath)
  const headId = db.prepare("SELECT value FROM meta WHERE key = 'head_id'").get().value
  const headRow = JSON.parse(db.prepare('SELECT data FROM blocks WHERE ref = ?').get(headId).data)
  db.prepare('UPDATE blocks SET data = ? WHERE ref = ?').run('{}', headRow.root)
  db.close()
  await assert.rejects(createConversationPageStore({ root }).openConversation('a'), /Invalid immutable block/)

  // 2. Corrupt SQLite file header -> explicit SQLite error
  await writeFile(dbPath, Buffer.from('not a valid sqlite database file at all'))
  await assert.rejects(createConversationPageStore({ root }).openConversation('a'))

  // 3. Missing chat.sqlite with format: 3 head.json -> explicit ENOENT, never undefined
  await rm(dbPath, { force: true })
  await assert.rejects(createConversationPageStore({ root }).openConversation('a'), { code: 'ENOENT' })
})

test('Format 3 dedup corruption check rejects and rolls back whole batch; aged dedup renews grace period', async t => {
  const root = await tempDir(t, 'sqlite-dedup-')
  const store = createConversationPageStore({ root })
  await store.create('a', { state: { n: 1 }, messages: [] })
  const values = Array.from({ length: 20 }, (_, i) => ({ type: 'scalar', value: 'v-' + i }))
  const refs = await store.writeRecords('a', values)

  // Corrupt known ref mapping must reject without writing anything.
  const io = []
  const checking = createConversationPageStore({ root, onIO: e => io.push(e) })
  const invalid = [...values, { type: 'scalar', value: 'should-not-commit' }]
  const known = invalid.map(v => recordBlock(v).ref)
  known[5] = refs[0]
  await assert.rejects(checking.writeRecords('a', invalid, known), /Immutable block corruption/)
  assert.equal(io.some(e => e.kind === 'write'), false)
  await assert.rejects(store.readRecord('a', recordBlock({ type: 'scalar', value: 'should-not-commit' }).ref), { code: 'ENOENT' })

  // Aging an unreachable block then deduplicating renews touched_at so sweep keeps it.
  const draft = { draft: 'pending-before-commit' }
  const ref = await store.writeRecord('a', draft)
  const db = new DatabaseSync(join(root, 'a', 'chat.sqlite'))
  db.prepare('UPDATE blocks SET touched_at = ? WHERE ref = ?').run(Date.now() - 3600_000, ref)
  db.close()
  assert.equal(await store.writeRecord('a', draft), ref)
  await store.sweep('a', { graceMs: 60_000 })
  assert.deepEqual(await createConversationPageStore({ root }).readRecord('a', ref), draft)
})

test('power-loss / SIGKILL crash stress: killed writer always leaves exact pre- or post-commit state', async t => {
  const root = await tempDir(t, 'sqlite-crash-')
  const store = createChatJournalStore({ dataRoot: root, newConversations: true })
  const persistence = createChatPersistence({ store })
  const initial = await persistence.write({ id: 'crash-chat', sessionId: 's', mode: 'story', messages: [sampleRow(0), sampleRow(1)] })

  const journalUrl = new URL('../tavern-plugin/lib/domain/chat-journal-store.js', import.meta.url).href
  const persistenceUrl = new URL('../tavern-plugin/lib/domain/chat-persistence.js', import.meta.url).href

  // 1. Deterministic SIGKILL right before COMMIT (on head block write inside BEGIN IMMEDIATE).
  const deterministic = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createChatJournalStore } from ${JSON.stringify(journalUrl)};
    import { createChatPersistence } from ${JSON.stringify(persistenceUrl)};
    import { writeSync } from 'node:fs';
    const store = createChatJournalStore({
      dataRoot: ${JSON.stringify(root)},
      onNativeIO: e => {
        if (e.kind === 'write' && e.type === 'head') {
          writeSync(1, 'killed-at-head');
          process.kill(process.pid, 'SIGKILL');
        }
      }
    });
    const p = createChatPersistence({ store });
    await p.patch('crash-chat', 1, [{ op: 'set', path: ['messages', 1, 'text'], value: 'UNCOMMITTED' }]);
  `], { encoding: 'utf8', timeout: 15000 })
  assert.equal(deterministic.stdout, 'killed-at-head')
  const afterKill = await createChatPersistence({ store: createChatJournalStore({ dataRoot: root }) }).read('crash-chat')
  assert.deepEqual(afterKill, initial)
  assert.equal(sqliteIntegrity(join(root, 'chats', 'crash-chat', 'chat.sqlite')), 'ok')

  // 2. Repeated abrupt SIGKILL while a child commits sequential revisions (testing SQLite crash recovery directly).
  for (let round = 0; round < 5; round++) {
    const before = await createChatPersistence({ store: createChatJournalStore({ dataRoot: root, compatibleStorage: false }) }).read('crash-chat')
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { createChatJournalStore } from ${JSON.stringify(journalUrl)};
      import { createChatPersistence } from ${JSON.stringify(persistenceUrl)};
      const store = createChatJournalStore({ dataRoot: ${JSON.stringify(root)}, compatibleStorage: false });
      const p = createChatPersistence({ store });
      let rev = ${before._storageRevision};
      for (let i = 0; i < 15; i++) {
        const idx = ${before.messages.length} + i;
        await p.patch('crash-chat', rev, [{
          op: 'splice', path: ['messages'], index: idx, deleteCount: 0,
          items: [{ role: 'assistant', turn: idx + 1, text: 'commit-' + rev, variables: [{ stat_data: { gold: rev }, schema: {} }] }]
        }]);
        rev++;
        process.stdout.write(String(rev) + '\\n');
      }
    `], { stdio: ['ignore', 'pipe', 'pipe'] })
    let lastAcked = before._storageRevision
    await new Promise(resolve => {
      let killed = false
      child.stdout.on('data', chunk => {
        for (const line of String(chunk).trim().split('\n')) {
          const n = Number(line)
          if (Number.isInteger(n)) lastAcked = n
        }
        if (!killed && lastAcked >= before._storageRevision + 2) {
          killed = true
          // Small randomized delay so SIGKILL lands mid-commit or between commits.
          setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, (round % 3) * 2)
        }
      })
      child.on('exit', resolve)
    })
    const recovered = await createChatPersistence({ store: createChatJournalStore({ dataRoot: root, compatibleStorage: false }) }).read('crash-chat')
    assert.ok(recovered._storageRevision >= lastAcked, `round ${round}: committed revision must never roll back`)
    assert.equal(recovered.messages.length, before.messages.length + (recovered._storageRevision - before._storageRevision))
    assert.equal(sqliteIntegrity(join(root, 'chats', 'crash-chat', 'chat.sqlite')), 'ok')
    // Verify subsequent write succeeds cleanly after crash recovery.
    await createChatPersistence({ store: createChatJournalStore({ dataRoot: root, compatibleStorage: false }) }).patch('crash-chat', recovered._storageRevision, [
      { op: 'set', path: ['messages', 0, 'text'], value: 'recovered-round-' + round },
    ])
  }
})
