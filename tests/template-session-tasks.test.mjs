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
