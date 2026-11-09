import assert from 'node:assert/strict'
import test from 'node:test'

import { applyJsonChangesShared, diffJson, diffNormalizedJson } from '../tavern-plugin/lib/domain/json-mutation.js'

test('normalized diff matches the general JSON contract without another serialization pass', t => {
  const before={id:'chat',messages:[{text:'old',variables:{gold:1}}],values:{keep:true,remove:1}}
  const after={id:'chat',messages:[{text:'new',variables:{gold:2}},{text:'tail'}],values:{keep:true}}
  const expected=diffJson(before,after)
  const stringify=JSON.stringify;let calls=0
  t.mock.method(JSON,'stringify',function(...args){calls++;return stringify(...args)})
  assert.deepEqual(diffNormalizedJson(before,after),expected)
  assert.equal(calls,0)
})

test('general diff retains arbitrary-input JSON normalization',()=>{
  assert.deepEqual(diffJson({value:undefined,date:new Date('2020-01-01T00:00:00Z')},{value:null,date:new Date('2020-01-01T00:00:00Z')}),[
    {op:'set',path:['value'],value:null}
  ])
})

test('set does not traverse the discarded old subtree', () => {
  const input={payload:{get unused(){throw new Error('old subtree traversed')}}}
  assert.deepEqual(applyJsonChangesShared(input,[{op:'set',path:['payload'],value:{new:1}}]),{payload:{new:1}})
})
