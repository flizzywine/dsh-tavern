import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
for(const count of [20,400,10000])test(`warm scoped session input stays bounded at ${count}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'session-bounded-'));t.after(()=>rm(root,{recursive:true,force:true}))
 let visits=0
 const store=createChatJournalStore({dataRoot:root,onIndexedMessageVisit:()=>visits++,frameLimit:1e6,byteLimit:1e9})
 await store.update('c',()=>({id:'c',_storageRevision:1,messages:Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,text:'body',variables:[{hp:10}],mvu:{pending:i===0,pendingSubmission:{command:'test'}}}))}))
 const old=await store.readSessionState('c',{scoped:true})
 visits=0
 await store.patch('c',1,[{op:'set',path:['_storageRevision'],value:2},{op:'set',path:['messages',count-1,'variables',0,'hp'],value:9}])
 const state=await store.readSessionState('c',{scoped:true})
 assert.deepEqual(state.pendingMvuSettlement,{hasSubmission:true,prepared:false})
 assert.equal(state.messages[count-1].turn,count)
 assert.ok(visits<128,`visited ${visits} history index nodes`)
 t.diagnostic(`${count} floors: ${visits} history index node visits`)
 state.messages[0].mvu.pending=false
 assert.equal((await store.readSessionState('c',{scoped:true})).messages[0].mvu.pending,true)
 assert.equal(old._storageRevision,1)
 assert.equal(old.messages[count-1].turn,count)
 assert.deepEqual(state.messages[count-1],(await store.readSessionState('c')).messages[count-1])
})

import {createSessionStateView} from '../tavern-plugin/lib/domain/chat-session-state.js'
test('rollback view reuses native immutable evidence for variable-only revisions',()=>{
 let visits=0
 const events=Object.freeze(new Proxy(Array.from({length:400},(_,seq)=>Object.freeze({seq,type:'session/note',data:{}})),{get(t,k,r){if(/^\d+$/.test(String(k)))visits++;return Reflect.get(t,k,r)}}))
 const session={header:{version:3},snapshotEvents:()=>events,surface:{nodes:[],replaceGeneration:0}}
 const view=createSessionStateView({activity:()=>({}),evidence:()=>({events,session})})
 const chat={id:'c',sessionId:'s',_storageRevision:1,messages:[{role:'user',turn:1},{role:'assistant',turn:1}]}
 const initial=view.volatile(chat,{})
 visits=0
 const next=view.volatile({...chat,_storageRevision:2},{},{baseRevision:1,indices:[1],layoutChanged:false})
 assert.equal(next.canRollback,initial.canRollback)
 assert.ok(visits<8,`scanned ${visits} historical events`)
})

test('scoped pending index follows commits, rejected patches and membership changes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'session-pending-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createChatJournalStore({dataRoot:root})
 await store.update('c',()=>({id:'c',_storageRevision:1,messages:[
  {role:'assistant',turn:1,mvu:{pending:true,pendingSubmission:{command:'first'}}},
  {role:'assistant',turn:2,mvu:{pending:false}}
 ]}))
 const old=await store.readSessionState('c',{scoped:true})
 const changes=[{op:'set',path:['_storageRevision'],value:2},{op:'set',path:['messages',1,'mvu'],value:{pending:true,delivery:{prepared:true}}}]
 await assert.rejects(store.patch('c',1,changes,{assertCurrent(){throw new Error('cancelled')}}),/cancelled/)
 assert.deepEqual((await store.readSessionState('c',{scoped:true})).pendingMvuSettlement,{hasSubmission:true,prepared:false})
 await store.patch('c',1,changes)
 assert.deepEqual((await store.readSessionState('c',{scoped:true})).pendingMvuSettlement,{hasSubmission:false,prepared:true})
 assert.equal(old.messages[1].mvu.pending,false)
 await store.patch('c',2,[{op:'set',path:['_storageRevision'],value:3},{op:'set',path:['messages',1,'mvu','pending'],value:false}])
 assert.deepEqual((await store.readSessionState('c',{scoped:true})).pendingMvuSettlement,{hasSubmission:true,prepared:false})
 await store.patch('c',3,[{op:'set',path:['_storageRevision'],value:4},{op:'set',path:['messages'],value:[]}])
 assert.equal((await store.readSessionState('c',{scoped:true})).pendingMvuSettlement,null)
 assert.equal((await createChatJournalStore({dataRoot:root}).readSessionState('c',{scoped:true})).messages.length,0)
})

for(const change of ['events','generation','layout','session','legacy'])test(`rollback view invalidates on ${change}`,()=>{
 let visits=0
 const makeEvents=()=>Object.freeze(new Proxy(Array.from({length:20},(_,seq)=>Object.freeze({seq,type:'session/note',data:{}})),{get(t,k,r){if(/^\d+$/.test(String(k)))visits++;return Reflect.get(t,k,r)}}))
 let events=makeEvents()
 let session={header:{version:3},snapshotEvents:()=>events,surface:{nodes:[],replaceGeneration:0}}
 if(change==='legacy')session.header.version=2
 const view=createSessionStateView({activity:()=>({}),evidence:()=>({events,session})})
 let chat={id:'c',sessionId:'s',_storageRevision:1,messages:[{role:'assistant',turn:1}]}
 view.volatile(chat,{})
 if(change==='events')events=makeEvents()
 if(change==='generation')session.surface.replaceGeneration++
 if(change==='session')session={...session}
 if(change==='layout')chat={...chat,messages:[{role:'assistant',turn:2}]}
 visits=0
 const next=view.volatile({...chat,_storageRevision:2},{},{baseRevision:1,indices:[0],layoutChanged:change==='layout'})
 // Changed evidence or layout must run the original inspection.
 assert.ok(visits>0)
 const fresh=createSessionStateView({activity:()=>({}),evidence:()=>({events,session})}).volatile({...chat,_storageRevision:2},{})
 assert.deepEqual(next,fresh)
})

test('cached rollback view refreshes undo eligibility on storage revision changes',()=>{
 const events=Object.freeze([])
 const session={header:{version:3},snapshotEvents:()=>events,surface:{nodes:[],replaceGeneration:0}}
 const view=createSessionStateView({activity:()=>({}),evidence:()=>({events,session})})
 const chat={id:'c',sessionId:'s',_storageRevision:1,messages:[],timeline:{branchId:'b',revision:1},rollbackUndo:{version:1,ready:true,branchId:'b',revision:1,lifecycleRevision:0,storageRevision:1,turn:3,foreground:{afterCount:0}}}
 assert.equal(view.volatile(chat,{}).undoRollbackTurn,3)
 assert.equal(view.volatile({...chat,_storageRevision:2},{},{baseRevision:1,indices:[],layoutChanged:false}).undoRollbackTurn,null)
})

test('scoped session state preserves full legacy foreground migration input',async t=>{
 const root=await mkdtemp(join(tmpdir(),'session-legacy-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createChatJournalStore({dataRoot:root})
 await store.update('c',()=>({id:'c',_storageRevision:1,messages:[{role:'assistant',text:'legacy body',variables:[{hp:10}]}],timeline:{operations:{body:{kind:'body',status:'foreground-completed'}}}}))
 const result=await store.readSessionState('c',{scoped:true})
 assert.equal(result.messages[0].text,'legacy body')
 assert.deepEqual(structuredClone(result.messages[0].variables),[{hp:10}])
 result.messages[0].variables[0].hp=1
 assert.equal((await store.read('c')).messages[0].variables[0].hp,10)
})

import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
for(const count of [20,400,10000])test(`unchanged regenerated mappings are not read or copied on a trusted revision at ${count}`,()=>{
 const events=Object.freeze([]),session={header:{version:3},snapshotEvents:()=>events,surface:{nodes:[],replaceGeneration:0}}
 const projector=createSessionStateView({activity:()=>({}),evidence:()=>({events,session}),sharedMappings:true})
 const chat={id:'mapped',sessionId:'s',_storageRevision:1,messages:[],regeneratedDshTurns:Object.fromEntries(Array.from({length:count},(_,id)=>[id+1,id+100]))}
 const initial=projector.volatile(chat,{})
 const sync=createSessionViewSync(),first=sync('s',initial)
 const nextChat={...chat,_storageRevision:2}
 Object.defineProperty(nextChat,'regeneratedDshTurns',{get(){throw new Error('unchanged mapping was read')}})
 const next=projector.volatile(nextChat,{}, {baseRevision:1,indices:[],layoutChanged:false,changedHeaderFields:['_storageRevision']})
 assert.equal(next.regeneratedDshTurns,initial.regeneratedDshTurns)
 assert.deepEqual(sync('s',next,first.viewCursor).viewDelta.set,[])
 assert.throws(()=>{next.regeneratedDshTurns['1']=999},/immutable/i)
 const changed=projector.volatile({...chat,_storageRevision:3,regeneratedDshTurns:{'1':999}}, {}, {baseRevision:2,indices:[],layoutChanged:false,changedHeaderFields:['regeneratedDshTurns']})
 assert.equal(changed.regeneratedDshTurns['1'],999)
 assert.equal(initial.regeneratedDshTurns['1'],100)
 const unknown=projector.volatile({...chat,_storageRevision:4,regeneratedDshTurns:{'1':777}}, {}, {baseRevision:3,indices:[],layoutChanged:false})
 assert.equal(unknown.regeneratedDshTurns['1'],777,'unknown header changes must rebuild')
})
