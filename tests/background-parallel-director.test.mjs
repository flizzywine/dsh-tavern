import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createChatJournalStore} from '../tavern-plugin/lib/domain/chat-journal-store.js'
import {createChatPersistence} from '../tavern-plugin/lib/domain/chat-persistence.js'
import {createStoryTimeline} from '../tavern-plugin/lib/domain/story-timeline.js'
import {createBackgroundTaskCoordinator} from '../tavern-plugin/lib/domain/background-task-coordinator.js'

// The director runs beside settlement in the same round; neither blocks the other's admission.
test('stage director is a parallel role beside settlement', async t => {
  const root=await mkdtemp(join(tmpdir(),'director-parallel-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const p=createChatPersistence({store:createChatJournalStore({dataRoot:root,newConversations:true})})
  const chat=await p.write({id:'chat-parallel',mode:'story',messages:[{role:'assistant',text:'A quiet room.'}],settleStatus:'idle'})
  const c=createBackgroundTaskCoordinator({timeline:createStoryTimeline(),
    directorActivity:()=>({phase:'running'}),store:{readChat:p.read,writeChat:p.write,updateChat:p.update}})
  const settlement=await c.begin(chat,'settlement')
  await c.begin(await p.read(chat.id),'stage-director')
  const activity=c.activity(await p.read(chat.id))
  assert.equal(activity.role,'settlement')
  assert.equal(activity.busy,true)
  assert.deepEqual(activity.director,{phase:'running'})
  await assert.rejects(c.begin(await p.read(chat.id),'candidate'),error=>error.code==='BACKGROUND_BUSY')
  await settlement.commit({apply:draft=>{draft.messages[0].settled=true}})
  assert.equal((await p.read(chat.id)).messages[0].settled,true)
})
