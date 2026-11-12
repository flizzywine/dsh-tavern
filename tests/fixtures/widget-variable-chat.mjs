import { mkdtemp } from '../helpers/temp-directory.mjs'
import { createTurnOrchestrator } from '../../tavern-plugin/lib/domain/turn-orchestration.js'
import { createForegroundFrameBuilder } from '../../tavern-plugin/lib/domain/agent-input-frame.js'
import { createScriptContinuity } from '../../tavern-plugin/lib/domain/script-continuity.js'
import { projectReplyLayers } from '../../tavern-plugin/lib/domain/reply-presentation.js'
// synthetic native Chat seam; no live paths, cards or model calls.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createChatJournalStore } from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../../tavern-plugin/lib/domain/chat-persistence.js'
import { createStoryTimeline } from '../../tavern-plugin/lib/domain/story-timeline.js'
import { createWidgetVariableService } from '../../tavern-plugin/packages/dsh-tavern-stage/lib/domain/widget-variable-service.js'
import { createTavernScriptHostAdapter } from '../../tavern-plugin/lib/domain/tavern-script-host-adapter.js'
export const declarations={reads:{balance:{source:'mvu',path:'/balance'},bag:{source:'mvu',path:'/bag'}},writes:{balance:{source:'mvu',path:'/balance',scope:'exact',ops:['delta','replace']},bag:{source:'mvu',path:'/bag',scope:'subtree',ops:['insert','remove']}}}
export const purchase=[{writeId:'balance',op:'delta',value:-5},{writeId:'bag',suffix:'/seed',op:'insert',value:1}]
export async function widgetChatFixture(t,options={}) {
  const directory=fileURLToPath(new URL('../../.tmp/',import.meta.url));await mkdir(directory,{recursive:true})
  const root=await mkdtemp(directory+'widget-chat-'), store=createChatJournalStore({dataRoot:root,newConversations:true}),db=createChatPersistence({store})
  const timeline=createStoryTimeline(), ref={packId:'test-pack',kind:'widgets',assetId:'shop'}
  const variables={stat_data:{balance:20,bag:{}},schema:{type:'object',properties:{balance:{type:'number'},bag:{type:'object',extensible:true,properties:{}}}},display_data:{},delta_data:{}}
  await db.write(timeline.apply({chat:{id:'fixture',sessionId:'fixture',mode:'story',cardPath:'synthetic.json',cardName:'Synthetic shop card',backgroundConfigVersion:1,conversationFeaturesVersion:1,
    mvu:{enabled:true,owner:'official',openingInitialization:{version:2,status:'complete'}},posture:'unchanged',messages:[{role:'assistant',greeting:true,turn:1,swipeId:0,text:'Synthetic opening',swipes:['Synthetic opening'],variables:[variables]}]},intent:{kind:'ensure'}}).chat)
  let adapter,service,enabled=true,dispatches=0
  const diagnostics=[]
  adapter=createTavernScriptHostAdapter({diagnostics:{record:async(_session,event)=>diagnostics.push(event)},resolveChat:()=>db.read('fixture'),resolveSettlementBase:()=>db.readSettlementBase('fixture'),resolveChatSlice:(_s,ids,fields)=>db.readSlice('fixture',ids,fields),writeChat:async(...args)=>{const saved=await db.write(...args);await options.committed?.();return saved},
    readCard:async()=>({name:'Synthetic shop card'}),worldBooks:{bound:async()=>null},scriptDispatch:{status:()=>({ready:true}),async dispatch(session,name,args,context,work){
      dispatches++
      if(options.dispatch)return options.dispatch({session,name,args,context,work,adapter})
      await options.beforeExecute?.()
      const row=context.messages.find(row=>row.message_id===args[0]),baseline=row.variables
      const operations=JSON.parse(args[1].split('<JSONPatch>')[1].split('</JSONPatch>')[0])
      // A deterministic test executor; the offline browser test uses official MVU instead.
      const next=structuredClone(baseline)
      for(const op of operations){const key=op.path.slice(1);if(key==='balance')next.stat_data.balance=op.op==='delta'?next.stat_data.balance+op.value:op.value;else if(op.op==='remove')delete next.stat_data.bag[key.slice(4)];else next.stat_data.bag[key.slice(4)]=op.value}
      await adapter.updateVariables(session,{type:'message',message_id:args[0]},next,0,work.eventId)
      return {handled:true}
    }}})
  const config={index:()=>db.readSessionState('fixture'),readWindow:db.readWindow,availability:()=>({ready:true}),timeline,patch:async(...args)=>{const saved=await db.patch(...args);if(saved)await options.committed?.();return saved},execute:async input=>{const result=await adapter.editMvuVariables(input);diagnostics.push({stage:'fixture-result',updated:result.updated,stale:result.stale,unchanged:result.unchanged});return result},
    authorize:async input=>enabled?{chatId:'fixture',declarations,current:()=>enabled,lastPage:input.page.index===1}:null}
  service=createWidgetVariableService(config)
  t.after(async()=>{service.dispose();await store.flushMaintenance()})
  const input={sessionId:'fixture',viewId:'stage',viewEpoch:1,turn:1,page:{index:1},ref,identity:'shop-v1',live:true,revealed:true}
  return {db,root,timeline,adapter,service,config,input,variables,diagnostics,dispatches:()=>dispatches,revoke:()=>{enabled=false},
    async propose(operations=purchase,operationId='purchase',projection){const read=projection || await service.read(input);return service.propose({sessionId:'fixture',operationId,contextKey:read.contextKey,revision:read.revision,operations})},
    async mutate(fn){return db.update('fixture',chat=>{fn(chat);return chat})}}
}

export async function nextWidgetTurn(h) {
  let writer
  const orchestrator=createTurnOrchestrator({store:{chatForSession:()=>h.db.read('fixture'),readCard:async()=>({name:'Synthetic shop card'}),readCardExtensions:async()=>({regexScripts:[]}),
    readBoundWorldBook:async()=>null,writeChat:h.db.write,updateChat:h.db.update},timeline:h.timeline,scripts:createScriptContinuity(),frameBuilder:createForegroundFrameBuilder(),
    planner:{async plan(input){writer=structuredClone(input.chat);return {text:JSON.stringify(input.chat.messages.at(-1).variables[0].stat_data)}}},queueSettlement(){},projectReply:projectReplyLayers})
  const input={sessionId:'fixture',turn:2,userText:'Continue after the purchase'}
  const prepared=await orchestrator.prepare(input)
  await orchestrator.finalize({...input,assistantText:'The shopkeeper hands over the seed.'})
  return {prepared,writer,chat:await h.db.read('fixture')}
}
