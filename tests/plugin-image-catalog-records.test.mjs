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
