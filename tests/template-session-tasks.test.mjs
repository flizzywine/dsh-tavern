import test from 'node:test'
import assert from 'node:assert/strict'
import { createTemplateSessionTasks } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/session-tasks.js'
import { createNativeTemplateConnection } from '../tavern-plugin/lib/vendor/st-prompt-template/host-build/native-connection.js'
import { createFullTemplateRuntime } from './fixtures/browser-template-transport.mjs'
const deferred = () => { let resolve, reject;const promise = new Promise((a,b) => {resolve=a;reject=b});return {promise,resolve,reject} }

async function harness({saveGate, syncGate, receiptFailure=false}={}) {
  const trace=[]
  let state={stateRevision:1,chat:[{mes:'opening',variables:[{hp:7}]}],chat_metadata:{variables:{}}}
  const connection=await createNativeTemplateConnection({sessionId:'s',services:{onPersistenceError(){}},rpc:async(method,args)=>{
    trace.push(method)
    if(method==='getFullPromptTemplateState') return {state:structuredClone(state),environment:{dsh:{model:'old'},extension_settings:{EjsTemplate:{},variables:{global:{}}}}}
    if(method==='saveFullPromptTemplateState') {
      if(saveGate) await saveGate.promise
      state={...structuredClone(args.state),stateRevision:state.stateRevision+1}
      return {updated:true,state:structuredClone(state)}
    }
    throw Error(method)
  }})
  const runtime=createFullTemplateRuntime({publishSignal(){}})
  runtime.dispatch.touch('s','browser',true)
  const plugin={
    refresh:async()=>trace.push('refresh'),
    project:async(name,input)=>{
      trace.push('project:'+name)
      if(name==='fail')throw Error('upstream error')
      if(input?.template==='save') {connection.snapshot.chat[0].variables[0].hp++;void connection.callbacks.saveChatConditional(connection.snapshot).catch(()=>{})}
      return {ok:true,text:name,model:connection.snapshot.dsh.model,scopes:input?.context?.scopes}
    },
    synchronize:async()=>{trace.push('sync');if(syncGate)await syncGate.promise;return {synchronized:true}},
    dispose:async()=>trace.push('dispose')
  }
  const tasks=createTemplateSessionTasks({connection,plugin,dispatch:{
    claim:async()=>{trace.push('claim');return runtime.dispatch.claim('s','browser',true)},
    start:async w=>{trace.push('start');return runtime.dispatch.start('s',w.event.id,w.leaseToken,'browser')},
    complete:async(w,r)=>{trace.push('complete');if(receiptFailure)throw Error('receipt disconnected');return runtime.dispatch.complete('s',w.event.id,r.args,'browser',w.leaseToken,r.error)}
  }})
  trace.length=0
  return {tasks,runtime,trace,state:()=>state}
}

test('一次保存冲突后可重新同步历史并处理新任务，不重放失败模板', async () => {
  const saveGate = deferred(), h = await harness({ saveGate })
  const output = h.runtime.forSession('s').render('save')
  const rejected = assert.rejects(output, /模板读取版本已过期/)
  await new Promise(resolve => setImmediate(resolve))
  const draining = h.tasks.processNext()
  await new Promise(resolve => setImmediate(resolve))
  saveGate.reject(new Error('模板读取版本已过期'))
  await draining
  await rejected
  assert.equal(h.state().chat[0].variables[0].hp, 7)
  await h.tasks.synchronize()
  const next = h.runtime.forSession('s').render('fresh')
  await new Promise(resolve => setImmediate(resolve))
  await h.tasks.processNext()
  assert.equal((await next).text, 'render')
  assert.equal(h.trace.filter(value => value === 'saveFullPromptTemplateState').length, 1)
  assert.equal(h.state().chat[0].variables[0].hp, 7)
  await h.tasks.dispose()
  h.runtime.dispose()
})

test('批量回执丢失只重传回执，不重新执行批次', async () => {
  const h = await harness({receiptFailure:true})
  const output = h.runtime.forSession('s').renderProjections([{template:'save'},{template:'next'}])
  const rejected = assert.rejects(output)
  await new Promise(r=>setImmediate(r))
  await assert.rejects(h.tasks.processNext(), /receipt disconnected/)
  await assert.rejects(h.tasks.processNext(), /receipt disconnected/)
  assert.equal(h.trace.filter(x=>x==='project:render').length,2)
  assert.equal(h.trace.filter(x=>x==='claim').length,1)
  assert.equal(h.state().chat[0].variables[0].hp,8)
  h.runtime.dispose(); await rejected; await h.tasks.dispose()
})

test('批量回执不携带作用域，成功状态继续传递、失败状态隔离，单条接口保持完整', async () => {
  const initial = {global:{g:1},local:{payload:'v'.repeat(200000)},initial:{i:2},message:{m:3}}
  const seen = [], trace = []
  const tasks = createTemplateSessionTasks({
    connection:{snapshot:{},refresh:async()=>{trace.push('refresh');return {}},flush:async()=>trace.push('flush')},
    plugin:{refresh:async()=>{},dispose:async()=>{},project:async(_op,input)=>{
      const scopes=structuredClone(input.context.scopes)
      seen.push(structuredClone(scopes))
      if(input.template==='fail') {
        scopes.global.g=999
        return {ok:false,kind:'runtime-error',error:'isolated',scopes}
      }
      scopes.global.g++;scopes.initial.i++;scopes.message.m++
      return {ok:true,text:String(scopes.global.g),scopes,randomCalls:2,activationRequests:[{ref:'leaf',force:true}],evaluated:true}
    }},dispatch:{}
  })
  try {
    const results=await tasks.project('renderMany',{items:[{template:'one'},{template:'fail'},{template:'two'}],context:{scopes:initial}})
    assert.deepEqual(results.map(r=>r.ok),[true,false,true])
    assert.deepEqual(seen.map(s=>[s.global.g,s.initial.i,s.message.m]),[[1,2,3],[2,3,4],[2,3,4]])
    assert.ok(seen.every(s=>s.local.payload.length===200000))
    assert.ok(results.every(r=>!Object.hasOwn(r,'scopes')))
    assert.deepEqual(results[1],{ok:false,kind:'runtime-error',error:'isolated'})
    assert.deepEqual(results[2],{ok:true,text:'3',randomCalls:2,activationRequests:[{ref:'leaf',force:true}],evaluated:true})
    assert.ok(JSON.stringify(results).length<1000)
    assert.deepEqual(trace,['refresh','flush','refresh','flush','refresh','flush'])
    const single=await tasks.project('render',{template:'single',context:{scopes:initial}})
    assert.equal(single.scopes.local.payload.length,200000)
    assert.deepEqual(initial.global,{g:1})
  } finally {await tasks.dispose()}
})
