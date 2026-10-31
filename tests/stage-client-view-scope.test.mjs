import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageViewScope}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/view-scope.cjs')
test('view construction rolls back all acquired owners and preserves both failures',()=>{
  const released=[],original=Error('construction'),cleanup=Error('cleanup')
  assert.throws(()=>createStageViewScope(own=>{
    own({dispose(){released.push('loader')}})
    own({dispose(){released.push('music');throw cleanup}})
    throw original
  }),error=>{
    assert.equal(error.errors[0],original)
    assert.equal(error.errors[1].errors[0],cleanup)
    return true
  })
  assert.deepEqual(released,['music','loader'])
})
test('mounted view owns reverse-order cleanup and is terminal after a cleanup failure',()=>{
  const released=[]
  const view=createStageViewScope(own=>{
    own({dispose(){released.push('music')}})
    own({dispose(){released.push('bgm');throw Error('bgm')}})
    return {Host:'host'}
  })
  assert.equal(view.Host,'host')
  assert.throws(()=>view.dispose(),AggregateError)
  view.dispose()
  assert.deepEqual(released,['bgm','music'])
})
