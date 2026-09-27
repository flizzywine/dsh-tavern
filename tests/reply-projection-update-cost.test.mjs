import test from 'node:test'
import assert from 'node:assert/strict'
import {createIncrementalReplyView} from '../tavern-plugin/lib/domain/incremental-reply-view.js'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
import {projectRuntimeReplyHistory} from '../tavern-plugin/lib/domain/runtime-content-projection.js'
import {projectPersistentStatusView} from '../tavern-plugin/lib/domain/persistent-status-view.js'
const options={charName:'角色',macroState:{userName:'玩家'}}
for(const count of [20,400,10000])test(`body point projection and wire delta avoid traversing ${count} historical rows`,async()=>{
 let chat={id:'cost',_storageRevision:1,messages:Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,text:'正文'+i,bodyEdit:true}))}
 let visits=0,reads=0,changes
 const cache=createIncrementalReplyView({maxBytes:128*1024*1024,onIndexVisit:()=>visits++,readChanges:async()=>changes})
 const first=await cache.project(chat,options,options,{shared:true})
 const sync=createSessionViewSync(),base=sync('cost',{replyProjections:first.projections})
 const edited=Math.floor(count/2),nextMessages=chat.messages.slice()
 nextMessages[edited]={...nextMessages[edited],text:'changed'}
 const measured=new Proxy(nextMessages,{get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)}})
 chat={...chat,_storageRevision:2,messages:measured}
 changes={baseRevision:1,chat,messageCount:count,denseMessages:true,indices:[edited]}
 visits=0
 const next=await cache.project(chat,options,options,{shared:true})
 const delta=sync('cost',{replyProjections:next.projections},base.viewCursor)
 assert.ok(reads<10,`message reads: ${reads}`)
 assert.ok(visits<500,`projection index visits: ${visits}`)
 assert.deepEqual(delta.viewDelta.set.map(([path])=>path),[['replyProjections',edited]])
 assert.equal(delta.viewDelta.remove.length,0)
 assert.equal(first.projections[edited].text,'正文'+edited)
 assert.equal(next.projections[edited].text,'changed')
 assert.equal(first.projections[0],next.projections[0])
 const detached=await cache.project(chat,options,options)
 detached.projections[edited].text='mutated'
 assert.equal((await cache.project(chat,options,options,{shared:true})).projections[edited].text,'changed')
})

test('indexed reply cache preserves append, role-change and truncation results',async()=>{
 let chat={id:'edit',_storageRevision:1,messages:[{role:'assistant',text:'<b>opening</b>'},{role:'user',text:'hello'},{role:'assistant',text:'<b>reply</b>',sourceText:'<b>reply</b>'}]},changes
 const cache=createIncrementalReplyView({readChanges:async()=>changes})
 async function check(){
  const actual=await cache.project(chat,options,options)
  const history=projectRuntimeReplyHistory(chat.messages,options)
  assert.deepEqual(actual,{...projectPersistentStatusView(chat.messages,history.projections,options),presentation:null,latestSourceBacked:history.latestSourceBacked})
 }
 await check()
 async function edit(messages,indices){const baseRevision=chat._storageRevision;chat={...chat,_storageRevision:baseRevision+1,messages};changes={baseRevision,chat,messageCount:messages.length,denseMessages:true,indices};await check()}
 await edit([...chat.messages,{role:'assistant',text:'<b>append</b>'}],[3])
 await edit(chat.messages.map((m,i)=>i===1?{role:'assistant',text:'<b>changed role</b>'}:m),[1])
 await edit(chat.messages.slice(0,1),[])
 await edit([],[])
})


test('persistent status declarations still remove captured panels and track the current target',async()=>{
 const opts={...options,regexScripts:[{id:'panel',placement:[2],markdownOnly:true,findRegex:'<StatusPlaceHolderImpl/>',replaceString:'<script>show()</script>'}]}
 let chat={id:'panel',_storageRevision:1,messages:[{role:'assistant',greeting:true,sourceText:'<StatusPlaceHolderImpl/>',text:'<StatusPlaceHolderImpl/>'}]},changes
 const cache=createIncrementalReplyView({readChanges:async()=>changes})
 for(let i=0;i<2;i++){
  const history=projectRuntimeReplyHistory(chat.messages,opts)
  assert.deepEqual(await cache.project(chat,opts,opts),{...projectPersistentStatusView(chat.messages,history.projections,opts),presentation:null,latestSourceBacked:history.latestSourceBacked})
  const baseRevision=chat._storageRevision
  chat={...chat,_storageRevision:2,messages:[...chat.messages,{role:'assistant',turn:2,bodyEdit:true,text:'new'}]}
  changes={baseRevision,chat,messageCount:2,denseMessages:true,indices:[1]}
 }
})
