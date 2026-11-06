import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeCharacterUpdates, emptyCharacterSnapshot } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/character-history.js'

const definitions = { characters: [{ id: 'xu', name: '许静好', enabled: true }, { id: 'mei', name: '阿梅', enabled: true }, { id: 'fox', name: '阿梅（狐形）', enabled: true }] }

test('two outfit changes in one batch keep the last outfit and the outfit the turn began with', () => {
  const start = { ...emptyCharacterSnapshot(), characters: { xu: { current: { outfit: '运动服', turn: 1 } } } }
  const { snapshot, changes } = mergeCharacterUpdates(start, definitions, [
    { id: 'xu', current: { outfit: '睡衣' } },
    { id: 'xu', current: { outfit: '牛仔裤和外套' } },
  ], { turn: 2 })
  assert.equal(snapshot.characters.xu.current.outfit, '牛仔裤和外套')
  assert.equal(snapshot.characters.xu.current.previous, '运动服')
  assert.deepEqual(changes.filter(c => c.id === 'xu').map(c => c.after), ['睡衣', '牛仔裤和外套'])
})

test('the last change still reaches every form of the character', () => {
  const { snapshot } = mergeCharacterUpdates(emptyCharacterSnapshot(), definitions, [
    { id: 'mei', current: { outfit: '红色斗篷' } },
    { id: 'fox', current: { outfit: '只围着一条围巾' } },
  ], { turn: 1 })
  assert.equal(snapshot.characters.mei.current.outfit, '只围着一条围巾')
  assert.equal(snapshot.characters.fox.current.outfit, '只围着一条围巾')
})
