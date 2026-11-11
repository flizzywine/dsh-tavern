import assert from 'node:assert/strict'
import test from 'node:test'

import { diffJson } from '../tavern-plugin/lib/domain/json-mutation.js'

test('general diff retains arbitrary-input JSON normalization',()=>{
  assert.deepEqual(diffJson({value:undefined,date:new Date('2020-01-01T00:00:00Z')},{value:null,date:new Date('2020-01-01T00:00:00Z')}),[
    {op:'set',path:['value'],value:null}
  ])
})
