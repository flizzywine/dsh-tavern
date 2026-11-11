import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {createIncrementalJsonState} from '../tavern-plugin/lib/domain/incremental-json-state.js'
function fixture(){
 const blocks=new Map(),io=[]
 const adapter={write:async value=>{const json=JSON.stringify(value),ref=createHash('sha256').update(json).digest('hex');io.push({kind:'write',bytes:Buffer.byteLength(json)});blocks.set(ref,json);return ref},
  read:async ref=>{const json=blocks.get(ref);assert.ok(json,'missing block');io.push({kind:'read',bytes:Buffer.byteLength(json)});return JSON.parse(json)}}
 return {tree:createIncrementalJsonState(adapter),adapter,blocks,io}
}

test('invalid operations do not change a root or allow prototype traversal',async()=>{
 const {tree}=fixture(),root=await tree.create({variables:{a:[1],text:'a'}})
 for(const op of [
  {op:'delta',path:'/variables/text',value:1},{op:'delta',path:'/missing',value:1},
  {op:'set',path:'/missing/child',value:1},{op:'set',path:'/variables/a/01',value:1},
  {op:'set',path:'/variables/a/3',value:1},{op:'remove',path:''},{op:'remove',path:'/missing'},
  {op:'set',path:'bad',value:1},{op:'set',path:'/bad~2',value:1},
  {op:'set',path:'/__proto__/polluted',value:1},{op:'delta',path:'/variables/a/0',value:Infinity}
 ])await assert.rejects(tree.apply(root,[op]),{code:'STATE_DELTA_INVALID'})
 assert.deepEqual(await tree.get(root),{variables:{a:[1],text:'a'}})
 assert.equal({}.polluted,undefined)
 for(const value of [undefined,{a:undefined},NaN,new Date(),{a:-0}])await assert.rejects(tree.create(value),{code:'STATE_DELTA_INVALID'})
})

test('resynchronization transfers exact immutable roots after history-dependent edits',async()=>{
 const source=fixture(),replica=fixture()
 const base=await source.tree.create({v:Object.fromEntries(Array.from({length:40},(_,i)=>['k'+i,i]))})
 const edited=await source.tree.apply(base,Array.from({length:20},(_,i)=>({op:'remove',path:'/v/k'+i})))
 const snapshot=JSON.parse(JSON.stringify(await source.tree.exportSnapshot(edited.nextRoot)))
 const root=await replica.tree.importSnapshot(snapshot)
 assert.equal(root,edited.nextRoot)
 assert.deepEqual(await replica.tree.get(root),await source.tree.get(root))
 const next=await source.tree.apply(root,[{op:'delta',path:'/v/k30',value:1}])
 assert.equal(await replica.tree.receive(root,next),next.nextRoot)
 await assert.rejects(replica.tree.importSnapshot({...snapshot,blocks:snapshot.blocks.slice(1)}),/Incomplete/)
 const bad=structuredClone(snapshot);bad.blocks[0][1].size=999
 await assert.rejects(replica.tree.importSnapshot(bad),/checksum/)
})
