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

test('ten thousand siblings and large unrelated values are not scanned for a scalar update',async()=>{
 const {tree,io}=fixture()
 const root=await tree.create({variables:Object.fromEntries(Array.from({length:10000},(_,i)=>['field'+i,i])),unrelated:'x'.repeat(1000000)})
 io.length=0
 const delta=await tree.apply(root,[{op:'delta',path:'/variables/field5000',value:7}])
 assert.ok(io.filter(e=>e.kind==='read').length<20)
 assert.ok(io.filter(e=>e.kind==='write').length<20)
 assert.ok(io.reduce((n,e)=>n+e.bytes,0)<20000)
 assert.ok(JSON.stringify(delta).length<300)
 assert.equal(await tree.get(delta.nextRoot,'/variables/field5000'),5007)
 assert.equal(await tree.get(root,'/variables/field5000'),5000)
 assert.deepEqual(delta.changes,[{op:'set',path:'/variables/field5000',value:5007}])
})
test('wire delta applies on an independent replica, duplicate is harmless, wrong base is rejected',async()=>{
 const source=fixture(),replica=fixture(),value={variables:{gold:10,bag:['a','b','c']}}
 const root=await source.tree.create(value),remote=await replica.tree.create(value)
 assert.equal(remote,root)
 const delta=await source.tree.apply(root,[{op:'delta',path:'/variables/gold',value:-3},{op:'remove',path:'/variables/bag/1'},{op:'set',path:'/variables/bag/-',value:'d'}])
 const wire=JSON.parse(JSON.stringify(delta)),received=await replica.tree.receive(remote,wire)
 assert.equal(received,delta.nextRoot)
 assert.deepEqual(await replica.tree.get(received),{variables:{gold:7,bag:['a','c','d']}})
 assert.equal(await replica.tree.receive(received,wire),received)
 await assert.rejects(replica.tree.receive(await replica.tree.create({variables:{gold:0}}),wire),{code:'STATE_DELTA_BASE_MISMATCH'})
 await assert.rejects(replica.tree.receive(root,{...wire,nextRoot:'wrong'}),/result mismatch/)
})

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

test('path calculations capture derived effects and read their own writes',async()=>{
 const {tree,io}=fixture(),root=await tree.create({variables:{gold:10,level:1},unused:'x'.repeat(1000000)})
 io.length=0
 const result=await tree.calculate(root,async state=>{
  await state.delta('/variables/gold',-3)
  const gold=await state.get('/variables/gold')
  await state.set('/variables/level',gold<8?2:1)
 })
 assert.deepEqual(result.changes,[{op:'set',path:'/variables/gold',value:7},{op:'set',path:'/variables/level',value:2}])
 assert.ok(io.reduce((n,e)=>n+e.bytes,0)<10000)
 assert.equal(await tree.get(root,'/variables/gold'),10)
 assert.equal(await tree.receive(root,result),result.nextRoot)
 await assert.rejects(tree.calculate(root,async state=>{await state.set('/variables/gold',0);throw Error('script failed')}),/script failed/)
 assert.equal(await tree.get(root,'/variables/gold'),10)
})

test('an array element update touches bounded buckets rather than copying the whole array',async()=>{
 const {tree,io}=fixture(),root=await tree.create({values:Array.from({length:10000},(_,i)=>i)})
 io.length=0
 const result=await tree.apply(root,[{op:'set',path:'/values/5000',value:42}])
 assert.ok(io.reduce((n,e)=>n+e.bytes,0)<20000)
 assert.equal(await tree.get(result.nextRoot,'/values/5000'),42)
 assert.equal(await tree.get(result.nextRoot,'/values/9999'),9999)
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

test('bounded decoded reuse skips repeated tree walks without sharing mutable results',async()=>{
 const {adapter,io}=fixture()
 const tree=createIncrementalJsonState({...adapter,decodedCacheBytes:4096})
 const source={schema:{properties:{gold:{type:'number'}}},values:[1,2]}
 const root=await tree.create(source)
 const first=await tree.get(root)
 io.length=0
 const second=await tree.get(root)
 assert.equal(io.length,0,'a repeated immutable subtree must not be walked again')
 first.schema.properties.gold.type='changed'
 second.values.push(3)
 assert.deepEqual(await tree.get(root),source)
 const next=await tree.apply(root,[{op:'set',path:'/values/0',value:9}])
 assert.deepEqual((await tree.get(next.nextRoot)).values,[9,2])
 assert.deepEqual(await tree.get(root),source)
 const huge=await tree.create('x'.repeat(2000))
 await tree.get(huge);io.length=0;await tree.get(huge)
 assert.ok(io.length>0,'oversized decoded values are not retained')
})

test('decoded cache budgets requested projections once instead of every nested copy',async()=>{
 const {adapter,io}=fixture()
 const tree=createIncrementalJsonState({...adapter,decodedCacheBytes:1300000})
 const one=await tree.create({card:{extensions:{script:'a'.repeat(100000)}}})
 const two=await tree.create({card:{extensions:{script:'b'.repeat(100000)}}})
 await tree.get(one);await tree.get(two);io.length=0
 const result=await tree.get(one)
 assert.equal(io.length,0,'two small-enough resources must survive nested decoding in the same bounded cache')
 result.card.extensions.script='mutated'
 assert.equal((await tree.get(one)).card.extensions.script.length,100000)
})

test('floors sharing a large subtree decode it once per operation and still return detached copies',async()=>{
 const f=fixture()
 const stat_data=Object.fromEntries(Array.from({length:60},(_,i)=>['角色'+i,{好感度:i,状态:['平静','警惕'],记录:Array.from({length:4},(_,j)=>'第'+j+'天')}]))
 const floors=Array.from({length:6},(_,i)=>({text:'floor '+i,variables:[{stat_data:i<5?stat_data:{...stat_data,额外:{at:i}}}]}))
 const roots=[]
 for(const value of floors)roots.push(await f.tree.create(value))
 async function readAll(shareSubtrees,decodedCacheBytes=0){
  let reads=0
  const tree=createIncrementalJsonState({...f.adapter,shareSubtrees,decodedCacheBytes,read:ref=>{reads++;return f.adapter.read(ref)}})
  const values=[]
  for(const root of roots)values.push(await tree.get(root))
  return {tree,values,reads}
 }
 const plain=await readAll(false),shared=await readAll(true)
 assert.deepEqual(plain.values,floors)
 assert.deepEqual(shared.values,floors)
 assert.ok(shared.reads*3<plain.reads,`later floors reuse the shared subtree: ${shared.reads} vs ${plain.reads} reads`)
 shared.values[0].variables[0].stat_data.角色0.好感度=99
 assert.equal(shared.values[1].variables[0].stat_data.角色0.好感度,0,'callers own independent copies')
 // A caller's edit never reaches the decoder-owned trees kept in the decoded cache.
 const cached=await readAll(true,1024*1024)
 cached.values[2].variables[0].stat_data.角色1.状态.push('改')
 assert.deepEqual(await cached.tree.get(roots[2]),floors[2])
 assert.deepEqual(await cached.tree.get(roots[3]),floors[3])
})