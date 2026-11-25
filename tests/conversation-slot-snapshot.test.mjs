import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { conversationSlotExperiment } from './experiments/conversation-slot-store.mjs'
import { advanceChatCheckpoint, encodeChatDelta, encodeChatSnapshot, readChatSlot, readChatSnapshot, replayChatSlot } from './experiments/conversation-slot-snapshot.mjs'
import { diffNormalizedJson } from '../tavern-plugin/lib/domain/json-mutation.js'

const chat = {
 id: 'synthetic', _storageRevision: 42, world: { status: ['ready', null] }, extension: { schema: 3 },
 messages: Array.from({ length: 100 }, (_, i) => ({ id: i, variants: ['repeat '.repeat(150), `floor ${i}`] })),
}

test('a compacted slot retains the full latest chat and can decode a bounded floor window after recovery', async t => {
 const dir = await mkdtemp(path.join(tmpdir(), 'conversation-slot-snapshot-'))
 t.after(() => rm(dir, { recursive: true, force: true }))
 const initial = encodeChatSnapshot({ ...chat, messages: chat.messages.slice(0, 70) })
 const writer = await conversationSlotExperiment(dir).create(initial)
 assert.equal(await writer.compact(() => [encodeChatSnapshot(chat)]), true)
 assert.equal(await writer.checkpoint(), true)
 const { head, records } = await conversationSlotExperiment(dir).recover()
 assert.equal(head.generation, 2)
 assert.equal(records.length, 1)
 assert.deepEqual(await readChatSnapshot(records[0]), { chat, count: 100, from: 0 })
 assert.deepEqual(await readChatSnapshot(records[0], { limit: 50 }), {
  chat: { ...chat, messages: chat.messages.slice(-50) }, count: 100, from: 50,
 })
})

test('compressed header and uncompacted revisions preserve earlier edits and the latest window', async () => {
 const base = { ...chat, extension: { body: 'shared header text '.repeat(12000) } }
 const frame = encodeChatSnapshot(base)
 assert.ok(frame.length < JSON.stringify(base.extension).length / 3)
 const middle = structuredClone(base), latest = structuredClone(base)
 middle._storageRevision = 55
 latest._storageRevision = 56
 middle.messages[15].variants[1] = 'new earlier statement'
 latest.messages = [...middle.messages.slice(1), { id: 100, variants: ['appended floor'] }]
 latest.world.status[0] = 'saved'
 const delta = (before, after) => encodeChatDelta(diffNormalizedJson(before, after))
 const records = [frame, delta(base, middle), delta(middle, latest)]
 const states = []
 for await (const state of replayChatSlot(records)) states.push(state)
 assert.deepEqual(states, [base, middle, latest])
 assert.deepEqual((await readChatSlot(records.slice(0, 2))).chat, middle)
 assert.deepEqual((await readChatSlot(records)).chat, latest)
 assert.deepEqual((await readChatSlot(records, { limit: 50 })).chat, { ...latest, messages: latest.messages.slice(-50) })
 assert.deepEqual((await readChatSlot(records, { before: 16, limit: 2 })).chat.messages, latest.messages.slice(14, 16))
})

test('latest-only delta batching agrees with every independently replayed revision', async () => {
 const records = [encodeChatSnapshot(chat)]
 let state = chat, random = 0xa12559bd
 for (let revision = 43; revision < 83; revision++) {
  random = (Math.imul(random, 1664525) + 1013904223) >>> 0
  const next = structuredClone(state)
  const index = random % next.messages.length
  if (revision % 3 === 0) next.messages.splice(index, 1)
  else if (revision % 3 === 1) next.messages[index].variants.push(`added ${revision}`)
  else next.messages.push({ id: revision + 100, variants: ['new floor'] })
  if (revision % 2) next.extension.optional = [index]
  else delete next.extension.optional
  next._storageRevision = revision
  records.push(encodeChatDelta(diffNormalizedJson(state, next)))
  assert.deepEqual((await readChatSlot(records)).chat, next)
  state = next
 }
 let revision = 42
 for await (const historical of replayChatSlot(records)) assert.equal(historical._storageRevision, revision++)
 assert.equal(revision, 83)
})

test('a latest checkpoint preserves reverse history and accepts later forward saves', async t => {
 const dir = await mkdtemp(path.join(tmpdir(), 'conversation-slot-checkpoint-'))
 t.after(() => rm(dir, { recursive: true, force: true }))
 const earlier = { ...chat, _storageRevision: 1, messages: chat.messages.slice(0, 50) }
 const checkpoint = { ...chat, _storageRevision: 9 }
 const latest = { ...checkpoint, _storageRevision: 10, messages: [...checkpoint.messages, { id: 101, variants: ['next'] }] }
 const store = conversationSlotExperiment(dir), writer = await store.create(encodeChatSnapshot(earlier))
 await writer.append(encodeChatDelta(diffNormalizedJson(earlier, checkpoint)))
 assert.equal(await writer.compact(advanceChatCheckpoint), true)
 const compacted = (await store.recover()).records
 assert.deepEqual(await readChatSlot(compacted, { limit: 50 }), { chat: { ...checkpoint, messages: checkpoint.messages.slice(-50) }, count: 100, from: 50 })
 await writer.append(encodeChatDelta(diffNormalizedJson(checkpoint, latest)))
 const { records } = await store.recover(), history = []
 for await (const state of replayChatSlot(records)) history.push(state)
 assert.deepEqual(history, [checkpoint, earlier, latest])
 assert.deepEqual((await readChatSlot(records)).chat, latest)
 assert.equal(await writer.compact(advanceChatCheckpoint), true)
 const rerun = await store.recover()
 assert.equal(rerun.head.generation, 3)
 assert.deepEqual(rerun.records.at(-1), compacted[1])
 const retained = []
 for await (const state of replayChatSlot(rerun.records)) retained.push(state)
 assert.deepEqual(retained, [latest, checkpoint, earlier])
 assert.deepEqual((await readChatSlot(rerun.records)).chat, latest)
})

test('recent reads combine appended floors and header edits without decoding older floors', async () => {
 const packed = encodeChatSnapshot(chat)
 const latest = { ...chat, _storageRevision: 43, world: { status: ['saved'] }, messages: [...chat.messages, { id: 100 }, { id: 101 }] }
 latest.messages[98] = { id: 98, variants: ['edited inside the window'] }
 const delta = encodeChatDelta(diffNormalizedJson(chat, latest))
 // Damage the first floor frame, before the requested window. Slot recovery
 // is tested separately; this asserts what the window decoder touches.
 const floorHeader = 12 + (packed.readUInt32LE(8) & 0x7fffffff)
 packed[floorHeader + 24 + 8] ^= 1
 assert.deepEqual(await readChatSlot([packed, delta], { limit: 50 }), {
  chat: { ...latest, messages: latest.messages.slice(-50) }, count: 102, from: 52,
 })
 assert.deepEqual(await readChatSlot([packed, delta], { limit: 50, includeHeader: false }), {
  chat: { messages: latest.messages.slice(-50) }, count: 102, from: 52,
 })
 await assert.rejects(readChatSlot([packed, delta]), { code: 'CONVERSATION_WINDOW_CORRUPT' })
})

test('floor projection can omit a header-only save without dropping it from the full or historical read', async () => {
 const headerSave = { ...chat, _storageRevision: 43, world: { status: ['changed'.repeat(1000)] } }
 const floorSave = { ...headerSave, _storageRevision: 44, messages: [...chat.messages, { id: 100 }] }
 const records = [encodeChatSnapshot(chat), encodeChatDelta(diffNormalizedJson(chat, headerSave)), encodeChatDelta(diffNormalizedJson(headerSave, floorSave))]
 const { chat: recent } = await readChatSlot(records, { limit: 50, includeHeader: false })
 assert.deepEqual(recent, { messages: floorSave.messages.slice(-50) })
 assert.deepEqual((await readChatSlot(records, { limit: 50 })).chat, { ...floorSave, messages: floorSave.messages.slice(-50) })
 assert.deepEqual((await readChatSlot(records)).chat, floorSave)
 const history = []
 for await (const state of replayChatSlot(records)) history.push(state)
 assert.deepEqual(history, [chat, headerSave, floorSave])
})

test('snapshot framing rejects truncated headers and invalid payload offsets', async () => {
 const frame = encodeChatSnapshot(chat)
 const corrupt = Buffer.from(frame)
 corrupt.writeUInt32LE(frame.length, 8)
 for (const invalid of [frame.subarray(0, 11), corrupt]) {
  await assert.rejects(readChatSnapshot(invalid), { code: 'CONVERSATION_SNAPSHOT_CORRUPT' })
 }
})
