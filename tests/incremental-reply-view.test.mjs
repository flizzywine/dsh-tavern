import test from 'node:test'
import assert from 'node:assert/strict'
import {createIncrementalReplyView} from '../tavern-plugin/lib/domain/incremental-reply-view.js'
import {projectReplyHistory} from '../tavern-plugin/lib/domain/reply-presentation.js'
import {projectPersistentStatusView} from '../tavern-plugin/lib/domain/persistent-status-view.js'
const options={charName:'角色',macroState:{userName:'玩家'}}
function reference(chat, opts=options) {
 const history=projectReplyHistory(chat.messages,opts)
 return {...projectPersistentStatusView(chat.messages,history.projections,opts),presentation:null,latestSourceBacked:history.latestSourceBacked}
}

test('真实 journal 支持新增/旧正文改写及无消息变化，重启缺少变更证据时回退', async t => {
 const {mkdtemp,rm}=await import('node:fs/promises'), {tmpdir}=await import('node:os'), {join}=await import('node:path')
 const {createChatJournalStore}=await import('../tavern-plugin/lib/domain/chat-journal-store.js')
 const root=await mkdtemp(join(tmpdir(),'incremental-view-'));t.after(()=>rm(root,{recursive:true,force:true}))
 let store=createChatJournalStore({dataRoot:root})
 const cache=createIncrementalReplyView({readChanges:(id,revision)=>store.readChangedSlice(id,revision)})
 let chat=await store.update('chat',()=>({id:'chat',_storageRevision:1,messages:Array.from({length:700},(_,i)=>({role:'assistant',turn:i+1,text:'正文'+i,bodyEdit:true}))}))
 const check=async()=>assert.deepEqual(await cache.project(chat,options,options),reference(chat))
 await check();assert.equal(cache.stats().projectedMessages,700)
 chat=await store.update('chat',current=>({...current,_storageRevision:2,messages:[...current.messages,{role:'assistant',turn:701,text:'新正文',bodyEdit:true}]}))
 await check();assert.equal(cache.stats().projectedMessages,701)
 chat=await store.update('chat',current=>{current._storageRevision++;current.messages[100].text='编辑旧正文';return current})
 await check();assert.equal(cache.stats().projectedMessages,702)
 chat=await store.update('chat',current=>({...current,_storageRevision:4,posture:'更新状态'}))
 await check();assert.equal(cache.stats().projectedMessages,702)
 store=createChatJournalStore({dataRoot:root})
 chat=await store.update('chat',current=>({...current,_storageRevision:5,posture:'重启后'}))
 store=createChatJournalStore({dataRoot:root})
 await check();assert.equal(cache.stats().rebuilt,2)
})
