import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageConfigAppearance}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/config-appearance.cjs')
test('skin saves are serialized and preserve unrelated card stage settings',async()=>{
  const calls=[],published=[]
  let choice='old'
  const view=createStageConfigAppearance({React:{},fields:{},cards:{get:()=>({cardPath:'card'}),set:(_,value)=>published.push(value)},rpc:async(method,args)=>{
    calls.push(method)
    if(method==='getCardAssetBindings')return {revision:1,extension:{stage:{theme:'classic',skinChoice:choice}}}
    if(method==='saveCardAssetBindings'){assert.equal(args.patch.stage.theme,'classic');choice=args.patch.stage.skinChoice;return {}}
    return {choice}
  }})
  await Promise.all([view.saveSkin('s','new'),view.saveSkin('s',null)])
  assert.deepEqual(calls,Array(2).fill(['getCardAssetBindings','saveCardAssetBindings','getDialogueBubbles']).flat())
  assert.deepEqual(published,[{choice:'new'},{choice:undefined}])
  view.dispose()
})
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
