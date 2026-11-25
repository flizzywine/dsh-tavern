import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeFloorWindow, readFloorWindow } from './experiments/conversation-floor-window.mjs'

function instrument(bytes) {
 const calls = []
 return { calls, read(offset, length) {
  calls.push({ offset, length })
  return bytes.subarray(offset, offset + length)
 } }
}
const createFloors = count => Array.from({ length: count }, (_, i) => ({ i, text: `${i}: ` + 'x'.repeat(i < 90 ? 1024 : i), data: [i, null] }))

test('recent 50 floors require one header read and one contiguous payload read', async () => {
 const floors = createFloors(140), packed = encodeFloorWindow(floors), input = instrument(packed)
 assert.deepEqual(await readFloorWindow(input.read), { count: 140, from: 90, floors: floors.slice(-50) })
 assert.equal(input.calls.length, 2)
 assert.ok(input.calls[1].offset > packed.length / 2)
 assert.ok(input.calls[1].length < packed.length / 4)
})

test('bounded paging checks offsets and returns the expected local window', async () => {
 const floors = createFloors(140), packed = encodeFloorWindow(floors), input = instrument(packed)
 assert.deepEqual(await readFloorWindow(input.read, { before: 101, limit: 3 }), { count: 140, from: 98, floors: floors.slice(98, 101) })
 assert.equal(input.calls.length, 4)
 assert.equal(input.calls[1].length, input.calls[2].length)
 assert.deepEqual(await readFloorWindow(input.read, { limit: 1000 }), { count: 140, from: 0, floors })
 await assert.rejects(readFloorWindow(input.read, { before: 141 }), RangeError)
 await assert.rejects(readFloorWindow(input.read, { limit: -1 }), RangeError)
})

test('a partial read does not touch a corrupt earlier floor, but requested corruption is detected', async () => {
 const floors = createFloors(140), packed = encodeFloorWindow(floors), input = instrument(packed)
 await readFloorWindow(input.read)
 const last = input.calls[1]
 const corruptEarly = Buffer.from(packed)
 corruptEarly[input.calls[0].length + 8] ^= 1
 assert.deepEqual((await readFloorWindow(instrument(corruptEarly).read)).floors, floors.slice(-50))
 const corrupt = { code: 'CONVERSATION_WINDOW_CORRUPT' }
 await assert.rejects(readFloorWindow(instrument(corruptEarly).read, { limit: 140 }), corrupt)
 const corruptRecent = Buffer.from(packed)
 corruptRecent[last.offset + 8] ^= 1
 await assert.rejects(readFloorWindow(instrument(corruptRecent).read), corrupt)
 await assert.rejects(readFloorWindow(instrument(packed.subarray(0, last.offset + last.length - 1)).read), corrupt)
 const corruptIndex = Buffer.from(packed)
 const page = instrument(packed)
 await readFloorWindow(page.read, { before: 81, limit: 10 })
 corruptIndex[page.calls[1].offset] ^= 1
 await assert.rejects(readFloorWindow(instrument(corruptIndex).read, { before: 81, limit: 10 }), corrupt)
})

test('compression keeps independently readable floors small and checks stored bytes before inflating', async () => {
 const floors = createFloors(140), plain = encodeFloorWindow(floors), compressed = encodeFloorWindow(floors, { compress: true })
 assert.ok(compressed.length < plain.length / 3)
 const input = instrument(compressed)
 assert.deepEqual((await readFloorWindow(input.read)).floors, floors.slice(-50))
 assert.equal(input.calls.length, 2)
 assert.deepEqual((await readFloorWindow(instrument(compressed).read, { before: 90, limit: 4 })).floors, floors.slice(86, 90))
 const broken = Buffer.from(compressed), window = input.calls[1]
 broken[window.offset + window.length - 1] ^= 1
 await assert.rejects(readFloorWindow(instrument(broken).read), { code: 'CONVERSATION_WINDOW_CORRUPT' })
})

test('empty and short snapshots do not seek into the index', async () => {
 for (const count of [0, 1, 49, 50, 51]) {
  const floors = createFloors(count), input = instrument(encodeFloorWindow(floors))
  assert.deepEqual(await readFloorWindow(input.read), { count, from: Math.max(0, count - 50), floors: floors.slice(-50) })
  assert.equal(input.calls.length, count ? 2 : 1)
 }
})
