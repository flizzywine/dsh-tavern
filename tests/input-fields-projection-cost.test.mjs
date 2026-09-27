import test from 'node:test'
import assert from 'node:assert/strict'
import {createInputFieldsProjection} from '../tavern-plugin/lib/domain/input-fields-projection.js'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
for(const count of [20,400,10000])test(`input edit projects and syncs only one floor among ${count}`,()=>{
 let visits=0,reads=0
 const projector=createInputFieldsProjection({maxBytes:128*1024*1024,onIndexVisit:()=>visits++})
 const messages=Array.from({length:count},(_,i)=>({role:'user',text:'body'+i,templateInputSource:true}))
 const chat={id:'c',_storageRevision:1,messages,runtimeInputs:{}}
 const old=projector.project(chat),sync=createSessionViewSync(),baseline=sync('s',old)
 const changed=messages.slice();changed[count-1]={...messages[count-1],text:'edited'}
 const measured=new Proxy(changed,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})
 visits=0
 const next=projector.project({...chat,_storageRevision:2,messages:measured},{baseRevision:1,indices:new Set([count-1]),changedHeaderFields:['_storageRevision']})
 const result=sync('s',next,baseline.viewCursor)
 assert.ok(reads<5,`message reads: ${reads}`);assert.ok(visits<300,`index visits: ${visits}`)
 assert.deepEqual(result.viewDelta.set,[[['inputSources',String(count+1)],'edited']])
 assert.equal(old.inputSources[count+1],'body'+(count-1))
 assert.equal(next.inputTemplateDisplays,old.inputTemplateDisplays)
})

test('input override removal restores runtime input and stale template disappears',()=>{
 const projector=createInputFieldsProjection()
 let chat={id:'c',_storageRevision:1,runtimeInputs:{'2':{source:'runtime'}},messages:[{role:'assistant',text:'opening'},{role:'user',text:'user',templateInputSource:true,tavernPluginData:{template_display:{source:'user',swipe:0,html:'<b>user</b>'}}}]}
 const first=projector.project(chat)
 chat={...chat,_storageRevision:2,messages:[chat.messages[0],{...chat.messages[1],text:'edited',templateInputSource:false}]}
 const next=projector.project(chat,{baseRevision:1,indices:[1],changedHeaderFields:[]})
 assert.equal(next.inputSources[2],'runtime');assert.equal(Object.hasOwn(next.inputTemplateDisplays,'2'),false)
 assert.equal(first.inputTemplateDisplays[2],'<b>user</b>')
 chat={...chat,_storageRevision:3,runtimeInputs:{'2':{source:'new runtime'}}}
 const headerChanged=projector.project(chat,{baseRevision:2,indices:[],changedHeaderFields:['runtimeInputs']})
 assert.equal(headerChanged.inputSources[2],'new runtime')
 const cold=createInputFieldsProjection().project(chat)
 assert.deepEqual(JSON.parse(JSON.stringify(headerChanged)),JSON.parse(JSON.stringify(cold)))
})

test('role changes and unknown header coverage rebuild rather than reuse stale ordinals',()=>{
 const projector=createInputFieldsProjection()
 let chat={id:'c',_storageRevision:1,messages:[{role:'user',text:'a',templateInputSource:true},{role:'user',text:'b',templateInputSource:true}]}
 projector.project(chat)
 chat={...chat,_storageRevision:2,messages:[{role:'assistant',text:'a'},chat.messages[1]]}
 const changed=projector.project(chat,{baseRevision:1,indices:[0],changedHeaderFields:[]})
 assert.deepEqual(JSON.parse(JSON.stringify(changed.inputSources)),{'2':'b'})
 chat={...chat,_storageRevision:3,runtimeInputs:{'9':{source:'new'}}}
 const unknown=projector.project(chat,{baseRevision:2,indices:[],changedHeaderFields:null})
 assert.equal(unknown.inputSources[9],'new')
})

for(const count of [20,400,10000])test(`tail input append keeps ${count} historical input fields`,()=>{
 let reads=0,visits=0
 const projector=createInputFieldsProjection({maxBytes:128*1024*1024,onIndexVisit:()=>visits++})
 const messages=Array.from({length:count},(_,i)=>({role:i%2?'assistant':'user',text:'body'+i,templateInputSource:true}))
 const chat={id:'append',_storageRevision:1,messages},first=projector.project(chat)
 const sync=createSessionViewSync(),baseline=sync('s',first)
 const added=[...messages,{role:'assistant',text:'assistant'},{role:'user',text:'new user',templateInputSource:true}]
 const measured=new Proxy(added,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})
 visits=0
 const next=projector.project({...chat,_storageRevision:2,messages:measured},{baseRevision:1,indices:[],changedHeaderFields:[]})
 const delta=sync('s',next,baseline.viewCursor).viewDelta
 assert.ok(reads<=5,`reads: ${reads}`);assert.ok(visits<300,`visits: ${visits}`)
 assert.deepEqual(delta.set,[[['inputSources',String(count/2+2)],'new user']])
 assert.equal(Object.hasOwn(first.inputSources,String(count/2+2)),false)
 assert.equal(first.inputSources[2],next.inputSources[2])
})

for(const count of [20,400,10000])test(`tail input truncation avoids reading the ${count}-row retained prefix`,()=>{
 let reads=0,visits=0
 const projector=createInputFieldsProjection({maxBytes:128*1024*1024,onIndexVisit:()=>visits++})
 const messages=Array.from({length:count},(_,i)=>({role:i%2?'assistant':'user',text:'body'+i,templateInputSource:true}))
 const chat={id:'truncate',_storageRevision:1,messages},first=projector.project(chat)
 const sync=createSessionViewSync(),baseline=sync('s',first)
 const shortened=new Proxy(messages.slice(0,-2),{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})
 visits=0
 const next=projector.project({...chat,_storageRevision:2,messages:shortened},{baseRevision:1,indices:[],changedHeaderFields:[]})
 const delta=sync('s',next,baseline.viewCursor).viewDelta
 assert.equal(reads,0);assert.ok(visits<300,`visits: ${visits}`)
 assert.deepEqual(delta.set,[])
 assert.deepEqual(delta.remove,[['inputSources',String(count/2+1)]])
 assert.equal(first.inputSources[count/2+1],'body'+(count-2))
})

test('truncated user override restores runtime baseline and removes its display',()=>{
 const projector=createInputFieldsProjection()
 const chat={id:'restore',_storageRevision:1,runtimeInputs:{'2':{source:'runtime'}},messages:[{role:'user',text:'override',templateInputSource:true,tavernPluginData:{template_display:{source:'override',swipe:0,html:'display'}}}]}
 const first=projector.project(chat)
 const next=projector.project({...chat,_storageRevision:2,messages:[]},{baseRevision:1,indices:[],changedHeaderFields:[]})
 assert.equal(next.inputSources[2],'runtime')
 assert.equal(Object.hasOwn(next.inputTemplateDisplays,'2'),false)
 assert.equal(first.inputSources[2],'override');assert.equal(first.inputTemplateDisplays[2],'display')
 assert.deepEqual(JSON.parse(JSON.stringify(next)),JSON.parse(JSON.stringify(createInputFieldsProjection().project({...chat,messages:[]}))))
})

for(const count of [20,400,10000])test(`runtime input point changes avoid reading ${count} unrelated messages and inputs`,()=>{
 let reads=0,visits=0
 const projector=createInputFieldsProjection({maxBytes:128*1024*1024,onIndexVisit:()=>visits++})
 const messages=Array.from({length:count},(_,i)=>({role:'user',text:'body'+i}))
 const runtimeInputs=Object.fromEntries(messages.map((_,i)=>[String(i+2),{source:'input'+i}]))
 const chat={id:'runtime',_storageRevision:1,messages,runtimeInputs},first=projector.project(chat)
 const sync=createSessionViewSync(),baseline=sync('s',first)
 const measured=new Proxy(messages,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})
 const changed={...chat,_storageRevision:2,messages:measured}
 Object.defineProperty(changed,'runtimeInputs',{get(){throw Error('full runtime input access')}})
 visits=0
 const next=projector.project(changed,{baseRevision:1,indices:[],changedHeaderFields:['runtimeInputs'],runtimeInputChanges:[{key:String(count+1),present:true,value:{source:'new'}}]})
 const delta=sync('s',next,baseline.viewCursor).viewDelta
 assert.ok(reads<=2,`reads: ${reads}`);assert.ok(visits<400,`visits: ${visits}`)
 assert.deepEqual(delta.set,[[['inputSources',String(count+1)],'new']])
 assert.equal(first.inputSources[count+1],'input'+(count-1))
})

test('runtime input deletion and replacement keep user override precedence',()=>{
 const projector=createInputFieldsProjection()
 const chat={id:'precedence',_storageRevision:1,messages:[{role:'user',text:'override',templateInputSource:true},{role:'user',text:'plain'}],runtimeInputs:{'2':{source:'base'},'3':{source:'base3'},'99':{source:'outside'}}}
 projector.project(chat)
 const next=projector.project({...chat,_storageRevision:2},{baseRevision:1,indices:[],changedHeaderFields:['runtimeInputs'],runtimeInputChanges:[{key:'2',present:true,value:{source:'new'}},{key:'3',present:false},{key:'99',present:false}]})
 assert.equal(next.inputSources[2],'override');assert.equal(Object.hasOwn(next.inputSources,'3'),false);assert.equal(Object.hasOwn(next.inputSources,'99'),false)
 const restored=projector.project({...chat,_storageRevision:3,messages:[{role:'user',text:'plain'},chat.messages[1]]},{baseRevision:2,indices:[0],changedHeaderFields:[]})
 assert.equal(restored.inputSources[2],'new')
})
