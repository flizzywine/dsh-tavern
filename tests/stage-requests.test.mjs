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

test('no stage method sees the browser transport envelope', async () => {
  // The browser transport adds _performance, _traceId and _sessionPatchPage to every request; the mod settings
  // methods check their fields strictly and refused the page with an unknown-field error.
  const envelope = {_performance:{}, _traceId:'t', _sessionPatchPage:'p'}
  const seen = []
  const router = createStageRequests({}, {
    modConfigHost:{call:(method, input) => { seen.push([method, input]); return {ok:true} }},
    autoCastSettings:{read:() => ({}), save:input => { seen.push(['saveAutoCastSettings', input]); return {revision:'r2'} }}
  })
  await router.call('getModConfig', {modId:'dsh.phone', ...envelope})
  await router.call('saveAutoCastSettings', {expectedRevision:'r1', patch:{enabled:true}, ...envelope})
  assert.deepEqual(seen, [['getModConfig', {modId:'dsh.phone'}], ['saveAutoCastSettings', {expectedRevision:'r1', patch:{enabled:true}}]])
})