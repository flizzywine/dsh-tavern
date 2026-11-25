import { open } from 'node:fs/promises'
import path from 'node:path'
import { crc32 } from 'node:zlib'
import { decodeSlotRanges, encodeSlotRanges, rangeBytes, readSlotRanges } from './conversation-slot-ranges.mjs'

// Isolated format experiment; no integration with production chat paths.
const HEAD = Buffer.from('DSHSLOT3'), COMMIT = Buffer.from('DSHAB003')
const HEAD_BYTES = 20, COMMIT_BYTES = 64, RECORD_BYTES = 12
const SNAPSHOT_AT = HEAD_BYTES + RECORD_BYTES, COMMIT_MAGIC_AT = COMMIT_BYTES - COMMIT.length
const CHECKPOINT_COPIES = 2, MANIFEST_BASE = CHECKPOINT_COPIES * COMMIT_BYTES
const SCAN_BYTES = 64 * 1024, COALESCE_SLOT_BYTES = 2 * 1024 * 1024
const files = ['a.bin', 'b.bin', 'manifest.bin']
const DATA = 1, SNAPSHOT = 2
const bad = () => Object.assign(Error('Invalid conversation slot data'), { code: 'CONVERSATION_SLOT_CORRUPT' })
const moved = () => Object.assign(Error('Conversation slot was reused during a read'), { code: 'CONVERSATION_SLOT_MOVED' })
const writeConflict = () => Object.assign(Error('Conversation manifest changed before write'), { code: 'CONVERSATION_SLOT_WRITE_CONFLICT' })

async function readAt(handle, offset, size, exact = true) {
 const result = Buffer.allocUnsafe(size)
 for (let i = 0; i < size;) {
  const { bytesRead } = await handle.read(result, i, size - i, offset + i)
  if (!bytesRead) {
   if (exact) throw bad()
   return result.subarray(0, i)
  }
  i += bytesRead
 }
 return result
}
async function writeAt(handle, bytes, offset) {
 for (let i = 0; i < bytes.length;) {
  const { bytesWritten } = await handle.write(bytes, i, bytes.length - i, offset + i)
  if (!bytesWritten) throw Error('Short conversation slot write')
  i += bytesWritten
 }
}
function header(generation) {
 const bytes = Buffer.alloc(HEAD_BYTES)
 HEAD.copy(bytes)
 bytes.writeBigUInt64LE(BigInt(generation), 8)
 bytes.writeUInt32LE(crc32(bytes.subarray(0, 16)), 16)
 return bytes
}
// A reader may straddle a slot reuse. A valid frame from another generation
// is not a valid frame of the commit even when kind and length still match.
function recordChecksum(meta, record, seed, position) {
 const bound = Buffer.allocUnsafe(8)
 bound.writeBigUInt64LE(BigInt(position))
 return crc32(record, crc32(meta.subarray(0, 8), crc32(bound, seed)))
}
function encode(record, kind, seed, position) {
 if (!Buffer.isBuffer(record) || !record.length) throw Error('Expected a nonempty conversation record')
 const meta = Buffer.alloc(RECORD_BYTES)
 meta.writeUInt32LE(kind)
 meta.writeUInt32LE(record.length, 4)
 meta.writeUInt32LE(recordChecksum(meta, record, seed, position), 8)
 return Buffer.concat([meta, record])
}
function commitBytes(commit) {
 const bytes = Buffer.alloc(COMMIT_BYTES)
 bytes.writeBigUInt64LE(BigInt(commit.generation))
 bytes.writeBigUInt64LE(BigInt(commit.sequence), 8)
 bytes.writeBigUInt64LE(BigInt(commit.end), 16)
 bytes.writeBigUInt64LE(BigInt(commit.tail), 24)
 bytes.writeUInt32LE(commit.slot, 32)
 bytes.writeBigUInt64LE(BigInt(commit.snapshotLength), 36)
 bytes.writeBigUInt64LE(BigInt(commit.forward), 44)
 bytes.writeUInt32LE(crc32(bytes.subarray(0, 52)), 52)
 COMMIT.copy(bytes, COMMIT_MAGIC_AT)
 return bytes
}
function decodeCommit(bytes, manifestEnd) {
 if (!bytes.subarray(COMMIT_MAGIC_AT).equals(COMMIT) || crc32(bytes.subarray(0, 52)) !== bytes.readUInt32LE(52)) return null
 const [generation, sequence, end, tail, snapshotLength, forward] = [0, 8, 16, 24, 36, 44].map(offset => Number(bytes.readBigUInt64LE(offset)))
 const slot = bytes.readUInt32LE(32)
 if (![generation, sequence, end, tail, snapshotLength, forward].every(Number.isSafeInteger) || !generation || !sequence || slot > 1 || tail < HEAD_BYTES || end <= tail + RECORD_BYTES) return null
 if (forward < SNAPSHOT_AT + (snapshotLength ? rangeBytes(snapshotLength) : 1) || (forward !== end && forward > tail)) return null
 return { generation, sequence, end, tail, slot, snapshotLength, forward, manifestEnd }
}

export function conversationSlotExperiment(dir, { openFile = open, coalesceSlotBytes = COALESCE_SLOT_BYTES, withWriteLock, isReverse, onReadCheck } = {}) {
 function checked(part, work) {
  if (!onReadCheck) return work()
  const start = performance.now()
  try { return work() } finally { onReadCheck(part, performance.now() - start) }
 }
 async function withFile(slot, flags, work) {
  const handle = await openFile(path.join(dir, files[slot]), flags)
  try { return await work(handle) } finally { await handle.close() }
 }
 async function* recordsIn(head, offset, read, seed) {
  while (offset < head.end) {
   if (head.end - offset <= RECORD_BYTES) throw bad()
   const meta = await read(offset, RECORD_BYTES)
   const kind = meta.readUInt32LE(0), size = meta.readUInt32LE(4), next = offset + RECORD_BYTES + size
   if (kind !== (offset === HEAD_BYTES ? SNAPSHOT : DATA) || !size || next > head.end || (next === head.end && offset !== head.tail)) throw bad()
   const payload = await read(offset + RECORD_BYTES, size)
   if (!checked('record', () => recordChecksum(meta, payload, seed, offset) === meta.readUInt32LE(8))) throw bad()
   yield payload
   offset = next
  }
 }
 async function readSlot(head) {
  return withFile(head.slot, 'r', async handle => {
   // The header, commit boundary and checksums are still verified. A small slot
   // just pays for one read rather than two reads for each retained delta.
   const packed = head.end <= coalesceSlotBytes ? await readAt(handle, 0, head.end) : null
   if (!packed && (await handle.stat()).size < head.end) throw bad()
   const read = packed ? (offset, size) => packed.subarray(offset, offset + size) : (offset, size) => readAt(handle, offset, size)
   const expected = header(head.generation)
   const prefix = await read(0, HEAD_BYTES)
   if (!prefix.equals(expected)) {
    if (prefix.subarray(0, HEAD.length).equals(HEAD) && crc32(prefix.subarray(0, 16)) === prefix.readUInt32LE(16)) throw moved()
    throw bad()
   }
   const records = []
   try {
    for await (const payload of recordsIn(head, HEAD_BYTES, read, expected.readUInt32LE(16))) records.push(payload)
   } catch (error) {
    if (error.code === 'CONVERSATION_SLOT_CORRUPT' && !(await readAt(handle, 0, HEAD_BYTES, false)).equals(expected)) throw moved()
    throw error
   }
   if (head.snapshotLength) records[0] = decodeSlotRanges(records[0], head.snapshotLength, head.generation)
   return records
  })
 }
 async function readWindow(project, projectFull, { overlapOpens = false } = {}) {
  async function readCommitted() {
   const opened = overlapOpens ? Promise.allSettled(files.slice(0, 2).map(file => openFile(path.join(dir, file), 'r'))) : null
   try {
    const head = (await recoverCommit({ verifySlot: false }))?.head
    if (!head) return null
    if (!head.snapshotLength) throw bad()
    async function load(handle) {
    const expected = header(head.generation)
    try {
     const prefix = await readAt(handle, 0, HEAD_BYTES)
     if (!checked('generation', () => prefix.equals(expected))) throw bad()
     const snapshot = readSlotRanges((offset, size) => readAt(handle, SNAPSHOT_AT + offset, size), head.snapshotLength, head.generation)
     const forward = []
     if (head.forward < head.end) {
      const packed = head.end - head.forward <= coalesceSlotBytes ? await readAt(handle, head.forward, head.end - head.forward) : null
      const read = packed ? (offset, size) => packed.subarray(offset - head.forward, offset - head.forward + size) : (offset, size) => readAt(handle, offset, size)
      for await (const payload of recordsIn(head, head.forward, read, expected.readUInt32LE(16))) forward.push(payload)
     }
     const result = await project(snapshot, head.snapshotLength, forward)
     return result ?? await projectFull(await readSlot(head))
    } catch (error) {
     if (['CONVERSATION_SLOT_CORRUPT', 'CONVERSATION_SNAPSHOT_CORRUPT', 'CONVERSATION_WINDOW_CORRUPT'].includes(error.code)) {
      const current = await readAt(handle, 0, HEAD_BYTES, false)
      if (current.length === HEAD_BYTES && !current.equals(expected) && current.subarray(0, HEAD.length).equals(HEAD) && crc32(current.subarray(0, 16)) === current.readUInt32LE(16)) throw moved()
     }
     throw error
    }
    }
    if (opened) {
     const slots = await opened
     for (const slot of slots) if (slot.status === 'rejected') throw slot.reason
     return { head, view: await load(slots[head.slot].value) }
    }
    const [view] = await Promise.all([withFile(head.slot, 'r', load), withFile(1 - head.slot, 'r', () => {})])
    return { head, view }
   } finally {
    if (opened) await Promise.all((await opened).filter(slot => slot.status === 'fulfilled').map(slot => slot.value.close()))
   }
  }
  try { return await readCommitted() } catch (error) {
   if (error.code !== 'CONVERSATION_SLOT_MOVED') throw error
   return readCommitted()
  }
 }
 async function copySuffix(slot, generation, position, pinned, latest) {
  const seed = header(generation).readUInt32LE(16)
  await withFile(pinned.slot, 'r', source => withFile(slot, 'r+', async target => {
   const expected = header(latest.generation)
   if (!(await readAt(source, 0, HEAD_BYTES)).equals(expected) || (await source.stat()).size < latest.end) throw bad()
   for await (const payload of recordsIn(latest, pinned.end, (offset, size) => readAt(source, offset, size), expected.readUInt32LE(16))) {
    const frame = encode(payload, DATA, seed, position)
    await writeAt(target, frame, position)
    position += frame.length
   }
   await target.sync()
  }))
 }
 async function recover() {
  try { return await recoverCommit() }
  catch (error) {
   if (error.code !== 'CONVERSATION_SLOT_MOVED') throw error
   return recoverCommit()
  }
 }
 // Manifest offsets need not stay aligned after a torn tail. Verify framing and
 // generation before trusting a commit, including records naming a reused slot.
 async function recoverCommit({ verifySlot = true } = {}) {
  try {
   return await withFile(2, 'r', async handle => {
    const rejected = new Set()
    async function verify(head) {
     const key = head && `${head.slot}:${head.generation}`
     if (!head || rejected.has(key)) return null
     if (!verifySlot) return { head }
     try {
      // Bootstrap requires both names. Only the active slot needs decoding.
      const [records] = await Promise.all([readSlot(head), withFile(1 - head.slot, 'r', () => {})])
      return { head, records }
     } catch (error) {
      if (!['ENOENT', 'CONVERSATION_SLOT_CORRUPT'].includes(error.code)) throw error
      if (error.code === 'ENOENT') rejected.add(key)
      return null
     }
    }
    let end = (await handle.stat()).size
    const small = end <= SCAN_BYTES ? await readAt(handle, 0, end, false) : null
    if (small) end = small.length
    async function readCheckpoints(prefix = undefined) {
     prefix ??= await readAt(handle, 0, MANIFEST_BASE, false)
     const checkpoints = new Map()
     for (let offset = 0; offset < MANIFEST_BASE && offset + COMMIT_BYTES <= prefix.length; offset += COMMIT_BYTES) {
      const raw = prefix.subarray(offset, offset + COMMIT_BYTES)
      const checkpoint = checked('commit', () => decodeCommit(raw, MANIFEST_BASE))
      if (checkpoint) checkpoints.set(raw.toString('hex'), checkpoint)
     }
     return [...checkpoints.values()].sort((a, b) => b.sequence - a.sequence)
    }
    let ordered = await readCheckpoints(small)
    async function newerCheckpoint(sequence) {
     while (ordered[0]?.sequence > sequence) {
      const recovered = await verify(ordered.shift())
      if (recovered) return recovered
     }
     return null
    }
    while (end >= MANIFEST_BASE + COMMIT_BYTES) {
     const start = Math.max(MANIFEST_BASE, end - SCAN_BYTES)
     const bytes = small ? small.subarray(start, end) : await readAt(handle, start, end - start, false)
     // A concurrent truncation can remove the suffix after stat. Its checkpoint
     // was synced first, so refresh the prefix before comparing commit numbers.
     if (bytes.length < end - start) ordered = await readCheckpoints()
     for (let index = bytes.lastIndexOf(COMMIT); index >= 0; index = index ? bytes.lastIndexOf(COMMIT, index - 1) : -1) {
      const stop = index + COMMIT.length, recordStart = start + stop - COMMIT_BYTES
      if (recordStart < MANIFEST_BASE) continue
      const raw = stop >= COMMIT_BYTES ? bytes.subarray(stop - COMMIT_BYTES, stop) : await readAt(handle, recordStart, COMMIT_BYTES, false)
      if (raw.length < COMMIT_BYTES) { ordered = await readCheckpoints(); break }
      const head = checked('commit', () => decodeCommit(raw, recordStart + COMMIT_BYTES))
      if (!head) continue
      const recovered = await newerCheckpoint(head.sequence) ?? await verify(head)
      if (recovered) return recovered
     }
     if (start === MANIFEST_BASE) break
     end = start + COMMIT.length - 1
    }
    return newerCheckpoint(0)
   })
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
 }
 async function reset(slot, flags, generation, records) {
  if (!Array.isArray(records) || !records.length) throw Error('Expected a snapshot and optional retained deltas')
  const prefix = header(generation), seed = prefix.readUInt32LE(16)
  return withFile(slot, flags, async handle => {
   await handle.truncate(0)
   await writeAt(handle, prefix, 0)
   let end = HEAD_BYTES, tail = HEAD_BYTES, forward
   const snapshotLength = isReverse ? records[0].length : 0
   for (const [index, payload] of records.entries()) {
    if (index > 0 && (forward !== undefined || !isReverse?.(payload))) forward ??= end
    const stored = index === 0 && snapshotLength ? encodeSlotRanges(payload, generation) : payload
    tail = end
    const frame = encode(stored, index === 0 ? SNAPSHOT : DATA, seed, tail)
    await writeAt(handle, frame, tail)
    end += frame.length
   }
   await handle.sync()
   return { end, tail, snapshotLength, forward: forward ?? end }
  })
 }
 async function emptySlot(slot) {
  await withFile(slot, 'r+', async handle => {
   await handle.truncate(0)
   await handle.sync()
  })
 }
 async function publish(head, previous) {
  const position = previous?.manifestEnd ?? MANIFEST_BASE
  await withFile(2, previous ? 'r+' : 'wx', async handle => {
   await writeAt(handle, commitBytes(head), position)
   if ((await handle.stat()).size > position + COMMIT_BYTES) await handle.truncate(position + COMMIT_BYTES)
   await handle.sync()
  })
  return { ...head, manifestEnd: position + COMMIT_BYTES }
 }
 function writer(initial) {
  let head = initial, tail = Promise.resolve(), checkpointed
  let rewriting = false, checkpointing = false
  const readers = [0, 0]
  async function withSnapshot(work) {
   const pinned = head
   readers[pinned.slot]++
   let active = true, pending
   try {
    return await work(() => {
     if (!active) throw Error('Conversation snapshot lease has ended')
     return pending ??= readSlot(pinned)
    })
   } finally {
    active = false
    if (pending) await pending.catch(() => {})
    readers[pinned.slot]--
   }
  }
  function exclusive(action) {
   const pending = tail.then(action)
   tail = pending.catch(() => {})
   return pending
  }
  async function lockCurrent(action) {
   if (!withWriteLock) return action()
   return withWriteLock(async () => {
    // Do not fall back to an older commit when deciding whether it is safe to write.
    const current = (await recoverCommit({ verifySlot: false }))?.head
    if (!current || current.manifestEnd !== head.manifestEnd || !commitBytes(current).equals(commitBytes(head))) throw writeConflict()
    return action()
   })
  }
  async function assertActiveBoundary(handle, head) {
   if ((await handle.stat()).size < head.end || !(await readAt(handle, 0, HEAD_BYTES)).equals(header(head.generation))) throw bad()
  }
  function append(payload) {
   return exclusive(() => lockCurrent(async () => {
    const position = head.end
    const frame = encode(payload, DATA, header(head.generation).readUInt32LE(16), position)
    await withFile(head.slot, 'r+', async handle => {
     // Otherwise a positioned write could extend a truncated slot over a hole.
     if (withWriteLock) await assertActiveBoundary(handle, head)
     await writeAt(handle, frame, position)
     await handle.sync()
    })
    head = await publish({ ...head, tail: position, end: position + frame.length, sequence: head.sequence + 1 }, head)
   }))
  }
  async function compact(makeRecords, { maxTemporaryBytes = Infinity, canAllocate = () => true } = {}) {
   if (maxTemporaryBytes !== Infinity && (!Number.isSafeInteger(maxTemporaryBytes) || maxTemporaryBytes < 0)) throw RangeError('Invalid temporary byte budget')
   // Shared-reader leases and off-lock staging ownership have separate gates.
   if (withWriteLock || rewriting) return false
   const pinned = head, generation = pinned.generation + 1, slot = 1 - pinned.slot
   if (readers[slot]) return false
   rewriting = true
   try {
    const records = await makeRecords(await readSlot(pinned))
    const plannedBytes = records.reduce((total, payload, index) => total + RECORD_BYTES + (index === 0 && isReverse ? rangeBytes(payload.length) : payload.length), HEAD_BYTES + COMMIT_BYTES)
    if (plannedBytes > maxTemporaryBytes || !await canAllocate(plannedBytes)) return false
    const { end, tail, snapshotLength, forward } = await reset(slot, 'r+', generation, records)
    const latest = head, suffixBytes = latest.end - pinned.end
    if (suffixBytes) {
     if (plannedBytes + suffixBytes > maxTemporaryBytes || !await canAllocate(suffixBytes + COMMIT_BYTES)) {
      await emptySlot(slot)
      return false
     }
     await copySuffix(slot, generation, end, pinned, latest)
    }
    // Copy the captured suffix off the queue; do not publish if another save has won the race.
    const published = await exclusive(async () => {
     if (head !== latest) return false
     const position = suffixBytes ? end + latest.tail - pinned.end : tail
     head = await publish({ generation, sequence: latest.sequence + 1, slot, end: end + suffixBytes, tail: position, snapshotLength, forward }, latest)
     return true
    })
    if (!published) await emptySlot(slot)
    return published
   } finally { rewriting = false }
  }
  async function writeCheckpointCopies(pinned) {
   const copy = commitBytes(pinned)
   // Keep the append log intact until both checkpoint copies survive a file sync.
   await withFile(2, 'r+', async handle => {
    for (let i = 0; i < CHECKPOINT_COPIES; i++) await writeAt(handle, copy, i * COMMIT_BYTES)
    await handle.sync()
   })
  }
  async function trimCheckpoint(pinned) {
   if (head !== pinned) return false
   await withFile(2, 'r+', async handle => {
    await handle.truncate(MANIFEST_BASE)
    await handle.sync()
   })
   checkpointed = head = { ...pinned, manifestEnd: MANIFEST_BASE }
   return true
  }
  async function checkpoint() {
   if (withWriteLock) return exclusive(() => lockCurrent(async () => {
    const pinned = head
    await withFile(pinned.slot, 'r', handle => assertActiveBoundary(handle, pinned))
    if (checkpointed === pinned) return true
    await writeCheckpointCopies(pinned)
    return trimCheckpoint(pinned)
   }))
   if (checkpointing) throw Error('Conversation checkpoint already running')
   if (checkpointed === head) return true
   checkpointing = true
   try {
    const pinned = head
    await writeCheckpointCopies(pinned)
    return await exclusive(() => trimCheckpoint(pinned))
   } finally { checkpointing = false }
  }
  async function reclaimInactive() {
   const pinned = head, slot = 1 - pinned.slot
   // A checkpoint merely observed on reopen might have only one durable copy.
   if (withWriteLock || rewriting || checkpointed !== pinned || readers[slot]) return false
   rewriting = true
   try {
    await readSlot(pinned)
    // The slot cannot become active while rewriting is held; saves may still append to pinned.slot.
    await emptySlot(slot)
    return true
   } finally { rewriting = false }
  }
  return Object.freeze({ append, compact, checkpoint, reclaimInactive, withSnapshot })
 }
 function create(snapshot, options) {
  const initialize = () => createFiles(snapshot, options)
  return withWriteLock ? withWriteLock(initialize) : initialize()
 }
 async function createFiles(snapshot, { verifyBeforePublish } = {}) {
  const { end, tail, snapshotLength, forward } = await reset(0, 'wx', 1, [snapshot])
  await withFile(1, 'wx', async handle => {
   await writeAt(handle, header(0), 0)
   await handle.sync()
  })
  const head = { generation: 1, sequence: 1, slot: 0, end, tail, snapshotLength, forward }
  if (verifyBeforePublish) await verifyBeforePublish((await readSlot(head))[0])
  return writer(await publish(head))
 }
 async function reopen() {
  const recovered = await recover()
  return recovered && writer(recovered.head)
 }
 return Object.freeze({ create, recover, readWindow, reopen })
}
