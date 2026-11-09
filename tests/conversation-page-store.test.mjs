import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createConversationPageStore} from '../tavern-plugin/lib/domain/conversation-page-store.js'

async function fixture(t, count=20000) {
 const root=await mkdtemp(join(tmpdir(),'conversation-pages-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const io=[]
 const store=createConversationPageStore({root,onIO:event=>io.push(event)})
 await store.create('a',{metadata:{card:'test'},state:{gold:10},messages:Array.from({length:count},(_,i)=>({id:'m'+i,text:'body '+i}))})
 io.length=0
 return {root,store,io}
}

test('stale writers conflict across store instances without losing committed history',async t=>{
 const {root,store}=await fixture(t,4)
 const another=createConversationPageStore({root})
 await store.commit('a',{expectedRevision:1,append:[{id:'new'}]})
 await assert.rejects(another.commit('a',{expectedRevision:1,state:{gold:0}}),{code:'CONVERSATION_CONFLICT'})
 const result=await another.openConversation('a')
 assert.equal(result.messageCount,5);assert.equal(result.state.gold,10)
})

test('pagination includes every row exactly once across tree growth and rejects foreign cursors',async t=>{
 const {store}=await fixture(t,2050)
 const first=await store.openConversation('a',{limit:137})
 let page=first,positions=[]
 while(true){positions.push(...page.messages.map(row=>row.position));if(!page.previousCursor)break;page=await store.readHistoryPage('a',{cursor:page.previousCursor,limit:137})}
 assert.equal(new Set(positions).size,2050)
 assert.equal(positions.length,2050)
 await store.create('b',{state:{},messages:[]})
 await assert.rejects(store.readHistoryPage('b',{cursor:first.previousCursor}),/cursor/)
 await assert.rejects(store.openConversation('../a'),/id/)
 await assert.rejects(store.commit('a',{expectedRevision:1,edits:[{position:2050,message:{}}]}),/position/)
 assert.equal((await store.openConversation('a')).revision,1)
})

for(const count of [0,63,2047])test('append across page/index growth from '+count,async t=>{
 const {root,store}=await fixture(t,count)
 await store.commit('a',{expectedRevision:1,append:[{id:'x'},{id:'y'}]})
 const cold=await createConversationPageStore({root}).openConversation('a',{limit:2})
 assert.deepEqual(cold.messages.map(r=>r.message.id),['x','y'])
 assert.equal(cold.messageCount,count+2)
})

test('two real processes cannot both commit from the same revision',async t=>{
 const {root}=await fixture(t,4)
 const {spawn}=await import('node:child_process')
 const moduleUrl=new URL('../tavern-plugin/lib/domain/conversation-page-store.js',import.meta.url).href
 const source=`import {createConversationPageStore} from ${JSON.stringify(moduleUrl)};try{await createConversationPageStore({root:process.argv[1]}).commit('a',{expectedRevision:1,append:[{id:process.argv[2]}]});console.log('committed')}catch(e){console.log(e.code);if(!['CONVERSATION_CONFLICT','DSH_TAVERN_WRITE_CONFLICT'].includes(e.code))process.exitCode=1}`
 const run=id=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',source,root,id]);let out='',err=''
  child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject)
  child.on('exit',code=>code===0?resolve(out.trim()):reject(Error(err)))
 })
 const result=await Promise.all([run('one'),run('two')])
 assert.equal(result.filter(v=>v==='committed').length,1)
 assert.equal((await createConversationPageStore({root}).openConversation('a')).messageCount,5)
})

test('process death before head publication preserves old state and recovers writer lock',async t=>{
 const {root}=await fixture(t,4)
 const {spawn}=await import('node:child_process')
 const moduleUrl=new URL('../tavern-plugin/lib/domain/conversation-page-store.js',import.meta.url).href
 const source=`import {createConversationPageStore} from ${JSON.stringify(moduleUrl)};await createConversationPageStore({root:process.argv[1],onIO:e=>{if((e.kind==='write'||e.kind==='link')&&e.type==='head')process.exit(42)}}).commit('a',{expectedRevision:1,state:{gold:0},append:[{id:'interrupted'}]})`
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',source,root],{stdio:'ignore'});child.on('error',reject);child.on('exit',resolve)})
 assert.equal(code,42)
 const fresh=createConversationPageStore({root})
 assert.equal((await fresh.openConversation('a')).state.gold,10)
 await fresh.commit('a',{expectedRevision:1,append:[{id:'retry'}]})
 const current=await fresh.openConversation('a')
 assert.equal(current.messageCount,5);assert.equal(current.messages.at(-1).message.id,'retry')
})

test('corrupt immutable pages fail explicitly instead of returning incomplete history',async t=>{
 const {root}=await fixture(t,1)
 const {readFile,writeFile}=await import('node:fs/promises')
 const pointer=JSON.parse(await readFile(join(root,'a','head.json'),'utf8'))
 const block=id=>join(root,'a','blocks',id.slice(0,2),id+'.json')
 async function blockValue(id){
  const stored=JSON.parse(await readFile(block(id),'utf8'))
  if(stored.kind==='block-pack-v1')return stored.records.find(([ref])=>ref===id)[1]
  return stored
 }
 const head=await blockValue(pointer.headId)
 await writeFile(block(head.root),'{}')
 await assert.rejects(createConversationPageStore({root}).openConversation('a'),/checksum/)
})
