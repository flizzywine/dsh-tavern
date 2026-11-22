import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCharacterUpdates, emptyCharacterSnapshot } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/character-history.js'

const definitions = { characters: [{ id: 'xu', name: '许静好', enabled: true }, { id: 'mei', name: '阿梅', enabled: true }, { id: 'fox', name: '阿梅（狐形）', enabled: true }] }

test('the last change still reaches every form of the character', () => {
  const { snapshot } = mergeCharacterUpdates(emptyCharacterSnapshot(), definitions, [
    { id: 'mei', current: { outfit: '红色斗篷' } },
    { id: 'fox', current: { outfit: '只围着一条围巾' } },
  ], { turn: 1 })
  assert.equal(snapshot.characters.mei.current.outfit, '只围着一条围巾')
  assert.equal(snapshot.characters.fox.current.outfit, '只围着一条围巾')
})
