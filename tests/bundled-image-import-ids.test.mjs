import test from 'node:test'
import assert from 'node:assert/strict'
import { roleToDefinition, charactersFromWorldbookText } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/character-import.js'

test('names that share their first two characters get different ids', () => {
  const a = roleToDefinition('苏小雨', { 外貌: '黑长直' }), b = roleToDefinition('苏小美', { 外貌: '短发' })
  assert.ok(a && b)
  assert.notEqual(a.id, b.id)
  assert.equal(roleToDefinition('苏小雨', { 外貌: '黑长直' }).id, a.id, 'the same name keeps the same id')
})
