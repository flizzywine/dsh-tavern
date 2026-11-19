import test from 'node:test'
import assert from 'node:assert/strict'
import {createStatusSourceIndex} from '../tavern-plugin/lib/domain/status-source-index.js'
for(const count of [20,400,10000])test(`legacy source point update and lookup remain bounded at ${count} messages`,()=>{
 let visits=0,reads=0
 const index=createStatusSourceIndex({visit:()=>visits++})
 const messages=Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,text:'body'+i}))
 const old=index.update(null,messages)
 const next=messages.slice();next[count-1]={...messages[count-1],text:'edited'}
 const source=new Proxy(next,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})
 visits=0
 const changed=index.update(old,source,[count-1])
 assert.equal(index.get(changed,count),'edited');assert.equal(index.get(old,count),'body'+(count-1))
 assert.equal(reads,1);assert.ok(visits<150,`index visits: ${visits}`)
})
