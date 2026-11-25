import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { applyJsonChangesShared, diffNormalizedJson } from '../../tavern-plugin/lib/domain/json-mutation.js'
import { encodeFloorWindow, readFloorWindow } from './conversation-floor-window.mjs'

// Snapshot adapter for the slot experiment, not a runtime save or migration format.
const MAGIC = Buffer.from('DSHCHAT1'), PREFIX = 12
const DEFLATED = 0x80000000, MAX_HEADER_BYTES = DEFLATED - 1
const DELTA_COMPRESSED = 1, DELTA_REVERSE = 2, DELTA_HEADER_ONLY = 4
const damaged = () => Object.assign(Error('Invalid conversation snapshot'), { code: 'CONVERSATION_SNAPSHOT_CORRUPT' })

function encodeJson(value) {
 const plain = Buffer.from(JSON.stringify(value)), packed = deflateRawSync(plain, { level: 1 })
 return packed.length < plain.length ? { bytes: packed, compressed: true } : { bytes: plain, compressed: false }
}

export function encodeChatSnapshot({ messages, ...header }) {
 const { bytes, compressed } = encodeJson(header)
 if (bytes.length > MAX_HEADER_BYTES) throw RangeError('Conversation snapshot header too large')
 const prefix = Buffer.alloc(PREFIX)
 MAGIC.copy(prefix)
 prefix.writeUInt32LE(bytes.length + (compressed ? DEFLATED : 0), 8)
 return Buffer.concat([prefix, bytes, encodeFloorWindow(messages, { compress: true })])
}

function snapshotLocation(prefix, length) {
 if (prefix.length !== PREFIX || !prefix.subarray(0, 8).equals(MAGIC)) throw damaged()
 const tag = prefix.readUInt32LE(8), index = PREFIX + (tag & MAX_HEADER_BYTES)
 if (index <= PREFIX || index >= length) throw damaged()
 return { tag, index }
}

function openChatSnapshot(snapshot) {
 const { tag, index } = snapshotLocation(snapshot.subarray(0, PREFIX), snapshot.length)
 // The slot recovery has already checked the entire stored record's checksum.
 const bytes = snapshot.subarray(PREFIX, index)
 return {
  header: () => JSON.parse(tag >= DEFLATED ? inflateRawSync(bytes) : bytes),
  floors: options => readFloorWindow((offset, length) => snapshot.subarray(index + offset, index + offset + length), options),
 }
}

export async function readChatSnapshot(snapshot, options = { limit: Number.MAX_SAFE_INTEGER }) {
 const { header, floors } = openChatSnapshot(snapshot)
 const window = await floors(options)
 return { chat: { ...(options.includeHeader === false ? {} : header()), messages: window.floors }, count: window.count, from: window.from }
}

export function encodeChatDelta(changes, { reverse = false } = {}) {
 const { bytes, compressed } = encodeJson(changes)
 const headerOnly = changes.every(({ path }) => typeof path[0] === 'string' && path[0] !== 'messages')
 return Buffer.concat([Buffer.of((compressed ? DELTA_COMPRESSED : 0) | (reverse ? DELTA_REVERSE : 0) | (headerOnly ? DELTA_HEADER_ONLY : 0)), bytes])
}

function deltaTag(frame) {
 if (frame.length < 2 || frame[0] > (DELTA_COMPRESSED | DELTA_REVERSE | DELTA_HEADER_ONLY)) throw damaged()
 return frame[0]
}

function decodeChatDelta(frame) {
 const bytes = frame.subarray(1)
 return JSON.parse(deltaTag(frame) & DELTA_COMPRESSED ? inflateRawSync(bytes) : bytes)
}

export const isReverseChatDelta = frame => Boolean(deltaTag(frame) & DELTA_REVERSE)

function forwardStart(records) {
 let split = 1
 for (; split < records.length && isReverseChatDelta(records[split]); split++) {}
 return split
}

function forwardChanges(frame) {
 if (deltaTag(frame) & DELTA_REVERSE) throw damaged()
 return decodeChatDelta(frame)
}

export async function advanceChatCheckpoint(records) {
 const split = forwardStart(records)
 if (split === records.length) return records
 let { chat: previous } = await readChatSnapshot(records[0])
 const backward = []
 for (let i = split; i < records.length; i++) {
  const next = applyJsonChangesShared(previous, forwardChanges(records[i]))
  backward.push(encodeChatDelta(diffNormalizedJson(next, previous), { reverse: true }))
  previous = next
 }
 // The last newly reversed save lands on the old checkpoint. Its reverse
 // chain is still applicable byte for byte and need not be decoded.
 return [encodeChatSnapshot(previous), ...backward.reverse(), ...records.slice(1, split)]
}

// Visits the checkpoint, its past (newest first), and then later saves.
export async function* replayChatSlot(records) {
 const { chat: checkpoint } = await readChatSnapshot(records[0])
 yield checkpoint
 const split = forwardStart(records)
 let chat = checkpoint
 for (let i = 1; i < split; i++) {
  chat = applyJsonChangesShared(chat, decodeChatDelta(records[i]))
  yield chat
 }
 chat = checkpoint
 for (let i = split; i < records.length; i++) {
  chat = applyJsonChangesShared(chat, forwardChanges(records[i]))
  yield chat
 }
}

async function readTailWindow(snapshot, changes, limit, includeHeader) {
 const { count: base } = await snapshot.floors({ limit: 0 })
 let count = base
 for (const { path, op, index, deleteCount, items } of changes) {
  if (!path.length) return null
  if (path[0] !== 'messages') continue
  if (path.length === 1) {
   if (op !== 'splice' || index !== count || deleteCount !== 0 || !Array.isArray(items)) return null
   count += items.length
  } else if (!Number.isSafeInteger(path[1]) || path[1] < 0 || path[1] >= count) return null
 }
 const from = Math.max(0, count - limit), projected = []
 for (const change of changes) {
  const { path } = change
  if (path[0] !== 'messages') {
   if (includeHeader) projected.push(change)
  } else if (path.length === 1) {
   const skip = Math.max(0, from - change.index)
   if (skip < change.items.length) projected.push({ ...change, index: Math.max(0, change.index - from), items: change.items.slice(skip) })
  } else {
   if (path[1] < from) return null
   projected.push({ ...change, path: ['messages', path[1] - from, ...path.slice(2)] })
  }
 }
 const { floors: messages } = await snapshot.floors({ limit: Math.max(0, base - from) })
 const header = includeHeader ? snapshot.header() : {}
 return { chat: applyJsonChangesShared({ ...header, messages }, projected), count, from }
}

export async function readChatSlotRanges(read, length, forward) {
 const { index } = snapshotLocation(await read(0, PREFIX), length)
 const snapshot = { floors: options => readFloorWindow((offset, size) => read(index + offset, size), options) }
 const changes = []
 for (const frame of forward) {
  const tag = deltaTag(frame)
  if (tag & DELTA_REVERSE) throw damaged()
  if (!(tag & DELTA_HEADER_ONLY)) changes.push(...forwardChanges(frame))
 }
 if (changes.some(change => !change.path.length || change.path[0] === 'messages')) return readTailWindow(snapshot, changes, 50, false)
 const { floors: messages, count, from } = await snapshot.floors({ limit: 50 })
 return { chat: { messages }, count, from }
}

export async function readChatSlot(records, options = { limit: Number.MAX_SAFE_INTEGER }) {
 const split = forwardStart(records)
 if (split === records.length) return readChatSnapshot(records[0], options)
 // Only the historical replay exposes intermediate states. A latest read can
 // reuse copied ancestors across delta frames without modifying the snapshot.
 function* changes(floorsOnly = false) {
  for (let i = split; i < records.length; i++) {
   const frame = records[i], tag = deltaTag(frame)
   // Slot recovery verifies the whole frame, including this projection flag.
   if ((tag & DELTA_REVERSE) || !floorsOnly || !(tag & DELTA_HEADER_ONLY)) yield* forwardChanges(frame)
  }
 }
 const snapshot = openChatSnapshot(records[0]), includeHeader = options.includeHeader !== false
 let mutations
 if (options.limit === 50 && options.before === undefined) {
  const projected = [...changes(!includeHeader)]
  const recent = await readTailWindow(snapshot, projected, options.limit, includeHeader)
  if (recent) return recent
  if (includeHeader) mutations = projected
 }
 mutations ??= changes()
 const { floors } = await snapshot.floors({ limit: Number.MAX_SAFE_INTEGER })
 const chat = applyJsonChangesShared({ ...snapshot.header(), messages: floors }, mutations)
 const { before = chat.messages.length, limit = 50 } = options
 if (!Number.isSafeInteger(before) || before < 0 || before > chat.messages.length || !Number.isSafeInteger(limit) || limit < 0) throw RangeError('Invalid floor window')
 const from = Math.max(0, before - limit)
 return { chat: { ...(includeHeader ? chat : {}), messages: chat.messages.slice(from, before) }, count: chat.messages.length, from }
}
