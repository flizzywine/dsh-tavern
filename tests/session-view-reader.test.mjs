import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'
const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}}
function fixture() {
  let chat={id:'c',sessionId:'s',mode:'story',cardPath:'card',_storageRevision:1,messages:[{role:'assistant',text:'one'}]}
  const calls={fullRead:0,full:0,dirty:0,cached:0},states=[]
  const deps={readState:async()=>chat && {...structuredClone(chat),messages:[]},readChat:async()=>{calls.fullRead++;return structuredClone(chat)},
    readChanges:async()=>({revision:chat._storageRevision,indices:[0]}),
    project:{full:async value=>{calls.full++;return {chatId:value.id,tavernHelper:{messages:structuredClone(value.messages)}}},
      dirty:async value=>{calls.dirty++;return {chatId:value.id,tavernHelper:{messages:structuredClone(value.messages)}}},
      cached:async(_value,previous)=>{calls.cached++;return previous}},
    activity:()=>({busy:false}),foregroundRunning:()=>false,trace:{stage:(_name,fn)=>fn(),state:state=>states.push(state)},
    synchronize:(_id,view,_cursor,options)=>({view,...options})}
  // Closures let the tests replace adapters at the actual asynchronous seam.
  const reader=createSessionViewReader({...deps,readChat:(...args)=>deps.readChat(...args),readChanges:(...args)=>deps.readChanges(...args),readViewDelta:(...args)=>deps.readViewDelta?.(...args)})
  return {reader,deps,calls,states,get chat(){return chat},set chat(value){chat=value}}
}
for (const changes of [undefined,{revision:99,indices:[0]}]) test(`missing or mismatched change coverage rebuilds the full view: ${JSON.stringify(changes)}`,async()=>{
  const f=fixture();await f.reader.read('s');f.chat={...f.chat,_storageRevision:2}
  f.deps.readChanges=async()=>changes
  await f.reader.read('s');assert.equal(f.calls.full,2);assert.equal(f.calls.dirty,0)
})
for(const row of [{role:'user',text:'role changed'},null])test(`structural history changes retain full fallback: ${JSON.stringify(row)}`,async()=>{
  const f=fixture();await f.reader.read('s');f.chat={...f.chat,_storageRevision:2,messages:row?[row]:[]}
  await f.reader.read('s');assert.equal(f.calls.full,2);assert.equal(f.calls.dirty,0)
})
test('resource identity changes invalidate even a matching storage revision',async()=>{
  const f=fixture();await f.reader.read('s');f.chat={...f.chat,cardContextRevision:1}
  await f.reader.read('s');assert.equal(f.calls.full,2)
})
test('slow old projection cannot replace a newer completed cache',async()=>{
  const f=fixture(),entered=gate(),finish=gate(),original=f.deps.project.full
  f.deps.project.full=async chat=>{if(chat._storageRevision===1){entered.resolve();await finish.promise}return original(chat)}
  const old=f.reader.read('s');await entered.promise
  f.chat={...f.chat,_storageRevision:2,messages:[{role:'assistant',text:'two'}]}
  await f.reader.read('s');finish.resolve();await old
  const result=await f.reader.read('s')
  assert.equal(result.tavernHelper.messages[0].text,'two')
  assert.equal(f.calls.fullRead,2);assert.equal(f.calls.cached,1)
})
test('cold skeleton is not cached as a complete projection',async()=>{
  const f=fixture();let skeleton=true
  f.deps.project.full=async()=>({tavernHelper:{messages:[],messagesPending:skeleton}})
  await f.reader.read('s',{windowHelperMessages:true});skeleton=false
  await f.reader.read('s');await f.reader.read('s')
  assert.equal(f.calls.fullRead,2);assert.equal(f.calls.cached,1)
})
test('deletion between metadata and full read returns a missing view',async()=>{
  const f=fixture();f.deps.readChat=async()=>undefined
  assert.equal(await f.reader.read('s'),null)
})

for (const kind of ['revision', 'resource', 'missing']) test(`invalid delta ${kind} falls back before rendering`,async()=>{
  const f=fixture();await f.reader.read('s');f.chat={...f.chat,_storageRevision:2}
  f.deps.readViewDelta=async()=>kind==='missing'?undefined:{baseRevision:1,revision:kind==='revision'?3:2,indices:[0],chat:{...f.chat,cardPath:kind==='resource'?'other':'card'}}
  await f.reader.read('s')
  assert.equal(f.calls.fullRead,2)
})


test('verified truncation evidence reaches input projection while the full view fallback remains',async()=>{
 const f=fixture();f.chat={...f.chat,messages:[{role:'assistant',text:'one'},{role:'assistant',text:'two'}]}
 await f.reader.read('s')
 f.chat={...f.chat,_storageRevision:2,messages:f.chat.messages.slice(0,1)}
 f.deps.readViewDelta=async()=>({baseRevision:1,revision:2,indices:[],changedHeaderFields:['_storageRevision'],chat:f.chat})
 const original=f.deps.project.full;let evidence
 f.deps.project.full=async(chat,options)=>{evidence=options.inputChanges;return original(chat)}
 await f.reader.read('s')
 assert.equal(f.calls.full,2);assert.equal(f.calls.dirty,0)
 assert.equal(evidence.baseRevision,1);assert.deepEqual([...evidence.indices],[])
 assert.deepEqual(evidence.changedHeaderFields,['_storageRevision'])
})
