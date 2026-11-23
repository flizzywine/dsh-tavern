import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readdir } from "node:fs/promises"
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {createSaveMaintenance} from '../tavern-plugin/lib/domain/save-maintenance.js'

const big=n=>'x'.repeat(4096)+n
async function fixture(t,{idle=true,timers,onSave=()=>{},now}={}){
 const root=await mkdtemp(join(tmpdir(),'save-maint-'))
 t.after(()=>rm(root,{recursive:true,force:true}))
 const commits=[]
 let maintenance
 // As the host wires it: the store reports every committed revision to maintenance.
 const chats=createChatJournalStore({dataRoot:root,newConversations:true,onCommit:(id,revision)=>{commits.push([id,revision]);maintenance?.noteWrite(id,revision)}})
 const persistence=createChatPersistence({store:chats})
 const files=new Map(),pruned=[]
 maintenance=createSaveMaintenance({
  ...(now?{now}:{}),
  chats,store:{readJson:async p=>structuredClone(files.get(p)),writeJson:async(p,v)=>{files.set(p,structuredClone(v));onSave(p,v)}},
  listChatIds:async()=>(await readdir(join(root,'chats'),{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name),
  requestLog:{prune:async id=>{pruned.push('requests:'+id)}},recallLog:{prune:async id=>{pruned.push('recalls:'+id)}},
  isIdle:async()=>idle,keepRecent:2,graceMs:0,logger:{log(){},warn(){}},everyRevisions:5,
  ...(timers?{setTimer:(fn,ms)=>{const id={fn,ms};timers.add(id);return id},clearTimer:id=>timers.delete(id)}:{})
 })
 const reopen=()=>createChatPersistence({store:createChatJournalStore({dataRoot:root})})
 t.after(()=>maintenance.dispose())
 return {root,chats,persistence,maintenance,pruned,files,reopen,commits}
}
// Every file of a save's block store (shards and packs), as the disk sees it.
test('每次提交都计入整理（不只是回合结算），一直有写入时最迟两个安静期后整理', {timeout:30000}, async t => {
 const timers=new Set()
 let clock=1000000,completed
 const completion=new Promise(resolve=>{completed=resolve})
 const {persistence,files}=await fixture(t,{timers,now:()=>clock,onSave:(_path,value)=>{if(value.compacted?.w)completed()}})
 await persistence.write({id:'w',mode:'story',messages:[{role:'assistant',text:big(0)}]})
 for(let i=1;i<=6;i++)await persistence.update('w',chat=>({...chat,cardContextRevision:i}))
 assert.equal(timers.size,1,'非回合写入也排上整理')
 assert.equal([...timers][0].ms,600000)
 clock+=900000
 await persistence.update('w',chat=>({...chat,cardContextRevision:7}))
 assert.equal([...timers][0].ms,300000,'不再无限推迟：第一次等待后最迟 20 分钟')
 const [timer]=timers
 timers.delete(timer); timer.fn()
 await completion
 assert.equal(files.get('save-maintenance.json').compacted.w,8)
})
