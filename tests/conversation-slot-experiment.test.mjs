import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, open, readdir, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { conversationSlotExperiment } from './experiments/conversation-slot-store.mjs'
import { createLegacyCompatibleStorage } from '../tavern-plugin/lib/domain/legacy-compatible-storage.js'
import { encodeChatDelta, encodeChatSnapshot, isReverseChatDelta, readChatSlot, readChatSlotRanges } from './experiments/conversation-slot-snapshot.mjs'

const bytes = text => Buffer.from(text)
const recordsOf = recovered => recovered?.records.map(value => value.toString()) ?? null

function apply(fs, op) {
 const existing = fs.get(op.file)
 if (op.type === 'create') fs.set(op.file, Buffer.alloc(0))
 if (op.type === 'truncate') {
  const result = Buffer.alloc(op.length)
  existing.copy(result)
  fs.set(op.file, result)
 }
 if (op.type === 'write') {
  const result = Buffer.alloc(Math.max(existing.length, op.position + op.data.length))
  existing.copy(result)
  op.data.copy(result, op.position)
  fs.set(op.file, result)
 }
}

function memoryStore(initial = new Map(), beforeWrite = async () => {}, beforeRead = async () => {}, options) {
 const fs = new Map(initial), log = []
 const record = op => { apply(fs, op); log.push(op) }
 const openFile = async (filePath, flags) => {
  const file = path.basename(filePath), create = flags === 'wx'
  if (create === fs.has(file)) throw Object.assign(Error(file), { code: create ? 'EEXIST' : 'ENOENT' })
  if (create) record({ type: 'create', file })
  return {
   async stat() { return { size: fs.get(file).length } },
   async read(target, start, count, position) {
    await beforeRead(file, position)
    return { bytesRead: fs.get(file).copy(target, start, Math.min(position, fs.get(file).length), Math.min(position + count, fs.get(file).length)) }
   },
   async write(source, start, count, position) {
    await beforeWrite(file, position)
    record({ type: 'write', file, data: Buffer.from(source.subarray(start, start + count)), position })
    return { bytesWritten: count }
   },
   async truncate(length) { record({ type: 'truncate', file, length }) },
   async sync() { record({ type: 'sync', file }) },
   async close() {},
  }
 }
 return { fs, log, store: conversationSlotExperiment('.', { ...options, openFile }) }
}

function persisted(initial, operations, onlySynced = false) {
 const volatile = new Map(initial), durable = new Map(initial)
 for (const op of operations) {
  apply(volatile, op)
  if (op.type === 'sync') durable.set(op.file, volatile.get(op.file))
 }
 return onlySynced ? durable : volatile
}
const reopen = async state => recordsOf(await memoryStore(state).store.recover())

async function assertPrefixes(initial, ops, before, after) {
 const valid = recovered => assert.ok([before, after].some(state => JSON.stringify(state) === JSON.stringify(recovered)), JSON.stringify(recovered))
 for (let i = 0; i <= ops.length; i++) {
  const prefix = ops.slice(0, i)
  valid(await reopen(persisted(initial, prefix)))
  valid(await reopen(persisted(initial, prefix, true)))
  const op = ops[i]
  if (op?.type !== 'write') continue
  const cuts = [1, Math.floor(op.data.length / 2), op.data.length - 1]
  for (const size of new Set(cuts.filter(size => size > 0 && size < op.data.length))) {
   valid(await reopen(persisted(initial, [...prefix, { ...op, data: op.data.subarray(0, size) }])))
  }
 }
 assert.deepEqual(await reopen(persisted(initial, ops, true)), after)
}

test('initialization syncs both slots before writing the manifest and all interrupted prefixes are empty or complete', async () => {
 const { store, log } = memoryStore()
 await store.create(bytes('initial-state'))
 const publishAt = log.findIndex(op => op.type === 'write' && op.file === 'manifest.bin')
 assert.deepEqual(log.slice(0, publishAt).filter(op => op.type === 'sync').map(op => op.file), ['a.bin', 'b.bin'])
 assert.equal(log.at(-1).type, 'sync')
 assert.equal(log.at(-1).file, 'manifest.bin')
 await assertPrefixes(new Map(), log, null, ['initial-state'])
 const durable = persisted(new Map(), log, true)
 for (const name of durable.keys()) {
  const lostName = new Map(durable)
  lostName.delete(name)
  assert.equal(await reopen(lostName), null, `${name} must survive bootstrap`)
 }
})

test('staged migration retains the original state until a recoverable manifest references the verified copy', async () => {
 const source = bytes('preserved legacy state'), original = Buffer.from(source)
 const { store, log } = memoryStore()
 await store.create(source, { verifyBeforePublish(copy) {
  assert.deepEqual(copy, original)
  assert.ok(!log.some(op => op.file === 'manifest.bin'))
 } })
 for (let i = 0; i <= log.length; i++) {
  const recovered = await memoryStore(persisted(new Map(), log.slice(0, i), true)).store.recover()
  assert.deepEqual(recovered?.records[0] ?? source, original)
  assert.deepEqual(source, original)
 }
 const rejected = memoryStore()
 await assert.rejects(rejected.store.create(source, { verifyBeforePublish() { throw Error('Migration comparison failed') } }), /comparison failed/)
 assert.equal(await rejected.store.recover(), null)
 assert.ok(!rejected.fs.has('manifest.bin'))
})

test('append and A/B reuse recover old or new across crashes without creating another file', async () => {
 const { store, fs, log } = memoryStore()
 const writer = await store.create(bytes('base'))
 async function step(action, before, after) {
  const initial = new Map(fs)
  log.length = 0
  await action()
  assert.ok(!log.some(op => op.type === 'create'))
  await assertPrefixes(initial, log, before, after)
  const committed = persisted(initial, log, true)
  for (const file of [log.find(op => op.type === 'write').file, 'manifest.bin']) {
   const corrupt = new Map(committed), flipped = Buffer.from(corrupt.get(file))
   flipped[flipped.length - 1] ^= 1
   corrupt.set(file, flipped)
   assert.deepEqual(await reopen(corrupt), before)
  }
 }
 await step(() => writer.append(bytes('edit')), ['base'], ['base', 'edit'])
 await step(() => writer.compact(() => [bytes('retained-1')]), ['base', 'edit'], ['retained-1'])
 await step(() => writer.append(bytes('second')), ['retained-1'], ['retained-1', 'second'])
 await step(() => writer.compact(() => [bytes('retained-2')]), ['retained-1', 'second'], ['retained-2'])
 assert.equal((await store.recover()).head.generation, 3)
 assert.equal(fs.size, 3)
})

test('an interrupted retained-history rewrite keeps every acknowledged record recoverable', async () => {
 const { store, fs, log } = memoryStore()
 const writer = await store.create(bytes('base'))
 await writer.append(bytes('middle'))
 await writer.append(bytes('latest'))
 const before = new Map(fs), expected = ['base', 'middle', 'latest']
 log.length = 0
 assert.equal(await writer.compact(rows => rows), true)
 await assertPrefixes(before, log, expected, expected)
 const recovered = await store.recover()
 assert.equal(recovered.head.generation, 2)
 assert.deepEqual(recordsOf(recovered), expected)
 assert.equal(fs.size, 3)
})

test('compaction checks the full staged bytes and publication before writing the inactive slot', async () => {
 const { store, log } = memoryStore()
 const writer = await store.create(bytes('base'))
 log.length = 0
 const budget = 20 + 12 + 4 + 64 // header, frame, payload, manifest commit
 assert.equal(await writer.compact(rows => rows, { maxTemporaryBytes: budget - 1 }), false)
 assert.equal(await writer.compact(rows => rows, { maxTemporaryBytes: budget, canAllocate(required) {
  assert.equal(required, budget)
  return false
 } }), false)
 assert.deepEqual(log, [])
 assert.equal(await writer.compact(rows => rows, { maxTemporaryBytes: budget }), true)
 assert.equal((await store.recover()).head.generation, 2)
})

test('a foreground append can exhaust the rewrite budget without losing the save', async () => {
 const staged = Promise.withResolvers(), finish = Promise.withResolvers()
 const { store, fs } = memoryStore(new Map(), async file => {
  if (file === 'b.bin' && hold) { staged.resolve(); await finish.promise }
 })
 let hold = false
 const writer = await store.create(bytes('base'))
 hold = true
 const compaction = writer.compact(rows => rows, { maxTemporaryBytes: 20 + 12 + 4 + 64 })
 try {
  await staged.promise
  await writer.append(bytes('foreground'))
 } finally { finish.resolve() }
 assert.equal(await compaction, false)
 assert.equal(fs.get('b.bin').length, 0)
 const current = await store.recover()
 assert.equal(current.head.generation, 1)
 assert.deepEqual(recordsOf(current), ['base', 'foreground'])
})

test('compaction catches up a foreground append without making that save wait', async () => {
 const entered = Promise.withResolvers(), finish = Promise.withResolvers()
 let hold = false
 const { store, fs, log } = memoryStore(new Map(), async file => {
  if (hold && file === 'b.bin') { entered.resolve(); await finish.promise }
 })
 const writer = await store.create(bytes('base'))
 const initial = new Map(fs)
 log.length = 0
 hold = true
 const compacted = writer.compact(rows => [Buffer.concat(rows)])
 try {
  await entered.promise
  await writer.append(bytes('foreground'))
  assert.deepEqual(await reopen(fs), ['base', 'foreground'])
 } finally { finish.resolve() }
 assert.equal(await compacted, true)
 await assertPrefixes(initial, log, ['base'], ['base', 'foreground'])
 assert.equal((await store.recover()).head.generation, 2)
})

test('a second racing append prevents an out-of-date catch-up from publishing', async () => {
 const entered = Promise.withResolvers(), finish = Promise.withResolvers()
 const copying = Promise.withResolvers(), copied = Promise.withResolvers()
 let hold = false, writes = 0
 const { store, fs } = memoryStore(new Map(), async file => {
  if (!hold || file !== 'b.bin') return
  writes++
  if (writes === 1) { entered.resolve(); await finish.promise }
  if (writes === 3) { copying.resolve(); await copied.promise }
 })
 const writer = await store.create(bytes('base'))
 hold = true
 const compacted = writer.compact(rows => [Buffer.concat(rows)])
 try {
  await entered.promise
  await writer.append(bytes('first'))
  finish.resolve()
  await copying.promise
  await writer.append(bytes('second'))
 } finally { finish.resolve(); copied.resolve() }
 assert.equal(await compacted, false)
 assert.deepEqual(await reopen(fs), ['base', 'first', 'second'])
 assert.equal((await store.recover()).head.generation, 1)
})

test('a reader pins the old generation against a second slot reuse without blocking saves', async () => {
 const release = Promise.withResolvers()
 const { store, fs } = memoryStore()
 const writer = await store.create(bytes('base'))
 let readAfterRelease
 const reading = writer.withSnapshot(async read => {
  readAfterRelease = read
  await release.promise
  return (await read()).map(row => row.toString())
 })
 try {
  await writer.append(bytes('after-reader-started'))
  assert.equal(await writer.compact(rows => [Buffer.concat(rows)]), true)
  assert.equal(await writer.compact(() => { throw Error('Pinned slot was selected') }), false)
  await writer.append(bytes('after-switch'))
  assert.deepEqual(await reopen(fs), ['baseafter-reader-started', 'after-switch'])
 } finally { release.resolve() }
 assert.deepEqual(await reading, ['base'])
 assert.throws(readAfterRelease, /lease has ended/)
 assert.equal(await writer.compact(rows => [Buffer.concat(rows)]), true)
 assert.equal((await store.recover()).head.generation, 3)
})

test('inactive slot reclaim waits for the checkpoint and old reader, then keeps all acknowledged records', async () => {
 const release = Promise.withResolvers()
 const { store, fs, log } = memoryStore()
 const writer = await store.create(bytes('base'))
 await writer.append(bytes('middle'))
 const expected = ['base', 'middle']
 const reading = writer.withSnapshot(async load => {
  await release.promise
  return (await load()).map(row => row.toString())
 })
 try {
  assert.equal(await writer.compact(rows => rows), true)
  assert.equal(await writer.reclaimInactive(), false)
  assert.equal(await writer.checkpoint(), true)
  assert.equal(await writer.reclaimInactive(), false)
 } finally { release.resolve() }
 assert.deepEqual(await reading, expected)
 const initial = new Map(fs)
 log.length = 0
 assert.equal(await writer.reclaimInactive(), true)
 assert.deepEqual(log.map(({ type, file }) => [type, file]), [['truncate', 'a.bin'], ['sync', 'a.bin']])
 assert.equal(fs.get('a.bin').length, 0)
 assert.equal(fs.size, 3)
 await assertPrefixes(initial, log, expected, expected)
 await writer.append(bytes('after-reclaim'))
 assert.equal(await writer.compact(rows => rows), true)
 assert.deepEqual(await reopen(fs), [...expected, 'after-reclaim'])
 assert.equal(fs.size, 3)
})

test('reopen does not authorize reclaim from a checkpoint until both copies are synced again', async () => {
 const { store, fs } = memoryStore()
 const writer = await store.create(bytes('original'))
 assert.equal(await writer.compact(rows => rows), true)
 assert.equal(await writer.checkpoint(), true)
 const manifest = Buffer.from(fs.get('manifest.bin'))
 manifest[0] ^= 1
 fs.set('manifest.bin', manifest)
 const resumed = await store.reopen()
 assert.equal(await resumed.reclaimInactive(), false)
 assert.equal(await resumed.checkpoint(), true)
 const verified = fs.get('manifest.bin'), half = verified.length / 2
 assert.deepEqual(verified.subarray(0, half), verified.subarray(half))
 assert.equal(await resumed.reclaimInactive(), true)
 assert.deepEqual(await reopen(fs), ['original'])
})

test('inactive slot reclaim leaves the fallback untouched if the active slot fails validation', async () => {
 const { store, fs, log } = memoryStore()
 const writer = await store.create(bytes('base'))
 await writer.append(bytes('acknowledged'))
 assert.equal(await writer.compact(rows => rows), true)
 assert.equal(await writer.checkpoint(), true)
 const inactive = Buffer.from(fs.get('a.bin'))
 const corrupt = Buffer.from(fs.get('b.bin'))
 corrupt[corrupt.length - 1] ^= 1
 fs.set('b.bin', corrupt)
 log.length = 0
 await assert.rejects(writer.reclaimInactive(), { code: 'CONVERSATION_SLOT_CORRUPT' })
 assert.deepEqual(fs.get('a.bin'), inactive)
 assert.deepEqual(log, [])
})

test('replay of inactive slot reclaim tolerates a damaged checkpoint copy', async () => {
 const { store, fs, log } = memoryStore()
 const writer = await store.create(bytes('base'))
 await writer.append(bytes('acknowledged'))
 assert.equal(await writer.compact(rows => rows), true)
 assert.equal(await writer.checkpoint(), true)
 const initial = new Map(fs)
 log.length = 0
 assert.equal(await writer.reclaimInactive(), true)
 for (let prefix = 0; prefix <= log.length; prefix++) {
  for (const syncedOnly of [false, true]) {
   const state = persisted(initial, log.slice(0, prefix), syncedOnly)
   for (const offset of [0, state.get('manifest.bin').length - 1]) {
    const manifest = Buffer.from(state.get('manifest.bin'))
    manifest[offset] ^= 1
    assert.deepEqual(await reopen(new Map(state).set('manifest.bin', manifest)), ['base', 'acknowledged'])
   }
  }
 }
})

test('manifest checkpoint reclaims the append log only after durable copies and preserves the acknowledged revision', async () => {
 const { store, fs, log } = memoryStore()
 const writer = await store.create(bytes('base'))
 for (const value of ['first', 'second', 'third']) await writer.append(bytes(value))
 const expected = ['base', 'first', 'second', 'third']
 const before = new Map(fs), sequence = (await store.recover()).head.sequence
 log.length = 0
 assert.equal(await writer.checkpoint(), true)
 const truncate = log.findIndex(op => op.type === 'truncate')
 assert.equal(log.slice(0, truncate).filter(op => op.type === 'write').length, 2)
 assert.equal(log[truncate - 1].type, 'sync')
 assert.ok(fs.get('manifest.bin').length < before.get('manifest.bin').length)
 await assertPrefixes(before, log, expected, expected)
 const retained = fs.get('manifest.bin')
 const previous = before.get('manifest.bin')
 const lastCommitSize = retained.length / 2
 // Simulate stale append bytes left behind by a partially persisted truncation.
 const staleTail = new Map(fs)
 staleTail.set('manifest.bin', Buffer.concat([retained, previous.subarray(retained.length, -lastCommitSize)]))
 assert.equal((await memoryStore(staleTail).store.recover()).head.sequence, sequence)
 for (const offset of [0, retained.length - 1]) {
  const corrupt = Buffer.from(retained)
  corrupt[offset] ^= 1
  assert.deepEqual(await reopen(new Map(fs).set('manifest.bin', corrupt)), expected)
 }
 const resumed = await store.reopen()
 await resumed.append(bytes('fourth'))
 assert.deepEqual(await reopen(fs), [...expected, 'fourth'])
 assert.equal((await store.recover()).head.sequence, sequence + 1)
})

test('manifest checkpoint does not truncate a foreground commit made while copying the checkpoint', async () => {
 const staged = Promise.withResolvers(), release = Promise.withResolvers()
 let hold = false
 const { store, fs, log } = memoryStore(new Map(), async (file, position) => {
  if (hold && file === 'manifest.bin' && position === 0) { staged.resolve(); await release.promise }
 })
 const writer = await store.create(bytes('base'))
 hold = true
 const checkpoint = writer.checkpoint()
 try {
  await staged.promise
  await writer.append(bytes('newer'))
  assert.deepEqual(await reopen(fs), ['base', 'newer'])
 } finally { release.resolve() }
 assert.equal(await checkpoint, false)
 assert.ok(!log.some(op => op.type === 'truncate' && op.file === 'manifest.bin'))
 assert.deepEqual(await reopen(fs), ['base', 'newer'])
})

test('ranged recovery ignores an unread damaged page, but rejects it on demand and in full recovery', async () => {
 const { store, fs } = memoryStore(undefined, undefined, undefined, { isReverse: isReverseChatDelta })
 const content = id => ({ id, text: Array.from({ length: 4096 }, (_, i) => ((Math.imul(id * 4096 + i, 977813) >>> 0) ^ Math.imul(i, 19121)).toString(36)).join(' ') })
 const chat = { messages: Array.from({ length: 53 }, (_, i) => content(i)) }
 const writer = await store.create(encodeChatSnapshot(chat))
 const snapshot = fs.get('a.bin'), tail = { id: 53, text: 'confirmed' }
 await writer.append(encodeChatDelta([{ op: 'splice', path: ['messages'], index: 53, deleteCount: 0, items: [tail] }]))
 assert.equal(await writer.checkpoint(), true)
 const fallback = rows => readChatSlot(rows, { limit: 50, includeHeader: false })
 const view = async () => (await store.readWindow(readChatSlotRanges, fallback)).view.chat.messages
 assert.deepEqual(await view(), [...chat.messages.slice(4), tail])
 const active = fs.get('a.bin')
 const flip = at => { const damaged = Buffer.from(active); damaged[at] ^= 1; fs.set('a.bin', damaged) }
 flip(20 + 12 + 4100 + 16) // an older floor, not in the requested window
 assert.deepEqual(await view(), [...chat.messages.slice(4), tail])
 await assert.rejects(store.readWindow(async read => read(4096, 1)), { code: 'CONVERSATION_SLOT_CORRUPT' })
 assert.equal(await store.recover(), null)
 await assert.rejects(writer.reclaimInactive(), { code: 'CONVERSATION_SLOT_CORRUPT' })
 flip(snapshot.length - 50) // requested floor or its index page
 await assert.rejects(view(), { code: 'CONVERSATION_SLOT_CORRUPT' })
 flip(active.length - 1) // acknowledged forward delta
 await assert.rejects(view(), { code: 'CONVERSATION_SLOT_CORRUPT' })
 fs.set('a.bin', active)
 const manifest = Buffer.from(fs.get('manifest.bin'))
 manifest[36] ^= 1; manifest[36 + manifest.length / 2] ^= 1
 fs.set('manifest.bin', manifest)
 assert.equal(await store.readWindow(readChatSlotRanges, fallback), null)
})

test('overlapping slot opens keeps the inactive-name check and closes all handles', async () => {
 const root = await mkdtemp(path.join(tmpdir(), 'slot-overlap-'))
 try {
  const store = conversationSlotExperiment(root, { isReverse: isReverseChatDelta })
  await store.create(encodeChatSnapshot({ messages: [{ text: 'saved' }] }))
  const opened = new Set()
  const reader = conversationSlotExperiment(root, { async openFile(file, flags) {
   const handle = await open(file, flags), close = handle.close.bind(handle)
   opened.add(handle)
   handle.close = async () => { opened.delete(handle); await close() }
   return handle
  } })
  const read = () => reader.readWindow(readChatSlotRanges, undefined, { overlapOpens: true })
  assert.deepEqual((await read()).view.chat.messages, [{ text: 'saved' }])
  assert.equal(opened.size, 0)
  await rm(path.join(root, 'b.bin'))
  await assert.rejects(read(), { code: 'ENOENT' })
  assert.equal(opened.size, 0)
 } finally { await rm(root, { recursive: true, force: true }) }
})

test('ranged appendix replay never returns data from an unpublished tail', async () => {
 const ranged = { isReverse: isReverseChatDelta }
 const { store, fs, log } = memoryStore(undefined, undefined, undefined, ranged)
 const writer = await store.create(encodeChatSnapshot({ messages: [{ text: 'before' }] }))
 await writer.checkpoint()
 const initial = new Map(fs)
 log.length = 0
 await writer.append(encodeChatDelta([{ op: 'set', path: ['messages', 0, 'text'], value: 'after' }]))
 const recovered = async state => (await memoryStore(state, undefined, undefined, ranged).store.readWindow(readChatSlotRanges)).view.chat.messages[0].text
 for (let n = 0; n <= log.length; n++) {
  const prefix = log.slice(0, n)
  for (const syncedOnly of [false, true]) {
   assert.equal(await recovered(persisted(initial, prefix, syncedOnly)), n === log.length || (!syncedOnly && log[n - 1]?.file === 'manifest.bin') ? 'after' : 'before')
  }
  const next = log[n]
  if (next?.type === 'write') {
   const torn = { ...next, data: next.data.subarray(0, next.data.length - 1) }
   assert.equal(await recovered(persisted(initial, [...prefix, torn])), 'before')
  }
 }
})

test('ranged reader refuses pages from a new generation after a reused slot', async () => {
 const paused = Promise.withResolvers(), release = Promise.withResolvers()
 const midPage = 20 + 12 + 4100
 let pause = false
 const { store } = memoryStore(undefined, undefined, async (file, position) => {
  if (pause && file === 'a.bin' && position === midPage) { pause = false; paused.resolve(); await release.promise }
 }, { isReverse: () => false })
 const writer = await store.create(Buffer.alloc(8192, 97))
 pause = true
 const pending = store.readWindow(async (read, size) => {
  assert.equal(size, 8192)
  const first = await read(0, 1), last = await read(4096, 1)
  return [first[0], last[0]]
 })
 try {
  await paused.promise
  assert.equal(await writer.compact(() => [Buffer.alloc(8192, 98)]), true)
  assert.equal(await writer.compact(() => [Buffer.alloc(8192, 99)]), true)
 } finally { release.resolve() }
 assert.deepEqual((await pending).view, [99, 99])
})

test('a reader racing with manifest truncation recovers from the synced checkpoint', async () => {
 const reading = Promise.withResolvers(), release = Promise.withResolvers()
 const { store } = memoryStore(new Map(), undefined, async (file, position) => {
  if (file === 'manifest.bin' && position === 0) { reading.resolve(); await release.promise }
 })
 const writer = await store.create(bytes('base'))
 await writer.append(bytes('committed'))
 const recovered = store.recover()
 try {
  await reading.promise
  assert.equal(await writer.checkpoint(), true)
 } finally { release.resolve() }
 assert.deepEqual(recordsOf(await recovered), ['base', 'committed'])
})

test('a reader racing with slot reuse cannot combine records from different generations', async () => {
 const entered = Promise.withResolvers(), resume = Promise.withResolvers()
 const large = Buffer.alloc(3 * 1024 * 1024, 97)
 const deltaOffset = 20 + 12 + large.length
 let pause = false
 const { store } = memoryStore(new Map(), undefined, async (file, position) => {
  if (pause && file === 'a.bin' && position === deltaOffset) {
   pause = false
   entered.resolve()
   await resume.promise
  }
 })
 const writer = await store.create(large)
 await writer.append(bytes('previous'))
 pause = true
 const reading = store.recover()
 try {
  await entered.promise
  assert.equal(await writer.compact(() => [bytes('bridge')]), true)
  assert.equal(await writer.compact(() => [Buffer.alloc(large.length, 98)]), true)
  await writer.append(bytes('replaced'))
 } finally { resume.resolve() }
 // A confirmed reuse forces a fresh manifest read instead of returning a
 // hybrid with generation 1's snapshot and generation 3's same-size delta.
 const recovered = await reading
 assert.equal(recovered?.head.generation, 3)
 assert.equal(recovered.records[0][0], 98)
 assert.equal(recovered.records[1].toString(), 'replaced')
})

test('a lock-free reader in another process refreshes its manifest after slot reuse', async t => {
 const dir = await mkdtemp(path.join(tmpdir(), 'conversation-slot-reader-'))
 t.after(() => rm(dir, { recursive: true, force: true }))
 // Drive reuse directly to inject the race; this does not authorize reclaim.
 const store = conversationSlotExperiment(dir)
 const writer = await store.create(bytes('old'))
 const slotModule = new URL('./experiments/conversation-slot-store.mjs', import.meta.url).href
 const child = spawn(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict'
  import { once } from 'node:events'
  import { open } from 'node:fs/promises'
  import path from 'node:path'
  import { conversationSlotExperiment } from ${JSON.stringify(slotModule)}
  let paused = false
  const store = conversationSlotExperiment(process.argv[1], {
   withWriteLock() { throw Error('The reader took the write lock') },
   async openFile(file, flags) {
    assert.equal(flags, 'r')
    if (!paused && path.basename(file) === 'a.bin') {
     paused = true
     const resume = once(process, 'message')
     process.send('manifest-read')
     await resume
    }
    return open(file, flags)
   },
  })
  const result = await store.recover()
  assert.equal(result?.head.generation, 3)
  assert.deepEqual(result.records.map(String), ['new', 'confirmed'])
  process.disconnect()
 `, dir], { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
 const exit = once(child, 'exit')
 try {
  const [state] = await Promise.race([once(child, 'message'), exit])
  assert.equal(state, 'manifest-read')
  assert.equal(await writer.compact(() => [bytes('bridge')]), true)
  assert.equal(await writer.compact(() => [bytes('new')]), true)
  await writer.append(bytes('confirmed'))
  assert.equal(await writer.checkpoint(), true)
  child.send('continue')
  assert.deepEqual(await exit, [0, null])
 } finally {
  if (child.exitCode === null && child.signalCode === null) child.kill()
  await exit
 }
})

test('recovery reads a small active slot and all its deltas in one read', async () => {
 const reads = []
 const { store } = memoryStore(new Map(), undefined, async (file, position) => { reads.push({ file, position }) })
 const snapshot = 'a'.repeat(256 * 1024)
 const writer = await store.create(bytes(snapshot))
 for (const value of ['one', 'two', 'three']) await writer.append(bytes(value))
 assert.deepEqual(recordsOf(await store.recover()), [snapshot, 'one', 'two', 'three'])
 assert.deepEqual(reads, [{ file: 'manifest.bin', position: 0 }, { file: 'a.bin', position: 0 }])
})

test('fixed-seed save and compaction model survives reopen without growing the file count', async () => {
 const { store, fs } = memoryStore()
 let seed = 0x4d9ce2a7
 const random = () => {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return seed >>> 0
 }
 let writer = await store.create(bytes('start')), expected = ['start']
 for (let i = 0; i < 240; i++) {
  switch (random() % 5) {
   case 0: {
    const compacted = expected.at(-1)
    assert.equal(await writer.compact(() => [bytes(compacted)]), true)
    expected = [compacted]
    break
   }
   case 1: writer = await store.reopen(); break
   case 2: assert.equal(await writer.checkpoint(), true); break
   default: {
    const newRecord = `edit-${i}-${random()}`
    await writer.append(bytes(newRecord))
    expected.push(newRecord)
   }
  }
  assert.deepEqual(await reopen(fs), expected)
  assert.equal(fs.size, 3)
 }
})

test('the existing chat write lock rejects a stale writer in a separate process', async t => {
 const root = await mkdtemp(path.join(tmpdir(), 'conversation-slot-two-writers-')), dir = path.join(root, 'slot')
 t.after(() => rm(root, { recursive: true, force: true }))
 await mkdir(dir)
 const locks = createLegacyCompatibleStorage({ dataRoot: root })
 let held = false
 const store = conversationSlotExperiment(dir, {
  withWriteLock: work => locks.lock('synthetic', async () => {
   held = true
   try { return await work() } finally { held = false }
  }),
  async openFile(file, flags) {
   if (flags !== 'r') assert.ok(held)
   const handle = await open(file, flags)
   if (flags !== 'r') {
    const sync = handle.sync.bind(handle)
    handle.sync = () => { assert.ok(held); return sync() }
   }
   return handle
  },
 })
 const first = await store.create(bytes('base'))
 const slotModule = new URL('./experiments/conversation-slot-store.mjs', import.meta.url).href
 const lockModule = new URL('../tavern-plugin/lib/domain/legacy-compatible-storage.js', import.meta.url).href
 const child = spawn(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict'
  import { once } from 'node:events'
  import { conversationSlotExperiment } from ${JSON.stringify(slotModule)}
  import { createLegacyCompatibleStorage } from ${JSON.stringify(lockModule)}
  const [root, dir] = process.argv.slice(1)
  const locks = createLegacyCompatibleStorage({ dataRoot: root })
  const store = conversationSlotExperiment(dir, { withWriteLock: work => locks.lock('synthetic', work) })
  const stale = await store.reopen()
  const go = once(process, 'message')
  process.send('opened')
  await go
  await assert.rejects(stale.append(Buffer.from('other')), { code: 'CONVERSATION_SLOT_WRITE_CONFLICT' })
  await assert.rejects(stale.checkpoint(), { code: 'CONVERSATION_SLOT_WRITE_CONFLICT' })
  assert.deepEqual((await store.recover()).records.map(String), ['base', 'first'])
  await (await store.reopen()).append(Buffer.from('second'))
  process.disconnect()
 `, root, dir], { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] })
 const exit = once(child, 'exit')
 try {
  const [opened] = await Promise.race([once(child, 'message'), exit])
  assert.equal(opened, 'opened')
  await first.append(bytes('first'))
  assert.equal(await first.checkpoint(), true)
  child.send('continue')
  assert.deepEqual(await exit, [0, null])
  assert.deepEqual(recordsOf(await store.recover()), ['base', 'first', 'second'])
 } finally {
  if (child.exitCode === null && child.signalCode === null) child.kill()
  await exit
 }
})

test('a lock-aware writer does not extend a truncated active slot or checkpoint its commit', async () => {
 const { fs, log, store } = memoryStore(undefined, undefined, undefined, { withWriteLock: async work => work() })
 const writer = await store.create(bytes('base'))
 await writer.append(bytes('acknowledged'))
 fs.set('a.bin', fs.get('a.bin').subarray(0, fs.get('a.bin').length - 1))
 log.length = 0
 await assert.rejects(writer.append(bytes('next')), { code: 'CONVERSATION_SLOT_CORRUPT' })
 await assert.rejects(writer.checkpoint(), { code: 'CONVERSATION_SLOT_CORRUPT' })
 assert.deepEqual(log, [])
})

test('real filesystem uses the same three names on create, append, compact and restart', async t => {
 const dir = await mkdtemp(path.join(tmpdir(), 'conversation-slot-ab-'))
 t.after(() => rm(dir, { recursive: true, force: true }))
 const writer = await conversationSlotExperiment(dir).create(bytes('chat'))
 await writer.append(bytes('reply'))
 assert.equal(await writer.compact(rows => [Buffer.concat(rows)]), true)
 const fresh = conversationSlotExperiment(dir)
 const resumed = await fresh.reopen()
 await resumed.append(bytes('next'))
 assert.equal(await resumed.checkpoint(), true)
 assert.deepEqual(recordsOf(await fresh.recover()), ['chatreply', 'next'])
 assert.deepEqual((await readdir(dir)).sort(), ['a.bin', 'b.bin', 'manifest.bin'])
})
