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

test('同一角色的两个形态（名字只差括号后缀）：宏写本名时按画面线索挑形态', () => {
  const human = { id: 'h', name: '殷雪（人形）', match: 'Yin Xue', enabled: true, traits: { face: 'black hair, human ears' }, outfits: [] }
  const fox = { id: 'f', name: '殷雪（显形）', match: 'Yin Xue', enabled: true, formCues: 'fox ears, 狐尾', traits: { face: 'silver hair, fox ears' }, outfits: [] }
  const forms = { characters: [human, fox] }
  const plain = expandRosterCalls('${"name":"Yin Xue","angle":"from front"}$, 她在窗边', forms, 'natural', { style: 'tags' })
  assert.match(plain, /human ears/)
  const tail = expandRosterCalls('${"name":"Yin Xue","angle":"from front"}$, 她身后的狐尾轻轻摆着', forms, 'natural', { style: 'tags' })
  assert.match(tail, /silver hair/)
  const denied = expandRosterCalls('${"name":"Yin Xue","angle":"from front"}$ 她不是狐耳，也没有狐尾', forms, 'natural', { style: 'tags' })
  assert.match(denied, /human ears/)
  assert.doesNotMatch(denied, /silver hair/)
})
