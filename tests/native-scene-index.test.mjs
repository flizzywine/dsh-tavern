import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {createConversationPageStore} from '../tavern-plugin/lib/domain/conversation-page-store.js'
import {sceneTarget} from '../tavern-plugin/lib/domain/scene-illustration.js'
async function fixture(t,count=256){
 const root=await mkdtemp(join(tmpdir(),'scene-index-'));t.after(()=>rm(root,{force:true,recursive:true}))
 const io=[],store=createChatJournalStore({dataRoot:root,newConversations:true,onNativeIO:e=>io.push(e)}),db=createChatPersistence({store})
 const chat=await db.write({id:'场景',sessionId:'s',mode:'story',messages:Array.from({length:count},(_,i)=>({role:'assistant',turn:i+1,text:'正文😀'+i,swipes:['正文😀'+i,'其他'],swipeId:0,variables:[{hp:i}]}))})
 return {root,db,io,chat}
}

test('an index from an older writer revision cannot return stale picture identities',async t=>{
 const {root,db,chat}=await fixture(t,4),pages=createConversationPageStore({root:join(root,'chats')})
 const head=await pages.readHead(chat.id)
 await pages.commit(chat.id,{expectedRevision:head.revision,state:{...head.state,sceneIndexRevision:0}})
 const fallback=await db.readSceneImageState(chat.id,{turns:[4]})
 assert.equal(fallback.sceneTargets,undefined);assert.equal(fallback.messages.length,4)
 await db.patch(chat.id,chat._storageRevision,[{op:'set',path:['messages',3,'variables',0,'hp'],value:43}])
 assert.deepEqual(sceneTarget(await db.readSceneImageState(chat.id,{turns:[4]}),4),sceneTarget(chat,4))
})
