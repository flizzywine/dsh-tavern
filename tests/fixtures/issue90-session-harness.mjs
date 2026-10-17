// Real production read/state modules and storage. Rendering and transport are adapters.
import { createTavernConversationRegistry } from '../../tavern-plugin/lib/domain/tavern-conversation-registry.js'
import { createBackgroundTaskCoordinator } from '../../tavern-plugin/lib/domain/background-task-coordinator.js'
import { createStoryTimeline } from '../../tavern-plugin/lib/domain/story-timeline.js'
import { createSessionViewReader, createSessionChatReader } from '../../tavern-plugin/lib/domain/session-view-reader.js'
import { createSessionStateView } from '../../tavern-plugin/lib/domain/chat-session-state.js'

export async function sessionHarness(persistence, initial, overrides = {}) {
  let fullReads = 0, links = { s: initial.id }
  const readChat = async id => { fullReads++; return persistence.read(id) }
  const registry = createTavernConversationRegistry({store:{
    readLinks:async()=>links, updateLinks:async fn=>{links=await fn(links)||links},
    readIndex:async()=>({chats:[{id:initial.id}]}),async updateIndex(updater) { const next = await updater(await this.readIndex()); if (next !== undefined) await this.writeIndex(next); return next },writeIndex:async()=>{},
    readChat,readChatState:id=>persistence.readSessionState(id),writeChat:async()=>{},removeChat:async()=>{}
  }})
  const sync = (_id,view,_cursor,options)=>({view,revision:options.revision})
  sync.peek=()=>({sessionId:'s',revision:initial._storageRevision})
  const {activity}=createBackgroundTaskCoordinator({timeline:createStoryTimeline(),store:{readChat,writeChat:persistence.write,updateChat:persistence.update}})
  const context={args:{sessionId:'s',viewSync:1,viewCursor:'cursor'},chatPersistence:persistence,
    sessionDebugEvidence:()=>({events:[],session:{surface:{nodes:[]}}}),
    requestPerformance:{stage:(_name,fn)=>fn(),state(){}},
    view:async chat=>({chatId:chat.id,tavernHelper:{messages:chat.messages.map(m=>({role:m.role,text:m.text}))}}),
    synchronizeSessionView:sync,...overrides}
  const chats=createSessionChatReader({registry,
    needsAdoption:chat=>['story','script'].includes(chat.mode||'story') && (chat.backgroundConfigVersion!==1||chat.conversationFeaturesVersion!==1),
    adopt:chat=>context.updateChat(chat.id,current=>context.adoptConversationFeatures(context.adoptConversationBackground(current)))})
  const fields=createSessionStateView({activity,evidence:id=>context.sessionDebugEvidence(id)})
  const reader=createSessionViewReader({readState:chats.readState,readChat:chats.read,
    readChanges:(...args)=>context.chatPersistence.readChangedIndices(...args),
    project:{cached:(chat,previous,state)=>({...previous,...fields.volatile(chat,state)}),
      dirty:(chat)=>context.requestPerformance.stage('projectView',()=>context.view(chat)),
      full:(chat)=>context.requestPerformance.stage('projectView',()=>context.view(chat))},
    activity,trace:context.requestPerformance,foregroundRunning:()=>false,synchronize:sync})
  // Warm through the public interface; no access to the reader's private cache.
  await reader.read('s')
  fullReads=0
  return {context,get:()=>reader.response(context.args),read:()=>reader.read('s'),
    activity:async()=>fields.status(await chats.readState('s')),
    volatile:chat=>fields.volatile(chat,activity(chat)),fullReads:()=>fullReads}
}
