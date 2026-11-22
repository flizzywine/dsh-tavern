import test from 'node:test'
import assert from 'node:assert/strict'
import { expandRosterCalls } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/index.js'

const ru = {
  id: 'r', name: '柳如是', match: 'Liu Rushi', enabled: true,
  traits: { face: 'long black hair, almond eyes' },
  outfits: [
    { id: 'o1', name: '常服', upper: 'pale blue robe', lower: 'white skirt', shoes: 'cloth shoes', default: true },
    { id: 'o2', name: '日常襦裙（女装·常服）', upper: 'light green ruqun top', lower: 'light green long skirt' },
  ],
}
const defs = { characters: [ru] }

test('服装名本身带括号、规划漏写或把状态塞进同一个括号：照样认出', () => {
  const missing = expandRosterCalls('${"name":"Liu Rushi","upperBody":"sfw","lowerBody":"sfw","outfit":"日常襦裙"}$', defs, 'natural', { style: 'tags' })
  assert.match(missing, /light green ruqun top/)
  const merged = expandRosterCalls('${"name":"Liu Rushi","upperBody":"sfw","lowerBody":"sfw","outfit":"日常襦裙（女装·常服，袖口沾墨）"}$', defs, 'natural', { style: 'tags' })
  assert.match(merged, /light green ruqun top/)
  assert.match(merged, /袖口沾墨/)
  assert.doesNotMatch(merged, /女装·常服/)
})
