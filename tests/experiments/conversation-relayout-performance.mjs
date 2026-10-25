// Storage benchmark only (no browser, model or MVU): a synthetic long chat whose
// floors share most of their tree with earlier floors and are edited by several
// commits each, as settlements do. Measures cold full and window reads before and
// after the maintenance relayout. Usage: node tests/experiments/conversation-relayout-performance.mjs [ROUNDS] [OUT.json]
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {performance} from 'node:perf_hooks'
import assert from 'node:assert/strict'
import {createChatJournalStore} from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../../tavern-plugin/lib/domain/chat-persistence.js'

const rounds=Number(process.argv[2])||120,out=process.argv[3]
const root=await mkdtemp(join(tmpdir(),'conversation-relayout-perf-'))
const text=(label,n)=>`${label} ${n} `+'合成剧情段落，用来占位。'.repeat(20)
// Forty scene entries; each round edits three of them, so a floor reuses most
// subtrees first written by older commits.
const scene=Array.from({length:40},(_,i)=>({id:'entry-'+i,title:text('title',i).slice(0,40),notes:[text('note a',i),text('note b',i)],weights:{a:i,b:i*2}}))
function assistant(round){
 for(let k=0;k<3;k++){const i=(round*3+k)%scene.length;scene[i]={...scene[i],notes:[text('note a',i),text('round '+round,i)],weights:{a:round,b:i}}}
 return {role:'assistant',text:text('reply',round),stage:{scene:structuredClone(scene),cast:[{name:'甲',mood:'calm'},{name:'乙',mood:'warm'}]},status:{round,flags:[]}}
}
async function cold(id,label){
 const io=[],chats=createChatJournalStore({dataRoot:root,onNativeIO:event=>io.push(event)})
 let started=performance.now()
 const full=await chats.read(id)
 const fullMs=performance.now()-started,fullIO=io.splice(0)
 const fresh=createChatJournalStore({dataRoot:root,onNativeIO:event=>io.push(event)})
 started=performance.now()
 const window=await fresh.readWindow(id,{limit:48})
 const windowMs=performance.now()-started,windowIO=io.splice(0)
 const sum=events=>({fileReads:events.filter(e=>e.kind==='read').length,readBytes:events.filter(e=>e.kind==='read').reduce((n,e)=>n+e.bytes,0)})
 return {label,full:{ms:Math.round(fullMs),...sum(fullIO)},window48:{ms:Math.round(windowMs),...sum(windowIO)},digest:JSON.stringify([full,window.chat.messages])}
}
try{
 const chats=createChatJournalStore({dataRoot:root,newConversations:true}),persistence=createChatPersistence({store:chats})
 const chat={id:'chat-relayout-bench',mode:'story',messages:[{role:'assistant',greeting:true,text:text('greeting',0)}]}
 let commits=0
 const seedStarted=performance.now()
 await persistence.write(chat);commits++
 for(let round=1;round<=rounds;round++){
  chat.messages.push({role:'user',text:text('input',round)},assistant(round))
  await persistence.write(chat);commits++
  // Later edits of the same floor: separate commits, separate packs.
  for(const step of ['director','voice','settlement']){
   const floor=chat.messages.at(-1)
   floor.status={...floor.status,[step]:text(step,round)}
   floor.stage.cast=floor.stage.cast.map(row=>({...row,mood:step}))
   await persistence.write(chat);commits++
  }
 }
 const seedMs=Math.round(performance.now()-seedStarted)
 const before=await cold(chat.id,'before')
 const sweepStarted=performance.now(),dryRunSweep=await createChatJournalStore({dataRoot:root}).compact(chat.id,{dryRun:true,graceMs:0})
 const sweepMs=Math.round(performance.now()-sweepStarted)
 const measured=await chats.relayout(chat.id,{dryRun:true})
 const started=performance.now(),applied=await chats.relayout(chat.id),relayoutMs=Math.round(performance.now()-started)
 const swept=await chats.compact(chat.id,{retain:()=>false,keepRecent:2,graceMs:0})
 const after=await cold(chat.id,'after')
 assert.equal(after.digest,before.digest,'identical Chat before and after')
 const remeasured=await chats.relayout(chat.id,{dryRun:true})
 const report={scope:'synthetic native chat; fresh store per sample; OS file cache warm',rounds,floors:chat.messages.length,commits,seedMs,
  before:{full:before.full,window48:before.window48,dryRunSweep:{ms:sweepMs,reachable:dryRunSweep.reachable}},measured,applied:{...applied,ms:relayoutMs},
  sweep:{removed:swept.removed,bytes:swept.bytes},after:{full:after.full,window48:after.window48},remeasured,identical:true}
 if(out)await writeFile(out,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify({rounds,commits,before:report.before,after:report.after,
  layout:{visits:measured.visits,ideal:measured.ideal,fragmented:measured.fragmented,relinked:applied.relinked,ms:relayoutMs,maxLockMs:applied.maxLockMs},
  afterLayout:{visits:remeasured.visits,ideal:remeasured.ideal,fragmented:remeasured.fragmented},sweptBytes:swept.bytes}))
}finally{await rm(root,{recursive:true,force:true})}
