import test from 'node:test'
import assert from 'node:assert/strict'
import {freezeJson} from '../tavern-plugin/lib/domain/freeze-json.js'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
for(const count of [20,400,10000])test(`unchanged immutable inputs avoid ${count} field reads during real settlement changes`,()=>{
 let reads=0,enumerations=0
 const source=new Proxy(Object.fromEntries(Array.from({length:count},(_,i)=>[String(i),'body'+i])),{
  get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)},
  ownKeys(target){enumerations++;return Reflect.ownKeys(target)}
 })
 freezeJson(source)
 const sync=createSessionViewSync(),view={inputSources:source,inputTemplateDisplays:freezeJson({}),activity:{busy:true}}
 const first=sync('s',view);reads=0;enumerations=0
 const next=sync('s',{...view,activity:{busy:false}},first.viewCursor)
 assert.equal(reads,0);assert.equal(enumerations,0)
 assert.deepEqual(next.viewDelta.set,[[['activity'],{busy:false}]])
 assert.equal(sync.peek(first.viewCursor).inputFields.get('inputSources'),sync.peek(next.viewCursor).inputFields.get('inputSources'))
})

test('mutable inputs are reread; replacements, removals and new parents keep delta semantics',()=>{
 const sync=createSessionViewSync(),inputSources={'1':'old'},view={inputSources}
 const first=sync('s',view);inputSources['1']='new'
 const second=sync('s',view,first.viewCursor)
 assert.deepEqual(second.viewDelta.set,[[['inputSources','1'],'new']])
 const third=sync('s',{inputSources:null},second.viewCursor)
 assert.deepEqual(third.viewDelta.set,[[['inputSources'],null]])
 assert.deepEqual(third.viewDelta.remove,[['inputSources','1']])
 const fourth=sync('s',{inputSources:freezeJson({'2':'replacement'})},third.viewCursor)
 assert.deepEqual(fourth.viewDelta.set,[[['inputSources'],{}],[['inputSources','2'],'replacement']])
 const fifth=sync('s',{},fourth.viewCursor)
 assert.ok(fifth.viewDelta.remove.some(path=>path.length===1&&path[0]==='inputSources'))
 assert.ok(fifth.viewDelta.remove.some(path=>path[1]==='2'))
})

test('persistent field batches apply the last set after removals',async()=>{
 const {createImmutableTurnFields}=await import('../tavern-plugin/lib/domain/freeze-json.js')
 const fields=createImmutableTurnFields(),old=fields.from({'2':'original'})
 assert.equal(fields.update(old,[['2','temporary'],['2','original']])['2'],'original')
 assert.equal(fields.update(old,[['2','original']],['2'])['2'],'original')
 assert.equal(old['2'],'original')
})
