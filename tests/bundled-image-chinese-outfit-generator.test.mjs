import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeOutfits, parseOutfits } from '../tavern-plugin/packages/dsh-tavern-image-bundled/lib/outfit-generator.js'


test('服装名保留括号原文；夏冬款不会因括号被合并', () => {
  const { outfits } = parseOutfits('[{"name":"月白素纱 旗袍（女装·常服）","upper":"上身穿着一件月白色旗袍","lower":"下身是长下摆"}]')
  assert.equal(outfits[0].name, '月白素纱 旗袍（女装·常服）')
  const parsed = parseOutfits('[{"name":"制服（夏季）","upper":"white summer shirt","lower":"blue skirt"},{"name":"制服（冬季）","upper":"wool coat","lower":"wool pants"}]')
  assert.deepEqual(parsed.outfits.map(item => item.name), ['制服（夏季）', '制服（冬季）'])
  const merged = mergeOutfits([{ name: '制服（夏季）' }], [{ name: '制服（冬季）', upper: 'x', lower: 'y' }, { name: '新衣', upper: 'x', lower: 'y' }])
  assert.equal(merged.added, 2)
  assert.equal(merged.skipped, 0)
})
