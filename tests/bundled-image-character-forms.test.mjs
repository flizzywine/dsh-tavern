import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCharacterUpdates, emptyCharacterSnapshot } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/character-history.js'

test('current outfit is not shared between 林月 and 林月如', () => {
  const definitions = { characters: [{ id: 'a', name: '林月', enabled: true }, { id: 'b', name: '林月如', enabled: true }] }
  const { snapshot } = mergeCharacterUpdates(emptyCharacterSnapshot(), definitions, [{ id: 'a', current: { outfit: '睡衣' } }], { turn: 1 })
  assert.equal(snapshot.characters.a.current.outfit, '睡衣')
  assert.equal(snapshot.characters.b, undefined)
})
