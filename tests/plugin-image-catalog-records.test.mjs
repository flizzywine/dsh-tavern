import test from 'node:test'
import assert from 'node:assert/strict'
import { createPluginImageCatalog, IMAGE_CHARACTER_SCHEMA } from '../tavern-plugin/lib/domain/plugin-image-catalog.js'

const records = {
  getCharacter: async () => ({}), patchCharacter: async () => ({}), createCharacter: async () => ({}), putReferenceImage: async () => ({}),
}

function catalog() {
  return createPluginImageCatalog({ imageProviders: new Map(), available: async () => true, reportError: () => {} })
}

test('a record library may offer deleteCharacter; hosts can ask whether it does', async () => {
  const plain = catalog()
  plain.registerLibrary('old', { id: 'people', label: '人物库', characters: async () => [], schemaVersion: IMAGE_CHARACTER_SCHEMA, ...records })
  assert.deepEqual(await plain.recordLibraries({}), [{ providerId: 'old/people', label: '人物库', deletes: false }])
  await assert.rejects(plain.record('deleteCharacter', {}, { characterId: 'a' }), { code: 'NOT_SUPPORTED' })

  const deleted = []
  const newer = catalog()
  newer.registerLibrary('new', { id: 'people', label: '人物库', characters: async () => [], schemaVersion: IMAGE_CHARACTER_SCHEMA, ...records,
    async deleteCharacter(input) { deleted.push(input); return { deleted: true } } })
  assert.deepEqual(await newer.recordLibraries({}), [{ providerId: 'new/people', label: '人物库', deletes: true }])
  assert.deepEqual(await newer.record('deleteCharacter', {}, { characterId: 'a' }), { deleted: true, providerId: 'new/people' })
  assert.deepEqual(deleted, [{ characterId: 'a' }])
  await assert.rejects(newer.record('dropEverything', {}, {}), { code: 'INVALID_ARGUMENT' })
})

test('a record library may offer readReferenceImage and the host passes it through', async () => {
  const bytes = new Uint8Array([1, 2, 3]), asked = []
  const plain = catalog()
  plain.registerLibrary('old', { id: 'people', label: '人物库', characters: async () => [], schemaVersion: IMAGE_CHARACTER_SCHEMA, ...records })
  await assert.rejects(plain.record('readReferenceImage', {}, { referenceImage: { id: 'a' } }), { code: 'NOT_SUPPORTED' })
  const newer = catalog()
  newer.registerLibrary('new', { id: 'people', label: '人物库', characters: async () => [], schemaVersion: IMAGE_CHARACTER_SCHEMA, ...records,
    async readReferenceImage(input) { asked.push(input); return { data: bytes, mediaType: 'image/png' } } })
  assert.deepEqual(await newer.record('readReferenceImage', {}, { referenceImage: { id: 'a' } }), { data: bytes, mediaType: 'image/png', providerId: 'new/people' })
  assert.deepEqual(asked, [{ referenceImage: { id: 'a' } }])
})
