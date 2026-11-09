import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageConfigAppearance}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/config-appearance.cjs')
test('disposal prevents pending reads from becoming writes and cancels queued saves',async()=>{
  const calls=[];let resolve
  const view=createStageConfigAppearance({React:{},fields:{},cards:{get:()=>({cardPath:'card'}),set(){throw new Error('late publish')}},rpc:method=>{calls.push(method);return new Promise(done=>resolve=done)}})
  const a=view.saveSkin('s','one'),b=view.saveSkin('s','two')
  const settled=Promise.allSettled([a,b])
  await Promise.resolve();await Promise.resolve()
  view.dispose();resolve({revision:1,extension:{stage:{}}})
  const results=await settled
  assert.ok(results.every(row=>row.status==='rejected'&&row.reason.code==='STAGE_DISABLED'))
  assert.deepEqual(calls,['getCardAssetBindings'])
})
