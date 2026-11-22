import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageRequests} from '../tavern-plugin/packages/dsh-tavern-stage/lib/requests.js'

test('disposed request lifetime refuses new calls and suppresses late results',async()=>{
  let resolve,called=0
  const pending=new Promise(done=>resolve=done)
  const router=createStageRequests({directorProbeRpc:{getDirectorToolSupport(){called++;return pending}}})
  const result=router.call('getDirectorToolSupport',{})
  router.dispose();resolve({models:{}})
  await assert.rejects(result,{code:'STAGE_UNAVAILABLE'})
  await assert.rejects(router.call('getDirectorToolSupport',{}),{code:'STAGE_UNAVAILABLE'})
  assert.equal(called,1)
  const other=createStageRequests({})
  await assert.rejects(other.call('constructor',{}),{code:'STAGE_METHOD_UNKNOWN'})
})
