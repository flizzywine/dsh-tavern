import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createConversationPageStore} from '../tavern-plugin/lib/domain/conversation-page-store.js'

for(const fallback of [false,true])test(`record packs preserve hash lookup, standalone dedup and detached reads; fallback=${fallback}`,async t=>{
 const root=await mkdtemp(join(tmpdir(),'record-pack-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const options=fallback?{linkFile:async()=>{throw Object.assign(Error('unsupported'),{code:'ENOTSUP'})}}:{}
 const store=createConversationPageStore({root,...options})
 const values=[{type:'scalar',value:'one'},{type:'scalar',value:'two'}]
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
 await writeFile(file(refs[0]),'{corrupt')
 await assert.rejects(createConversationPageStore({root}).readRecord('a',refs[0]),/checksum/)
})

test('sweep marks packed blocks through the read cache, not a whole-pack parse per block',async t=>{
 const root=await mkdtemp(join(tmpdir(),'record-pack-sweep-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createConversationPageStore({root})
 const values=Array.from({length:96},(_,i)=>({type:'scalar',value:'value '+i+' '+'x'.repeat(400)}))
 const refs=await store.writeRecords('a',values)
 await store.create('a',{state:{title:'测试'},messages:refs.map(runtimeRef=>({runtimeRef}))})
 const packBytes=(await stat(join(root,'a/blocks',refs[0].slice(0,2),refs[0]+'.json'))).size
 const fresh=createConversationPageStore({root}),parse=JSON.parse
 let parsedChars=0,result
 JSON.parse=(text,...args)=>{parsedChars+=text.length;return parse(text,...args)}
 try {result=await fresh.sweep('a',{dryRun:true,graceMs:0})}
 finally {JSON.parse=parse}
 assert.equal(result.removed,0)
 assert.ok(result.reachable>refs.length,'every record and the head blocks are reachable')
 assert.ok(parsedChars<2*packBytes,`parsed ${parsedChars} chars for a ${packBytes} byte pack of 96 blocks`)
})

test('a fragmented head is rewritten in read order into contiguous packs; reads stay identical and later maintenance leaves it',async t=>{
 const root=await mkdtemp(join(tmpdir(),'record-pack-relayout-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createConversationPageStore({root}),floors=20,depth=40
 // Each write packs one block of every floor, as commits that touch every floor would.
 const leaves=Array.from({length:floors},()=>[])
 for(let d=0;d<depth;d++){
  const refs=await store.writeRecords('a',Array.from({length:floors},(_,f)=>({type:'scalar',value:`floor ${f} 「段落」 ${d}`})))
  refs.forEach((ref,f)=>leaves[f].push(ref))
 }
 const roots=await store.writeRecords('a',leaves.map(children=>({type:'object',children})))
 await store.create('a',{state:{title:'测试'},messages:roots.map(runtimeRef=>({runtimeRef}))})
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
 const before=await readAll(),measured=await store.relayout('a',{dryRun:true})
 assert.equal(measured.fragmented,true)
 assert.ok(measured.visits>2*measured.ideal,'every floor touches every commit pack')
 assert.equal(measured.blocks,floors*(depth+1)+4,'head, metadata, state, page and every floor block')
 const io=[],unlinkable=createConversationPageStore({root,onIO:event=>io.push(event),linkFile:async()=>{throw Object.assign(Error('unsupported'),{code:'ENOTSUP'})}})
 assert.equal((await unlinkable.relayout('a')).relinked,0)
 assert.equal(io.some(event=>event.kind==='write'),false,'without hard links nothing is rewritten')
 const applied=await store.relayout('a')
 assert.equal(applied.relinked,measured.blocks)
 const after=await readAll(),remeasured=await store.relayout('a',{dryRun:true})
 assert.equal(after.json,before.json,'the same history, state and records')
 assert.equal(remeasured.fragmented,false)
 assert.equal(remeasured.visits,remeasured.ideal,'each unit reads only its own contiguous packs')
 assert.ok(after.reads*4<before.reads,`cold reads ${before.reads} -> ${after.reads}`)
 io.length=0
 assert.equal((await createConversationPageStore({root,onIO:event=>io.push(event)}).relayout('a')).fragmented,false)
 assert.equal(io.some(event=>event.kind==='write'),false,'a contiguous head is left alone')
 // The sweep frees the emptied commit packs and keeps the new ones.
 await store.sweep('a',{graceMs:0})
 assert.equal((await readAll()).json,before.json)
})