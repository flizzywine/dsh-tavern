import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, stat, link, unlink } from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import { createConversationPageStore, recordBlock } from '../tavern-plugin/lib/domain/conversation-page-store.js'

async function syntheticFixture(t,prefix){
 const root=await mkdtemp(join(tmpdir(),prefix))
 t.after(()=>rm(root,{recursive:true,force:true}))
 return root
}

for(const fallback of [false,true])test(`record packs preserve hash lookup, standalone dedup and detached reads; fallback=${fallback}`,async t=>{
 const root=await syntheticFixture(t,'record-pack-')
 const options=fallback?{format:2,linkFile:async()=>{throw Object.assign(Error('unsupported'),{code:'ENOTSUP'})}}:{format:2}
 const store=createConversationPageStore({root,...options})
 const values=Array.from({length:96},(_,i)=>({type:'scalar',value:'value '+i}))
 const refs=await store.writeRecords('a',values)
 const file=ref=>join(root,'a/blocks',ref.slice(0,2),ref+'.json')
 assert.equal(JSON.parse(await readFile(file(refs[0]),'utf8')).kind,fallback?'record':'block-pack-v1')
 if(!fallback)assert.equal((await stat(file(refs[0]))).ino,(await stat(file(refs[1]))).ino)
 const fresh=createConversationPageStore({root,format:2})
 for(let i=0;i<refs.length;i++)assert.deepEqual(await fresh.readRecord('a',refs[i]),values[i])
 const modified=await fresh.readRecord('a',refs[0]);modified.value='changed'
 assert.deepEqual(await fresh.readRecord('a',refs[0]),values[0])
 assert.equal(await store.writeRecord('a',values[0]),refs[0])
 assert.deepEqual(await store.writeRecords('a',values),refs)
 const extra={type:'scalar',value:'new'},mixed=[values[50],extra,...values,extra]
 const mixedRefs=await store.writeRecords('a',mixed,mixed.map(value=>recordBlock(value).ref))
 assert.deepEqual(mixedRefs,[refs[50],recordBlock(extra).ref,...refs,recordBlock(extra).ref])
 for(let i=0;i<mixedRefs.length;i++)assert.deepEqual(await fresh.readRecord('a',mixedRefs[i]),mixed[i])
 const io=[],checking=createConversationPageStore({root,format:2,onIO:event=>io.push(event)})
 const invalid=[...values,{type:'scalar',value:'must not publish'}]
 const known=invalid.map(value=>recordBlock(value).ref);known[40]=refs[0]
 await assert.rejects(checking.writeRecords('a',invalid,known),/Immutable block corruption/)
 assert.equal(io.some(event=>event.kind==='write'||event.kind==='link'),false)
 await writeFile(file(refs[0]),'{corrupt')
 await assert.rejects(createConversationPageStore({root,format:2}).readRecord('a',refs[0]),/Invalid immutable block/) // blocks are parsed, not re-hashed
})

// Each write packs one block of every floor, as commits that touch every floor would.
async function fragmentedSave(t,prefix){
 const root=await syntheticFixture(t,prefix)
 const store=createConversationPageStore({root,format:2}),floors=20,depth=40
 const leaves=Array.from({length:floors},()=>[])
 for(let d=0;d<depth;d++){
  const refs=await store.writeRecords('a',Array.from({length:floors},(_,f)=>({type:'scalar',value:`floor ${f} 「段落」 ${d}`})))
  refs.forEach((ref,f)=>leaves[f].push(ref))
 }
 const roots=await store.writeRecords('a',leaves.map(children=>({type:'object',children})))
 await store.create('a',{state:{title:'测试'},messages:roots.map(runtimeRef=>({runtimeRef}))})
 // A cold open of every floor in a fresh process.
 async function readAll(){
  const io=[],fresh=createConversationPageStore({root,onIO:event=>io.push(event)})
  const opened=await fresh.openConversation('a',{limit:50}),rows=[]
  for(const {message} of [...opened.messages].reverse()){
   const node=await fresh.readRecord('a',message.runtimeRef)
   const row=[node]
   for(const ref of node.children)row.push(await fresh.readRecord('a',ref))
   rows.push(row)
  }
  return {json:JSON.stringify([opened,rows]),reads:io.filter(event=>event.kind==='read').length}
 }
 return {root,store,readAll,floors,depth}
}

test('relayout relinks in bounded lock steps, with the same reads',async t=>{
 const {root,readAll}=await fragmentedSave(t,'record-pack-relayout-steps-')
 const before=await readAll()
 // Slow links, one of them stalling past a whole step: the relink takes several budgets, and one contiguous pack holds
 // far more links than one step. Links are made outside the write lock, so the stall never holds it.
 let calls=0
 const slow=createConversationPageStore({root,linkFile:async(from,to)=>{await new Promise(resolve=>setTimeout(resolve,++calls===40 ? 450 : 15));return link(from,to)}})
 const applied=await slow.relayout('a')
 assert.equal(applied.relinked,applied.blocks)
 assert.ok(applied.relinkMs>4*300,`relink ${applied.relinkMs} ms`)
 assert.ok(applied.maxLockMs<=300,`longest hold ${applied.maxLockMs} ms`)
 assert.equal((await readAll()).json,before.json)
})

// The sweep lists and marks without the lock; only its deleting steps take it.
async function aged(root,id){
 const {readdir,utimes}=await import('node:fs/promises')
 const old=new Date(Date.now()-3600000)
 for(const shard of await readdir(join(root,id,'blocks')))for(const name of await readdir(join(root,id,'blocks',shard)))await utimes(join(root,id,'blocks',shard,name),old,old)
}

// The live disk stalls a stat or unlink for 10-24 s now and then (2026-10-27): a deleting step must still let go of the lock.
test('a removal stalling past a whole step does not hold the write lock; the sweep still removes every garbage file',async t=>{
 const root=await syntheticFixture(t,'sweep-stall-')
 const writer=createConversationPageStore({root,format:2})
 await writer.create('a',{state:{n:0},messages:[]})
 for(let i=1;i<=40;i++)await writer.commit('a',{expectedRevision:i,state:{n:i}})
 await aged(root,'a')
 let calls=0
 const store=createConversationPageStore({root,unlinkFile:async file=>{await new Promise(resolve=>setTimeout(resolve,++calls===5 ? 900 : 2));return unlink(file)}})
 const holds=[]
 const result=await store.sweep('a',{graceMs:60000,retainEntry:()=>false,exclusive:async step=>{const started=performance.now();try{return await step()}finally{holds.push(performance.now()-started)}}})
 assert.ok(result.removed>=40,`removed ${result.removed}`)
 assert.ok(calls>5)
 assert.ok(result.maxLockMs<=300,`longest step ${result.maxLockMs} ms`)
 assert.ok(Math.max(...holds)<450,`longest hold ${Math.round(Math.max(...holds))} ms`)
 assert.deepEqual(await createConversationPageStore({root}).readState('a'),{n:40})
 assert.equal((await store.sweep('a',{graceMs:60000,retainEntry:()=>false,dryRun:true})).removed,0)
})

test('a commit reusing a block whose removal outlives the step waits for it and writes the block again',async t=>{
 const root=await syntheticFixture(t,'sweep-stall-reuse-')
 const writer=createConversationPageStore({root,format:2})
 await writer.create('a',{state:{scene:'旧场景'},messages:[]})
 await writer.commit('a',{expectedRevision:1,state:{scene:'新场景'}})
 await aged(root,'a')
 const old=createHash('sha256').update(JSON.stringify({kind:'state',value:{scene:'旧场景'}})).digest('hex')
 let stalled,release
 const started=new Promise(resolve=>{stalled=resolve})
 const store=createConversationPageStore({root,unlinkFile:async file=>{
  if(file.endsWith(old+'.json')){stalled();await new Promise(resolve=>{release=resolve})}
  return unlink(file)
 }})
 const sweeping=store.sweep('a',{graceMs:60000,retainEntry:()=>false})
 await started
 // The step has released the lock; the commit returns to the old state whose block is being removed.
 let committed=false
 const commit=store.commit('a',{expectedRevision:2,state:{scene:'旧场景'}}).then(()=>{committed=true})
 await new Promise(resolve=>setTimeout(resolve,400))
 assert.equal(committed,false,'the commit waits for the pending removal')
 release()
 await Promise.all([sweeping,commit])
 assert.deepEqual(await createConversationPageStore({root}).readState('a'),{scene:'旧场景'})
})

test('a deduplicated write of an old unreachable block renews its grace period',async t=>{
 const root=await syntheticFixture(t,'sweep-dedup-')
 const store=createConversationPageStore({root,format:2})
 await store.create('a',{state:{n:1},messages:[]})
 const ref=await store.writeRecord('a',{draft:'写在提交之前的记录'})
 await aged(root,'a')
 // A writer prepares a record before its commit; the content already exists, unreferenced.
 assert.equal(await store.writeRecord('a',{draft:'写在提交之前的记录'}),ref)
 await store.sweep('a',{graceMs:60000})
 assert.deepEqual(await createConversationPageStore({root}).readRecord('a',ref),{draft:'写在提交之前的记录'})
})
