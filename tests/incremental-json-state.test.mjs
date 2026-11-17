import test from 'node:test'
import assert from 'node:assert/strict'
import crypto, {createHash} from 'node:crypto'
import {syncBuiltinESMExports} from 'node:module'
import {createIncrementalJsonState,createDecodedJsonCache} from '../tavern-plugin/lib/domain/incremental-json-state.js'
function fixture(){
 const blocks=new Map(),io=[]
 const adapter={write:async value=>{const json=JSON.stringify(value),ref=createHash('sha256').update(json).digest('hex');io.push({kind:'write',bytes:Buffer.byteLength(json)});blocks.set(ref,json);return ref},
  read:async ref=>{const json=blocks.get(ref);assert.ok(json,'missing block');io.push({kind:'read',bytes:Buffer.byteLength(json)});return JSON.parse(json)}}
 return {tree:createIncrementalJsonState(adapter),adapter,blocks,io}
}

test('tree updates never mutate shared immutable storage nodes',async()=>{
 const f=fixture(),root=await f.tree.create({items:[{value:1},{value:2}],other:{value:'original'}})
 const shared=new Map()
 const freeze=value=>{if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value}
 const reader=createIncrementalJsonState({...f.adapter,read:async ref=>{
  if(!shared.has(ref))shared.set(ref,freeze(await f.adapter.read(ref)))
  return shared.get(ref)
 }})
 const before=await reader.get(root)
 const next=await reader.apply(root,[{op:'delta',path:'/items/0/value',value:3},{op:'remove',path:'/items/1'},{op:'set',path:'/other/value',value:'new'}])
 assert.deepEqual(await reader.get(next.nextRoot),{items:[{value:4}],other:{value:'new'}})
 assert.deepEqual(await reader.get(root),before)
})

test('independent cold decoders share one projection without sharing caller-owned values',async()=>{
 const f=fixture(),root=await f.tree.create({nested:{rows:Array.from({length:50},(_,i)=>({value:i}))}})
 const shared=createDecodedJsonCache(1024*1024)
 const readers=Array.from({length:8},()=>createIncrementalJsonState({...f.adapter,decodedCache:shared}))
 f.io.length=0
 const one=await createIncrementalJsonState(f.adapter).get(root)
 const expected=f.io.length
 f.io.length=0
 const results=await Promise.all(readers.map(reader=>reader.get(root)))
 assert.equal(f.io.length,expected,'one traversal, not one per concurrent reader')
 assert.deepEqual(results[0],one)
 results[0].nested.rows[0].value=999
 assert.equal(results[1].nested.rows[0].value,0)
 assert.equal((await readers[0].get(root)).nested.rows[0].value,0)
})

test('failed shared decoding is not retained and a repaired read can proceed',async()=>{
 const f=fixture(),root=await f.tree.create({nested:{value:1}}),shared=createDecodedJsonCache(1024)
 let broken=true
 const reader=createIncrementalJsonState({...f.adapter,decodedCache:shared,read:ref=>{if(broken)throw Error('offline');return f.adapter.read(ref)}})
 const failed=await Promise.allSettled([reader.get(root),reader.get(root)])
 assert.ok(failed.every(row=>row.status==='rejected'))
 broken=false
 assert.deepEqual(await reader.get(root),{nested:{value:1}})
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
test('field projection shares prefixes without hashing keys or reading unrelated values',async()=>{
 const {tree,io}=fixture()
 const root=await tree.create({...Object.fromEntries(Array.from({length:40},(_,i)=>['field'+i,i])),nested:{a:2,b:3,unused:'x'.repeat(200000)},variables:[{stat_data:{gold:7}}]})
 io.length=0
 let hashes=0
 const original=crypto.createHash
 crypto.createHash=(...args)=>{hashes++;return original(...args)};syncBuiltinESMExports()
 let selected
 try{selected=await tree.getFields(root,['/field3','/nested/a','/nested/b','/missing/child','/variables'])}
 finally{crypto.createHash=original;syncBuiltinESMExports()}
 assert.equal(hashes,0,'field selection must not add per-key digests')
 assert.deepEqual(selected,{field3:3,nested:{a:2,b:3},variables:[{stat_data:{gold:7}}]})
 assert.ok(io.every(e=>e.kind==='read'&&e.bytes<65536),'unselected scalar is never read or rewritten')
 selected.variables[0].stat_data.gold=99
 assert.equal((await tree.getFields(root,['/variables'])).variables[0].stat_data.gold,7)
})

test('field projection leaves omitted subtrees unread and selects every member through *',async()=>{
 // Many small nodes, as a record's judge probabilities and beat states are stored.
 const many=prefix=>Array.from({length:400},(_,i)=>({id:prefix+i,p:[i]}))
 const record={digest:'d',stats:{calls:1,judge:{inputKey:'k',probabilities:many('a')}},entries:[{at:1,ops:[{op:'a'}],state:{actors:many('s')}},{at:2,ops:[],state:{}}],empty:[]}
 const reads=async read=>{const {tree:cold,io}=fixture(),root=await cold.create({record});io.length=0;const value=await read(cold,root);return {value,reads:io.filter(e=>e.kind==='read').length}}
 const whole=await reads((t,root)=>t.getFields(root,['/record']))
 const lean=await reads((t,root)=>t.getFields(root,['/record'],['/record/stats/judge/probabilities']))
 assert.deepEqual(lean.value,{record:{...record,stats:{calls:1,judge:{inputKey:'k'}}}})
 const beats=await reads((t,root)=>t.getFields(root,['/record/entries/*/at','/record/entries/*/ops','/record/empty/*']))
 assert.deepEqual(beats.value,{record:{entries:[{at:1,ops:[{op:'a'}]},{at:2,ops:[]}],empty:[]}})
 assert.ok(lean.reads*1.5<whole.reads && beats.reads*4<whole.reads,`reads: whole ${whole.reads}, lean ${lean.reads}, beats ${beats.reads}`)
})

// A stage playback node list: many small objects and one-element reference arrays.
const smallNodes=()=>({nodes:Array.from({length:200},(_,i)=>({alias:'a'+i,ref:[i],state:{id:'calm'}})),frames:{k:[0]},title:'t'})
test('small objects and arrays stay inline in their parent instead of becoming blocks',async()=>{
 const f=fixture(),value=smallNodes()
 const root=await f.tree.create(value)
 assert.equal(JSON.stringify(await f.tree.get(root)),JSON.stringify(value))
 // root + nodes array + its index (~20); not 6 blocks per node for the node, its [id] and its {id} state.
 assert.ok(f.blocks.size<30,`${f.blocks.size} blocks`)
 assert.equal(await f.tree.type(root,'/nodes/3'),'object')
 assert.equal(await f.tree.type(root,'/nodes/3/ref'),'array')
 assert.deepEqual(await f.tree.keys(root,'/nodes/3'),['alias','ref','state'])
 assert.equal(await f.tree.size(root,'/nodes/3/ref'),1)
 assert.equal(await f.tree.get(root,'/nodes/3/state/id'),'calm')
 const fields=await f.tree.getFields(root,['/title','/nodes/3/state/id','/frames/k/*'])
 assert.deepEqual([fields.title,fields.nodes[3],fields.frames],['t',{state:{id:'calm'}},{k:[0]}])
 const read=await f.tree.get(root,'/nodes/3');read.state.id='mutated'
 assert.equal(await f.tree.get(root,'/nodes/3/state/id'),'calm','inline values are returned as copies')
 // The root stays a block even when it is small.
 const small=await f.tree.create({a:1})
 assert.equal(JSON.parse(f.blocks.get(small)).type,'object')
 assert.deepEqual(await f.tree.get(small),{a:1})
})
test('patches reach into inline containers and re-encode only that value',async()=>{
 const f=fixture(),root=await f.tree.create(smallNodes())
 const result=await f.tree.apply(root,[
  {op:'set',path:'/nodes/3/state/id',value:'joy'},{op:'delta',path:'/nodes/4/ref/0',value:10},
  {op:'set',path:'/nodes/5/ref/-',value:7},{op:'remove',path:'/nodes/6/state'},{op:'remove',path:'/frames/k/0'},
  {op:'set',path:'/nodes/7/state/long',value:'x'.repeat(300)}])
 const expected=smallNodes()
 expected.nodes[3].state.id='joy';expected.nodes[4].ref[0]=14;expected.nodes[5].ref.push(7);delete expected.nodes[6].state;expected.frames.k=[]
 expected.nodes[7].state.long='x'.repeat(300)
 assert.equal(JSON.stringify(await f.tree.get(result.nextRoot)),JSON.stringify(expected))
 assert.deepEqual(result.changes.map(change=>change.value),['joy',14,7,undefined,undefined,'x'.repeat(300)])
 assert.equal(await f.tree.type(result.nextRoot,'/nodes/7/state/long'),'string','a grown value becomes blocks again')
 assert.equal(JSON.stringify(await f.tree.get(root)),JSON.stringify(smallNodes()),'the base root is unchanged')
 for(const op of [{op:'set',path:'/nodes/3/alias/x',value:1},{op:'set',path:'/nodes/3/missing/x',value:1},{op:'remove',path:'/nodes/3/missing'},
  {op:'delta',path:'/nodes/3/alias',value:1},{op:'delta',path:'/nodes/3/missing',value:1},{op:'set',path:'/nodes/3/ref/2',value:1},{op:'remove',path:'/nodes/3/ref/-'}])
  await assert.rejects(f.tree.apply(root,[op]),{code:'STATE_DELTA_INVALID'},JSON.stringify(op))
 // Both replicas compute the same inline encoding.
 const replica=fixture(),remote=await replica.tree.create(smallNodes())
 assert.equal(await replica.tree.receive(remote,JSON.parse(JSON.stringify(result))),result.nextRoot)
})
test('trees written with a block per container still read and patch',async()=>{
 // The previous encoding: every object and array is its own node with a bucket.
 const f=fixture()
 async function old(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value).length<=128?{value}:{ref:await f.adapter.write({type:'scalar',value})}
  const keys=Object.keys(value),items=[]
  for(let order=0;order<keys.length;order++)items.push([keys[order],await old(value[keys[order]]),order])
  items.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0)
  return {ref:await f.adapter.write({type:Array.isArray(value)?'array':'object',size:keys.length,nextOrder:keys.length,entries:items.length?await f.adapter.write({type:'bucket',items}):null})}
 }
 const value={nodes:[{alias:'a',ref:[0]},{alias:'b',ref:[1]}],state:{id:'calm'}},root=(await old(value)).ref
 assert.deepEqual(await f.tree.get(root),value)
 assert.deepEqual((await f.tree.getFields(root,['/nodes/1/ref'])).nodes[1],{ref:[1]})
 const next=await f.tree.apply(root,[{op:'set',path:'/nodes/1/ref/0',value:5},{op:'set',path:'/nodes/-',value:{alias:'c',ref:[2]}}])
 assert.deepEqual(await f.tree.get(next.nextRoot),{nodes:[{alias:'a',ref:[0]},{alias:'b',ref:[5]},{alias:'c',ref:[2]}],state:{id:'calm'}})
 assert.equal(await f.tree.get(next.nextRoot,'/nodes/0/ref/0'),0)
})
