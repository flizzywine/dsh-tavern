import test from 'node:test'
import assert from 'node:assert/strict'
import { roleToDefinition, charactersFromWorldbookText, mergeCharacters } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/character-import.js'

test('names that share their first two characters get different ids', () => {
  const a = roleToDefinition('苏小雨', { 外貌: '黑长直' }), b = roleToDefinition('苏小美', { 外貌: '短发' })
  assert.ok(a && b)
  assert.notEqual(a.id, b.id)
  assert.equal(roleToDefinition('苏小雨', { 外貌: '黑长直' }).id, a.id, 'the same name keeps the same id')
})

test('merging never adds a second character under an id already in the library', () => {
  const existing = [{ id: 'wb-e88b8fe5b08f', name: '苏小雨', traits: {} }]
  const { characters } = mergeCharacters(existing, [{ id: 'wb-e88b8fe5b08f', name: '苏小美', traits: {} }])
  assert.equal(characters.length, 2)
  assert.equal(new Set(characters.map(c => c.id)).size, 2)
  assert.equal(characters[0].id, 'wb-e88b8fe5b08f')
})
