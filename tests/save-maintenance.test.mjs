import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from "node:fs/promises"
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
