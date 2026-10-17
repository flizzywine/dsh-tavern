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

test('重新生成、回退或停止占用的原生轮次不会让历史输入错位',()=>{
 const projector=createInputFieldsProjection()
 const user=text=>({role:'user',text,templateInputSource:true})
 // Native turn 3 was consumed by a regeneration; the second exchange belongs to turn 4.
 let chat={id:'drift',_storageRevision:1,runtimeInputs:{},messages:[{role:'assistant',text:'opening',turn:1},user('a'),{role:'assistant',text:'r1',turn:2},user('b'),{role:'assistant',text:'r2',turn:4}]}
 const first=projector.project(chat)
 assert.equal(first.inputSources[4],'b');assert.equal(Object.hasOwn(first.inputSources,'3'),false)
 chat={...chat,_storageRevision:2,messages:[...chat.messages,user('c'),{role:'assistant',text:'r3',turn:6}]}
 const appended=projector.project(chat,{baseRevision:1,indices:[],changedHeaderFields:[]})
 assert.equal(appended.inputSources[6],'c')
 chat={...chat,_storageRevision:3,messages:[...chat.messages.slice(0,4),{...chat.messages[4],turn:5},...chat.messages.slice(5)]}
 const moved=projector.project(chat,{baseRevision:2,indices:[4],changedHeaderFields:[]})
 assert.equal(moved.inputSources[5],'b');assert.equal(Object.hasOwn(moved.inputSources,'4'),false)
 chat={...chat,_storageRevision:4,messages:chat.messages.slice(0,5)}
 const truncated=projector.project(chat,{baseRevision:3,indices:[],changedHeaderFields:[]})
 assert.equal(Object.hasOwn(truncated.inputSources,'6'),false)
 assert.deepEqual(JSON.parse(JSON.stringify(truncated)),JSON.parse(JSON.stringify(createInputFieldsProjection().project(chat))))
})
