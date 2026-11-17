import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile,stat,mkdir,link,unlink} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {join} from 'node:path'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {createConversationPageStore,recordBlock,blockVisits} from '../tavern-plugin/lib/domain/conversation-page-store.js'
import {createSaveMaintenance} from '../tavern-plugin/lib/domain/save-maintenance.js'
import {createRequestPerformance} from '../tavern-plugin/lib/domain/request-performance.js'

async function syntheticFixture(t,prefix){
 const root=await mkdtemp(join(tmpdir(),prefix))
 t.after(()=>rm(root,{recursive:true,force:true}))
 return root
}

test('sibling reads parse only their own entries of a pack without reserializing its records',async t=>{
 const root=await syntheticFixture(t,'record-pack-cold-')
 const values=Array.from({length:96},(_,i)=>({type:'scalar',value:'value '+i}))
 const refs=await createConversationPageStore({root}).writeRecords('a',values)
 const packBytes=(await stat(join(root,'a/blocks',refs[0].slice(0,2),refs[0]+'.json'))).size
 const io=[],cold=createConversationPageStore({root,onIO:event=>io.push(event)}),parse=JSON.parse,stringify=JSON.stringify
 let parsed=0,parsedChars=0,serialized=0,result
 JSON.parse=(text,...args)=>{parsed++;parsedChars+=text.length;return parse(text,...args)}
 JSON.stringify=(...args)=>{serialized++;return stringify(...args)}
 try {result=await Promise.all(refs.slice(0,8).map(ref=>cold.readRecord('a',ref,{shared:true})))}
 finally {JSON.parse=parse;JSON.stringify=stringify}
 assert.deepEqual(result,values.slice(0,8))
 assert.equal(parsed,8,'each read parses its own entry, never the whole pack')
 assert.ok(parsedChars*4<packBytes,'eight of 96 entries cost a fraction of the pack')
 assert.equal(serialized,0,'cache admission sizes the pack bytes, not every sibling value')
 const reads=io.filter(event=>event.kind==='read').length
 await cold.readRecord('a',refs[90])
 assert.equal(io.filter(event=>event.kind==='read').length,reads,'a later sibling comes from the cached raw pack')
 const detached=await cold.readRecord('a',refs[0]);detached.value='caller edit'
 assert.equal((await cold.readRecord('a',refs[0],{shared:true})).value,values[0].value)
})

test('sweep marks packed blocks through the read cache, not a whole-pack parse per block',async t=>{
 const root=await syntheticFixture(t,'record-pack-sweep-')
 const store=createConversationPageStore({root})
 const values=Array.from({length:96},(_,i)=>({type:'scalar',value:'value '+i+' '+'x'.repeat(400)}))
 const refs=await store.writeRecords('a',values)
 await store.create('a',{state:{title:'测试'},messages:refs.map(runtimeRef=>({runtimeRef}))})
 const packBytes=(await stat(join(root,'a/blocks',refs[0].slice(0,2),refs[0]+'.json'))).size
 const io=[],fresh=createConversationPageStore({root,onIO:event=>io.push(event)}),parse=JSON.parse
 let parsedChars=0,result
 JSON.parse=(text,...args)=>{parsedChars+=text.length;return parse(text,...args)}
 try {result=await fresh.sweep('a',{dryRun:true,graceMs:0})}
 finally {JSON.parse=parse}
 assert.equal(result.removed,0)
 assert.ok(result.reachable>refs.length,'every record and the head blocks are reachable')
 assert.equal(new Set(io.filter(event=>event.reason==='sweep').map(event=>event.ref)).size,io.filter(event=>event.reason==='sweep').length)
 assert.ok(io.filter(event=>event.reason==='sweep' && event.bytes===packBytes).length===1,'the shared pack is read once')
 assert.ok(parsedChars<2*packBytes,`parsed ${parsedChars} chars for a ${packBytes} byte pack of 96 blocks`)
})

test('pack entries are located exactly despite look-alike content',async t=>{
 const root=await syntheticFixture(t,'record-pack-tricky-')
 const store=createConversationPageStore({root})
 const decoy=recordBlock({type:'scalar',value:'decoy'}).ref
 const values=[{type:'scalar',value:`],["${decoy}",{"kind":"record","value":1}]`},{type:'scalar',value:'quote \\" back\\\\ ] } ['},
  {type:'object',items:[[decoy,{kind:'record',value:{nested:[1,[2,{deep:'「中文」🎭'}]]}}]]},{type:'scalar',value:'\\'},{type:'scalar',value:null},
  {type:'scalar',value:'decoy'},...Array.from({length:20},(_,i)=>({type:'scalar',value:'v'+i}))]
 const refs=await store.writeRecords('a',values)
 const fresh=createConversationPageStore({root})
 for(let i=refs.length-1;i>=0;i--)assert.deepEqual(await fresh.readRecord('a',refs[i]),values[i])
 // Older record packs store bare values; each block is still read alone.
 const dir=join(root,'b'),old=[[decoy,{n:1}],['f'.repeat(64),'text ],["x",'],['e'.repeat(64),[1,{a:'b'}]]]
 const bytes=JSON.stringify({kind:'record-pack-v1',records:old})
 for(const [ref] of old){await mkdir(join(dir,'blocks',ref.slice(0,2)),{recursive:true});await writeFile(join(dir,'blocks',ref.slice(0,2),ref+'.json'),bytes)}
 for(const [ref,value] of old)assert.deepEqual(await createConversationPageStore({root}).readRecord('b',ref),value)
 await writeFile(join(dir,'blocks',decoy.slice(0,2),decoy+'.json'),bytes.slice(0,-3))
 await assert.rejects(createConversationPageStore({root}).readRecord('b',decoy),/Invalid immutable block/)
})

for(const fallback of [false,true])test(`record packs preserve hash lookup, standalone dedup and detached reads; fallback=${fallback}`,async t=>{
 const root=await syntheticFixture(t,'record-pack-')
 const options=fallback?{linkFile:async()=>{throw Object.assign(Error('unsupported'),{code:'ENOTSUP'})}}:{}
 const store=createConversationPageStore({root,...options})
 const values=Array.from({length:96},(_,i)=>({type:'scalar',value:'value '+i}))
 const refs=await store.writeRecords('a',values)
 const file=ref=>join(root,'a/blocks',ref.slice(0,2),ref+'.json')
 assert.equal(JSON.parse(await readFile(file(refs[0]),'utf8')).kind,fallback?'record':'block-pack-v1')
 if(!fallback)assert.equal((await stat(file(refs[0]))).ino,(await stat(file(refs[1]))).ino)
 const fresh=createConversationPageStore({root})
 for(let i=0;i<refs.length;i++)assert.deepEqual(await fresh.readRecord('a',refs[i]),values[i])
 const modified=await fresh.readRecord('a',refs[0]);modified.value='changed'
 assert.deepEqual(await fresh.readRecord('a',refs[0]),values[0])
 assert.equal(await store.writeRecord('a',values[0]),refs[0])
 assert.deepEqual(await store.writeRecords('a',values),refs)
 const extra={type:'scalar',value:'new'},mixed=[values[50],extra,...values,extra]
 const mixedRefs=await store.writeRecords('a',mixed,mixed.map(value=>recordBlock(value).ref))
 assert.deepEqual(mixedRefs,[refs[50],recordBlock(extra).ref,...refs,recordBlock(extra).ref])
 for(let i=0;i<mixedRefs.length;i++)assert.deepEqual(await fresh.readRecord('a',mixedRefs[i]),mixed[i])
 const io=[],checking=createConversationPageStore({root,onIO:event=>io.push(event)})
 const invalid=[...values,{type:'scalar',value:'must not publish'}]
 const known=invalid.map(value=>recordBlock(value).ref);known[40]=refs[0]
 await assert.rejects(checking.writeRecords('a',invalid,known),/Immutable block corruption/)
 assert.equal(io.some(event=>event.kind==='write'||event.kind==='link'),false)
 await writeFile(file(refs[0]),'{corrupt')
 await assert.rejects(createConversationPageStore({root}).readRecord('a',refs[0]),/Invalid immutable block/) // blocks are parsed, not re-hashed
})

// Each write packs one block of every floor, as commits that touch every floor would.
async function fragmentedSave(t,prefix){
 const root=await syntheticFixture(t,prefix)
 const store=createConversationPageStore({root}),floors=20,depth=40
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

test('a fragmented head is rewritten in read order into contiguous packs; reads stay identical and later maintenance leaves it',async t=>{
 const {root,store,readAll,floors,depth}=await fragmentedSave(t,'record-pack-relayout-')
 const before=await readAll(),measured=await store.relayout('a',{dryRun:true})
 assert.equal(measured.fragmented,true)
 assert.ok(measured.visits>2*measured.ideal,'every floor touches every commit pack')
 assert.equal(measured.blocks,floors*(depth+1)+4,'head, metadata, state, page and every floor block')
 const applied=await store.relayout('a')
 assert.equal(applied.relinked,measured.blocks)
 const after=await readAll(),remeasured=await store.relayout('a',{dryRun:true})
 assert.equal(after.json,before.json,'the same history, state and records')
 assert.equal(remeasured.fragmented,false)
 assert.equal(remeasured.visits,remeasured.ideal,'each unit reads only its own contiguous packs')
 assert.ok(after.reads*4<before.reads,`cold reads ${before.reads} -> ${after.reads}`)
 const io=[],again=await createConversationPageStore({root,onIO:event=>io.push(event)}).relayout('a')
 assert.equal(again.fragmented,false)
 assert.equal(io.some(event=>event.kind==='write'),false,'a contiguous head is left alone')
 // The sweep frees the emptied commit packs and keeps the new ones.
 await store.sweep('a',{graceMs:0})
 assert.equal((await readAll()).json,before.json)
})

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

test('a cold stage read of a fragmented save queues one quiet maintenance relayout; a laid-out save does not',async t=>{
 const {store,readAll}=await fragmentedSave(t,'record-pack-cold-relayout-')
 // The signal is the traced request's read rows, as cold-reads.jsonl records them.
 const rows=[],trace=createRequestPerformance({onColdRead:row=>{if(row.phase==='end')rows.push(row)}})
 t.after(()=>trace.dispose())
 const coldVisits=async()=>{await trace.run('getAssetPackPresentation','',readAll);return blockVisits(rows.at(-1).reads).get('a')}
 // This small save's commit packs all fit the read cache, so a cold read loads each once.
 const threshold=32,timers=new Set(),relayouts=[],saved=[]
 const maintenance=createSaveMaintenance({
  chats:{readRetentionHeader:async id=>({id,_storageRevision:7,timeline:{checkpoints:[]}}),
   relayout:async id=>{const result=await store.relayout(id);relayouts.push(result);return result},compact:async()=>({bytes:0})},
  store:{readJson:async()=>undefined,writeJson:async(_path,value)=>{saved.push(structuredClone(value))}},
  listChatIds:async()=>[],requestLog:{prune:async()=>{}},recallLog:{prune:async()=>{}},isIdle:async()=>true,logger:{log(){},warn(){}},coldVisits:threshold,
  setTimer:(fn,ms)=>{const id={fn,ms};timers.add(id);return id},clearTimer:id=>timers.delete(id)
 })
 t.after(()=>maintenance.dispose())
 const fire=async()=>{const [timer]=timers;timers.delete(timer);timer.fn();await maintenance.sweep()}
 const fragmented=await coldVisits()
 assert.ok(fragmented>=threshold,`fragmented cold read visits ${fragmented} packs`)
 maintenance.noteColdRead('a',fragmented)
 assert.equal(relayouts.length,0,'nothing runs while the game is being paged')
 maintenance.noteColdRead('a',fragmented)
 assert.equal(timers.size,1,'another cold read restarts the same quiet period')
 assert.equal([...timers][0].ms,600000)
 await fire()
 assert.equal(relayouts.length,1)
 assert.equal(relayouts[0].fragmented,true)
 assert.ok(relayouts[0].relinked>0,'the existing relayout rewrote the head')
 assert.equal(saved.at(-1).laidOut.a,7,'the measured revision is remembered')
 assert.equal((await store.relayout('a',{dryRun:true})).fragmented,false)
 const laidOut=await coldVisits()
 assert.ok(laidOut*4<fragmented,`cold read ${fragmented} -> ${laidOut} packs`)
 maintenance.noteColdRead('a',laidOut)
 assert.equal(timers.size,0,'a laid-out save does not queue maintenance')
 // Even a heavy read is not re-measured within everyRevisions of the measured head.
 maintenance.noteColdRead('a',threshold)
 await fire()
 assert.equal(relayouts.length,1)
})
// The sweep lists and marks without the lock; only its deleting steps take it.
async function aged(root,id){
 const {readdir,utimes}=await import('node:fs/promises')
 const old=new Date(Date.now()-3600000)
 for(const shard of await readdir(join(root,id,'blocks')))for(const name of await readdir(join(root,id,'blocks',shard)))await utimes(join(root,id,'blocks',shard,name),old,old)
}

test('a commit between two sweep steps may reuse a block the sweep listed as garbage: it is kept',async t=>{
 const root=await syntheticFixture(t,'sweep-steps-')
 const store=createConversationPageStore({root})
 // create() flushes its first graph as one pack; the swept blocks below come from standalone commits.
 await store.create('a',{state:{scene:'初始'},messages:[]})
 await store.commit('a',{expectedRevision:1,state:{scene:'旧场景'}})
 await store.commit('a',{expectedRevision:2,state:{scene:'新场景'}})
 await aged(root,'a')
 let commits=0
 const result=await store.sweep('a',{graceMs:60000,exclusive:async step=>{
  // Back to the old state: its block is unreachable and old, and already listed.
  if(!commits++)await store.commit('a',{expectedRevision:3,state:{scene:'旧场景'}})
  return step()
 }})
 assert.ok(commits>=1,'deletions ran in locked steps')
 assert.ok(result.removed>0)
 assert.deepEqual(await createConversationPageStore({root}).readState('a'),{scene:'旧场景'})
})

// The live disk stalls a stat or unlink for 10-24 s now and then (2026-10-27): a deleting step must still let go of the lock.
test('a removal stalling past a whole step does not hold the write lock; the sweep still removes every garbage file',async t=>{
 const root=await syntheticFixture(t,'sweep-stall-')
 const writer=createConversationPageStore({root})
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
 const writer=createConversationPageStore({root})
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
 const store=createConversationPageStore({root})
 await store.create('a',{state:{n:1},messages:[]})
 const ref=await store.writeRecord('a',{draft:'写在提交之前的记录'})
 await aged(root,'a')
 // A writer prepares a record before its commit; the content already exists, unreferenced.
 assert.equal(await store.writeRecord('a',{draft:'写在提交之前的记录'}),ref)
 await store.sweep('a',{graceMs:60000})
 assert.deepEqual(await createConversationPageStore({root}).readRecord('a',ref),{draft:'写在提交之前的记录'})
})

test('pruning the record index publishes in one short step and keeps the keys commits added meanwhile',async t=>{
 const root=await syntheticFixture(t,'prune-steps-')
 const store=createConversationPageStore({root})
 await store.create('a',{state:{n:0},messages:[]})
 for(let i=1;i<=6;i++)await store.commit('a',{expectedRevision:i,state:{n:i},records:[['drop:'+i,{i}],['keep:'+i,{i}]]})
 let steps=0
 const pruned=await store.pruneEntries('a',key=>!key.startsWith('drop:'),{exclusive:async step=>{
  steps++
  await store.commit('a',{expectedRevision:7,state:{n:7},records:[['late:7',{i:7}],['keep:1',{i:'changed'}]]})
  return step()
 }})
 assert.equal(steps,1)
 assert.equal(pruned.removed,6)
 const fresh=createConversationPageStore({root})
 const keys=['drop:1','drop:6','keep:1','keep:6','late:7']
 assert.deepEqual(await fresh.readEntries('a',keys),{'keep:1':{i:'changed'},'keep:6':{i:6},'late:7':{i:7}})
 assert.deepEqual(await fresh.readState('a'),{n:7})
})