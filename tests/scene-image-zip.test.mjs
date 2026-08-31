import test from 'node:test'
import assert from 'node:assert/strict'
import { sceneImageFromZip } from '../tavern-plugin/lib/domain/scene-image-zip.js'
import { diagnosticZip } from '../tavern-plugin/lib/domain/mvu-diagnostics.js'
import { imageZip } from './fixtures/scene-image-zip.mjs'

const data = Buffer.from('fixture-image-bytes'.repeat(20))
test('image ZIP reads stored, deflated and descriptor entries without writing filenames', () => {
  for (const compressed of [false, true]) for (const descriptor of [false, true]) {
    assert.deepEqual(sceneImageFromZip(imageZip(data, { compressed, descriptor }), 1024), data)
  }
  const zip = diagnosticZip([{ path: 'meta.json', content: '{}' }, { path: 'image_0.png', content: data }])
  assert.deepEqual(sceneImageFromZip(zip, 1024), data)
  const deflated = imageZip(data, { compressed: true })
  const start = deflated.readUInt32LE(deflated.length - 6)
  deflated.writeUInt16LE(0x802, 6); deflated.writeUInt16LE(0x802, start + 8)
  assert.deepEqual(sceneImageFromZip(deflated, 1024), data)
})
test('image ZIP rejects ambiguous images, traversal, encryption and directory/header corruption', () => {
  const invalid = [Buffer.alloc(0), Buffer.from('{}'), imageZip(data, { name: '../image.png' }), imageZip(data, { name: 'C:\\image.png' }), imageZip(data, { name: 'image.txt' }), diagnosticZip([{ path: 'a.png', content: data }, { path: 'b.png', content: data }])]
  for (const mutate of [
    (zip, start) => zip.writeUInt16LE(0x801, start + 8),
    (zip, start) => zip.writeUInt32LE(0xffffffff, start + 24),
    (zip, start) => zip.writeUInt32LE(0xffffffff, start + 42),
    (zip, start) => zip.writeUInt32LE(0, start + 16),
    zip => zip.writeUInt16LE(9, 8),
    zip => zip.writeUInt16LE(2, zip.length - 22 + 6),
    zip => { zip[30] ^= 1 },
    zip => { zip[45] ^= 1 }
  ]) {
    const zip = imageZip(data)
    mutate(zip, zip.readUInt32LE(zip.length - 6)); invalid.push(zip)
  }
  for (const zip of invalid) assert.throws(() => sceneImageFromZip(zip, 1024), /ZIP/)
})
test('image ZIP bounds actual decompression, not only claimed size', () => {
  const zip = imageZip(Buffer.alloc(100000), { compressed: true })
  const start = zip.readUInt32LE(zip.length - 6)
  zip.writeUInt32LE(1, 22); zip.writeUInt32LE(1, start + 24)
  assert.throws(() => sceneImageFromZip(zip, 1024), /ZIP/)
  assert.throws(() => sceneImageFromZip(imageZip(data), 4), /ZIP/)
  assert.throws(() => sceneImageFromZip(Buffer.alloc(70000), 1024), /ZIP/)
})
