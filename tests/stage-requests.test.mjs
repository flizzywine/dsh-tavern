import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageRequests} from '../tavern-plugin/packages/dsh-tavern-stage/lib/requests.js'

test('stage owns aliases, widget input normalization and original authority',async()=>{
  const authority={origin:'http://game.test'},seen=[]
  const router=createStageRequests({
    stageTimer:{read:args=>({turn:args.turn})},
    judgeRpc:{getJudgeConfig:args=>({config:args})},
    widgetVariables:{read:args=>{seen.push(args);return 'widget'}}
  })
  assert.deepEqual(await router.call('getStageTimer',{turn:3},authority),{turn:3})
  assert.deepEqual(await router.call('getJudgeConfig',{test:1},authority),{config:{test:1}})
  assert.equal(await router.call('readWidgetVariables',{sessionId:'s',_performance:1,_traceId:'trace'},authority),'widget')
  assert.deepEqual(seen,[{sessionId:'s',origin:authority.origin}])
  assert.equal(router.handles('getCardScripts'),false)
  assert.equal(router.handles('constructor'),false)
  assert.equal(router.remoteRead('getStageDirection'),true)
  assert.equal(router.remoteRead('proposeWidgetVariables'),false)
})

test('managed mod routes retain template policy and do not leak tracing fields',async()=>{
  const calls=[],authority={origin:'http://trusted.test'}
  const module=name=>({call(...args){calls.push([name,...args]);return name}})
  const router=createStageRequests({}, {managedModManagement:module('managed'),modConfigHost:module('config'),modService:module('mod')})
  for(const method of ['managedModsList','getModConfig','listMods'])await router.call(method,{cardId:'c',_performance:true,_traceId:'t'},authority,true)
  assert.deepEqual(calls,[['managed','managedModsList',{cardId:'c'},authority,{serverTemplate:true}],['config','getModConfig',{cardId:'c'},authority],['mod','listMods',{cardId:'c'},authority]])
})

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

test('card page RPCs preserve envelopes and remove the old route',async()=>{
  const calls=[]
  const cardPages=Object.fromEntries(['list','read','locate','assets'].map(name=>[name,async args=>{calls.push([name,args]);return name==='read'?null:name}]))
  const router=createStageRequests({cardPages})
  const args={sessionId:'s',page:'map',withHtml:true,ref:{kind:'backgrounds',id:'port'}}
  assert.equal(await router.call('readCardPages',args),'list')
  assert.deepEqual(await router.call('readCardPage',args),{page:null})
  assert.deepEqual(await router.call('locateCardPageAsset',args),{place:'locate'})
  assert.deepEqual(await router.call('listCardPageAssets',args),{assets:'assets'})
  assert.deepEqual(calls,['list','read','locate','assets'].map(name=>[name,args]))
  assert.equal(router.handles('readStatusPanel'),false)
  assert.equal(router.handles('writeCardPageVariables'),false)
})
