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
async function blockFiles(root,id){
 let count=0
 for(const entry of await readdir(join(root,'chats',id,'blocks'),{withFileTypes:true}).catch(()=>[]))
  if(entry.isDirectory())count+=(await readdir(join(root,'chats',id,'blocks',entry.name))).length
 return count
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
// chat-mvl53223-joqbuf: 46 万次只改了修订号的保存，写出约 1,000 万个块文件。
test('没有变化的保存不落盘：除了修订号和时间戳没有改动，就不提交、不写块', async t => {
 const {root,persistence,commits}=await fixture(t)
 await persistence.write({id:'n',mode:'story',title:'旧',messages:[{role:'assistant',text:'开场'}]})
 const files=await blockFiles(root,'n'),before=commits.length
 for(let i=0;i<3;i++)await persistence.update('n',chat=>chat)
 await persistence.update('n',chat=>({...chat,title:'旧'}))
 await persistence.write(await persistence.read('n'))
 assert.equal((await persistence.read('n'))._storageRevision,1,'修订号不变')
 assert.equal(await blockFiles(root,'n'),files,'没有新块')
 assert.equal(commits.length,before,'没有提交')
 await persistence.update('n',chat=>({...chat,title:'新'}))
 assert.equal((await persistence.read('n'))._storageRevision,2,'真正的改动照常提交')
 assert.equal(commits.length,before+1)
})

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

test('启动后补做：积压达到阈值的存档整理，其余不动', {timeout:30000}, async t => {
 const timers=new Set()
 const {persistence,maintenance,files}=await fixture(t,{timers})
 await persistence.write({id:'old',mode:'story',messages:[{role:'assistant',text:big(0)}]})
 for(let i=1;i<=8;i++)await persistence.patch('old',i,[{op:'set',path:['messages',0,'text'],value:big(i)}])
 await persistence.write({id:'small',mode:'story',messages:[{role:'assistant',text:'少'}]})
 timers.clear() // the write notes of this process; a start has none
 maintenance.catchUp()
 assert.equal(timers.size,1)
 const [timer]=timers
 assert.equal(timer.ms,120000,'启动后两分钟：宿主常常重启，等不到十分钟的安静期')
 timers.delete(timer); timer.fn()
 assert.equal((await maintenance.maintainChat('none')).status,'legacy-format') // queued behind the catch-up pass
 assert.equal(files.get('save-maintenance.json').compacted.old,9)
 assert.equal(files.get('save-maintenance.json').compacted.small,undefined,'积压不到阈值的不动')
})

test('整理不在写锁里扫描：整理进行中的写入不必等到整理结束', {timeout:60000}, async t => {
 const {persistence,chats,reopen}=await fixture(t)
 await persistence.write({id:'g',mode:'story',messages:[{role:'assistant',text:big(0)}]})
 for(let i=1;i<=60;i++)await persistence.patch('g',i,[{op:'set',path:['messages',0,'text'],value:big(i)}])
 let compacted=false
 const pass=chats.compact('g',{keepRecent:2,graceMs:0}).then(result=>{compacted=true;return result})
 await persistence.patch('g',61,[{op:'set',path:['messages',0,'text'],value:'中途写入'}])
 assert.equal(compacted,false,'写入没有排在整趟整理之后')
 const result=await pass
 assert.ok(result.removed>0)
 assert.ok(result.lockHolds>=1)
 assert.equal((await reopen().read('g')).messages[0].text,'中途写入')
})
