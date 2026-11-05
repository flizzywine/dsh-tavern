import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageHandlers} from '../tavern-plugin/packages/dsh-tavern-stage/lib/rpc.js'

test('scene background resolves only a bound and enabled background',async()=>{
  const ref={packId:'p',kind:'backgrounds',assetId:'room'},descriptor={resource:true,ref,hash:'media'}
  const presentation={available:()=>true,backgrounds:async()=>[{ref,name:'Room',views:{'':{url:descriptor,identity:'image'}}}]}
  const handler=createStageHandlers({readRoundView:async()=>({}),assetRuntime:{consumer:async()=>({presentation,allowedPackIds:['p']})}}).stageSceneBackground
  const result=await handler({sessionId:'g',ref},null,false,{origin:'allowed'})
  assert.equal(result.media.url,descriptor)
  await assert.rejects(()=>handler({sessionId:'g',ref:{...ref,packId:'other'}},null,false,{origin:'allowed'}),/Background unavailable/)
  await assert.rejects(()=>handler({sessionId:'g',ref},null,true,{origin:'allowed'}),/Authenticated stage required/)
})
