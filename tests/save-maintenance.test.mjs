import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,mkdir,writeFile,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {createSaveMaintenance} from '../tavern-plugin/lib/domain/save-maintenance.js'

const big=n=>'x'.repeat(4096)+n
async function fixture(t,{idle=true}={}){
 const root=await mkdtemp(join(tmpdir(),'save-maint-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const chats=createChatJournalStore({dataRoot:root,newConversations:true})
 const persistence=createChatPersistence({store:chats})
 const files=new Map(),pruned=[]
 const maintenance=createSaveMaintenance({
  chats,store:{readJson:async p=>structuredClone(files.get(p)),writeJson:async(p,v)=>files.set(p,structuredClone(v))},
  listChatIds:async()=>(await readdir(join(root,'chats'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name),
  requestLog:{prune:async id=>{pruned.push('requests:'+id)}},recallLog:{prune:async id=>{pruned.push('recalls:'+id)}},
  isIdle:async()=>idle,keepRecent:2,graceMs:0,logger:{log(){},warn(){}}
 })
 const reopen=()=>createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 return {root,chats,persistence,maintenance,pruned,files,reopen}
}

test('空闲时整理：清掉回退与撤销用不到的旧版本和调试日志，保留的仍可读', async t => {
 const {persistence,maintenance,pruned,reopen}=await fixture(t)
 await persistence.write({id:'a',mode:'story',messages:[{role:'assistant',text:big(0)}]})
 for(let i=1;i<=10;i++)await persistence.patch('a',i,[{op:'set',path:['messages',0,'text'],value:big(i)}])
 await persistence.update('a',chat=>{chat.timeline={checkpoints:[{turn:1,beforeRevision:4}]};return chat})
 const current=await persistence.read('a'),kept=await persistence.readRevision('a',4)
 const result=await maintenance.sweep()
 assert.ok(result.freed>0)
 assert.deepEqual(pruned,['requests:a','recalls:a'])
 const fresh=reopen()
 assert.deepEqual(await fresh.read('a'),current)
 assert.deepEqual(await fresh.readRevision('a',4),kept)
 await assert.rejects(fresh.readRevision('a',2),{code:'DSH_TAVERN_REVISION_NOT_FOUND'})
 // Nothing changed since: the next pass does not walk the save again.
 assert.equal((await maintenance.maintainChat('a')).status,'unchanged')
})

test('分叉引用的父局版本保留；有任务进行时不整理', async t => {
 const {persistence,maintenance,reopen}=await fixture(t)
 await persistence.write({id:'p',mode:'story',messages:[{role:'assistant',text:big(0)}]})
 for(let i=1;i<=8;i++)await persistence.patch('p',i,[{op:'set',path:['messages',0,'text'],value:big(i)}])
 const parentAt3=await persistence.readRevision('p',3)
 await persistence.write({id:'c',mode:'story',forkedFrom:{chatId:'p',storageRevision:3},messages:[{role:'assistant',text:'fork'}]})
 await maintenance.sweep()
 assert.deepEqual(await reopen().readRevision('p',3),parentAt3)
 const busy=await fixture(t,{idle:false})
 await busy.persistence.write({id:'b',mode:'story',messages:[{role:'assistant',text:big(0)}]})
 assert.equal((await busy.maintenance.maintainChat('b')).status,'busy')
})

test('规则整理：保存增长到设定的版本数后，结算后立即整理一次', async t => {
 const root=await mkdtemp(join(tmpdir(),'save-rule-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const chats=createChatJournalStore({dataRoot:root,newConversations:true})
 const persistence=createChatPersistence({store:chats})
 const files=new Map(),calls=[]
 const maintenance=createSaveMaintenance({chats,store:{readJson:async p=>structuredClone(files.get(p)),writeJson:async(p,v)=>files.set(p,structuredClone(v))},
  listChatIds:async()=>['a'],requestLog:{prune:async()=>calls.push('prune')},recallLog:{prune:async()=>{}},isIdle:async()=>true,
  keepRecent:2,everyRevisions:5,graceMs:0,logger:{log(){},warn(){}}})
 await persistence.write({id:'a',mode:'story',messages:[{role:'assistant',text:big(0)}]})
 for(let i=1;i<=3;i++)await persistence.patch('a',i,[{op:'set',path:['messages',0,'text'],value:big(i)}])
 maintenance.noteWrite('a',4)
 await maintenance.sweep().catch(()=>{}) // drain the serial queue
 calls.length=0
 maintenance.noteWrite('a',4)
 for(let i=4;i<=10;i++)await persistence.patch('a',i,[{op:'set',path:['messages',0,'text'],value:big(i)}])
 maintenance.noteWrite('a',6)
 await maintenance.maintainChat('a')
 assert.deepEqual(calls,['prune'])
 maintenance.noteWrite('a',11)
 await maintenance.maintainChat('a')
 assert.equal(files.get('save-maintenance.json').compacted.a,11)
})

test('只保留最近 N 轮的分叉历史：更早的检查点版本被清理，最近的与撤销点保留', async t => {
 const {retainedRevisions}=await import('../tavern-plugin/lib/domain/conversation-retention.js')
 const states={}
 for(let turn=1;turn<=8;turn++)states[turn*10]={id:'a',_storageRevision:turn*10,timeline:{checkpoints:turn>1?[{turn:turn-1,beforeRevision:(turn-1)*10}]:[]}}
 const chat={id:'a',_storageRevision:100,timeline:{checkpoints:[{turn:7,beforeRevision:70},{turn:8,beforeRevision:80}]},rollbackUndo:{beforeRevision:15}}
 const read=async(id,revision)=>states[revision]
 assert.deepEqual([...await retainedRevisions(chat,read,[])].sort((a,b)=>a-b),[10,15,20,30,40,50,60,70,80])
 assert.deepEqual([...await retainedRevisions(chat,read,[],{keepTurns:3})].sort((a,b)=>a-b),[15,60,70,80])
})
