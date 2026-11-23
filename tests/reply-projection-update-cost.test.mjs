import test from 'node:test'
import assert from 'node:assert/strict'
import {createIncrementalReplyView} from '../tavern-plugin/lib/domain/incremental-reply-view.js'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
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
