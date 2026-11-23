import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageViewScope}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/view-scope.cjs')
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
