import test from 'node:test'
import assert from 'node:assert/strict'
import { sameCharacterForm } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/character-forms.js'
import { mergeCharacterUpdates, emptyCharacterSnapshot } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/character-history.js'
import { selectPlannerContext } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/planner-context.js'

const p = name => ({ name })

test('forms continue a name after a separator or share a bracket-stripped name', () => {
  assert.ok(sameCharacterForm(p('阿梅'), p('阿梅（狐形）')))
  assert.ok(sameCharacterForm(p('阿梅'), p('阿梅·狐形')))
  assert.ok(sameCharacterForm(p('殷雪（人形）'), p('殷雪（显形）')))
  assert.ok(sameCharacterForm(p('A Mei'), p('A Mei fox form')))
})

test('a bare name prefix is a different person', () => {
  assert.ok(!sameCharacterForm(p('林月'), p('林月如')))
  assert.ok(!sameCharacterForm(p('Lin Yue'), p('Lin Yueru')))
  assert.ok(!sameCharacterForm(p('Anne'), p('Anne-Marie')))
})

test('current outfit is not shared between 林月 and 林月如', () => {
  const definitions = { characters: [{ id: 'a', name: '林月', enabled: true }, { id: 'b', name: '林月如', enabled: true }] }
  const { snapshot } = mergeCharacterUpdates(emptyCharacterSnapshot(), definitions, [{ id: 'a', current: { outfit: '睡衣' } }], { turn: 1 })
  assert.equal(snapshot.characters.a.current.outfit, '睡衣')
  assert.equal(snapshot.characters.b, undefined)
})

test('planner context brings in forms of a named character, not other people sharing a prefix', () => {
  const definitions = { characters: [{ id: 'a', name: '林月', enabled: true }, { id: 'b', name: '林月如', enabled: true }, { id: 'c', name: '林月（幼时）', enabled: true }] }
  const context = selectPlannerContext({ entries: [], text: '林月推门进来。', definitions })
  assert.deepEqual(context.definitions.characters.map(c => c.id).sort(), ['a', 'c'])
})
