import { createForegroundWorldbook } from '../tavern-plugin/lib/domain/foreground-worldbook.js'

import { UpstreamTemplateRuntime } from './fixtures/upstream-template-runtime.mjs'
import test from 'node:test'
import { createContextPlanner } from '../tavern-plugin/lib/domain/context-planner.js'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { createChatHistoryImportService } from '../tavern-plugin/lib/domain/chat-history-import-service.js'
import { createStoryTimeline } from '../tavern-plugin/lib/domain/story-timeline.js'

const timeline = createStoryTimeline()
const text = [ {chat_metadata:{}}, {is_user:false,mes:'opening',variables:[{stat_data:{hp:10},schema:{}}]},
 {is_user:true,mes:'walk'}, {is_user:false,mes:'walked',variables:[{stat_data:{hp:8},schema:{}}]},
 {is_user:true,mes:'rest'}, {is_user:false,mes:'rested',variables:[{stat_data:{hp:9},schema:{}}]} ].map(JSON.stringify).join('\n')
function fixture() {
 const journals=new Map(), records=new Map(), history=new Map(), links=new Map()
 const session=Session.create('session'), phase={kind:'idle',lastTurn:0}
 let publishes=0, failFlush=false
 const clone=x=>x===undefined?undefined:structuredClone(x)
 const chats={resolve:async id=>clone(links.get(id)),read:async id=>clone(records.get(id)),readRevision:async(id,revision)=>clone(history.get(revision)),
  write:async chat=>{ const saved={...clone(chat),_storageRevision:(records.get(chat.id)?._storageRevision||0)+1};records.set(chat.id,saved);history.set(saved._storageRevision,clone(saved));return clone(saved)},
  publish:async chat=>{publishes++;await chats.write(chat);links.set(chat.sessionId,clone(chat))}}
 const options={planner:createContextPlanner({prompt:()=> 'Fixture writing rules'}),cards:{read:async()=>({name:'card'})},worldBooks:{bound:async()=>({view:{entries:[{comment:'[initvar]',content:'hp: 10'}]}})},
 store:{readJson:async p=>clone(journals.get(p)),writeJson:async(p,v)=>journals.set(p,clone(v))},chats,
 initialization:{prepareImport:async()=>timeline.apply({chat:{id:'chat',sessionId:'session',messages:[],mvu:{enabled:true},scriptState:null,cardContextSnapshot:'rules'},intent:{kind:'ensure'}}).chat},
 native:{wait:async()=>({session,agent:{phase}}),ensurePrefix:async()=>{},flush:async()=>{if(failFlush){failFlush=false;throw Error('offline')}}}}
 return {options,session,phase,history,chats,records,get publishes(){return publishes},fail:()=>{failFlush=true}}
}
const input={cardPath:'card.json',text,operationId:'operation-123',sessionId:'session'}
test('import uses normal storage revision checkpoints, keeps no pending settlement, retries idempotently',async()=>{
 const h=fixture(), service=createChatHistoryImportService(h.options)
 await service.import(input)
 let chat=await h.chats.resolve('session')
 assert.equal(chat.timeline.checkpoints.length,2)
 assert.equal(chat.settleStatus,'done');assert.equal(h.phase.lastTurn,3)
 assert.ok(chat.timeline.checkpoints.every(c=>c.beforeRevision>0 && !c.importBefore))
 const checkpoint=chat.timeline.checkpoints.at(-1)
 chat=timeline.apply({chat,intent:{kind:'turn.rollback',turn:3,beforeChat:h.history.get(checkpoint.beforeRevision)}}).chat
 assert.equal(chat.messages.at(-1).variables[0].stat_data.hp,8)
 await service.import(input)
 assert.equal(h.publishes,1)
 assert.equal(h.session.deriveMessages().filter(m=>m.source?.form!=='foreground-frame').length,5)
})

test('concurrent requests cannot reuse an operation for different content',async()=>{
 const h=fixture(),service=createChatHistoryImportService(h.options)
 const first=service.import(input)
 await assert.rejects(service.import({...input,textOnly:true}),/其他内容/)
 await first
})

test('历史导入复用正式世界书投影，当前输入不重复占用扫描窗口，蓝绿灯一起编排', async () => {
 const h=fixture(), runtime=await UpstreamTemplateRuntime.create()
 const worldBook={view:{entries:[{comment:'[initvar]',content:'hp: 10',enabled:false},
  {ref:'open',constant:true,content:'<角色库>',order:10},
  {ref:'role',primaryKeys:['/\\bwalk\\b/'],content:'开场角色',order:20},
  {ref:'close',constant:true,content:'</角色库>',order:30}]}}
 h.options.worldBooks.bound=async()=>worldBook
 h.options.projectForegroundWorldbook=createForegroundWorldbook({bound:async()=>worldBook,runtime:async()=>runtime,globalVariables:async()=>({})})
 await createChatHistoryImportService(h.options).import(input)
 const frames=foregroundContexts(h.session)
 assert.match(frames[0],/<角色库>\n\n开场角色\n\n<\/角色库>/)
 assert.doesNotMatch(frames[1],/开场角色/)
 assert.match(frames[1],/<角色库>\n\n<\/角色库>/)
})

for (const textOnly of [false,true]) test(`历史导入装配真实筛选器仍不调用 Agent（textOnly=${textOnly}）`, async()=>{
 const h=fixture(), runtime=await UpstreamTemplateRuntime.create()
 const {createWorldbookFilter}=await import('../tavern-plugin/lib/domain/worldbook-filter.js')
 let calls=0
 const worldBook={view:{entries:[{comment:'[initvar]',content:'hp: 10',enabled:false},
  ...['walk','rest'].flatMap(word=>Array.from({length:6},(_,i)=>({ref:word+i,enabled:true,primaryKeys:[word],content:`${word} rule ${i} `+'x'.repeat(4400)})))]}}
 const project=createForegroundWorldbook({bound:async()=>worldBook,runtime:async()=>runtime,globalVariables:async()=>({}),
  filterCandidates:createWorldbookFilter({selection:()=>({}),beginTask:async()=>({participantRequest:{},fail:async()=>{}}),runAgent:async()=>{calls++;throw Error('model transport reached')}})})
 h.options.worldBooks.bound=async()=>worldBook;h.options.projectForegroundWorldbook=project
 await createChatHistoryImportService(h.options).import({...input,textOnly})
 assert.equal(calls,0)
 const frames=foregroundContexts(h.session)
 assert.match(frames[0],/walk rule/);assert.match(frames[1],/rest rule/)
 await project({chat:{id:'live',sessionId:'session',messages:[]},card:{},userText:'walk',worldBook})
 assert.equal(calls,0,'发送正文不等待模型筛选')
 await project({chat:{id:'live',sessionId:'session',messages:[{role:'assistant',turn:1,text:'walk'}]},card:{},userText:'',worldBook,purpose:'prefilter'})
 assert.equal(calls,1,'回复结束后的预筛仍走真实模型筛选器')
})

test('世界书投影失败时明确指出历史轮次，不发布残缺导入，修复后可重试',async()=>{
 const h=fixture()
 h.options.projectForegroundWorldbook=async()=>({context:'',error:'worldbook unavailable'})
 await assert.rejects(createChatHistoryImportService(h.options).import(input),/第 2 轮.*worldbook unavailable/)
 assert.equal(h.publishes,0)
 assert.equal(h.session.deriveMessages().length,0)
 h.options.projectForegroundWorldbook=async()=>({context:'restored'})
 await createChatHistoryImportService(h.options).import(input)
 assert.equal(h.publishes,1)
})

function foregroundContexts(session) {
 const rounds = new Map()
 for (const message of session.deriveMessages()) {
  if (!['foreground-frame', 'worldbook-snapshot'].includes(message.source?.form)) continue
  const turn = message.source.trace.turn
  rounds.set(turn, [rounds.get(turn), ...message.content.map(block => block.text)].filter(Boolean).join('\n\n'))
 }
 return [...rounds.values()]
}

test('rescue carries the selected last valid MVU snapshot, reenables settlement and labels stale state',async()=>{
 const h=fixture()
 const snapshot={stat_data:{hp:7,inventory:['key']},schema:{type:'object'},initialized_lorebooks:{book:true}}
 const source={id:'broken-mvu',sessionId:'missing',cardPath:'card.json',mode:'story',mvu:{enabled:true},messages:[
  {role:'assistant',turn:1,text:'Opening'},
  {role:'assistant',turn:2,text:'State saved',swipeId:1,variables:[{stat_data:{hp:999},schema:{}},snapshot]},
  {role:'user',text:'Continue'}, {role:'assistant',turn:3,text:'Later text without state'}, {role:'user',text:'Pending'}]}
 h.records.set(source.id,structuredClone(source))
 const service=createChatHistoryImportService(h.options)
 await service.rescue({sourceChatId:source.id,operationId:'mvu-rescue-123',sessionId:'session'})
 const chat=await h.chats.resolve('session')
 assert.equal(chat.mvu.enabled,true);assert.equal(chat.mvu.owner,'official')
 assert.equal(chat.mvu.openingInitialization.status,'complete')
 assert.equal(chat.backgroundTasks.variables,true)
 assert.deepEqual(chat.messages.findLast(m=>m.role==='assistant').variables[0],snapshot)
 assert.equal(chat.importHistory.rescue.mvuSnapshot.sourceTurn,2)
 assert.equal(chat.importHistory.rescue.mvuSnapshot.laterAssistantMessages,1)
 assert.match(chat.importHistory.warnings.join(''),/数值可能滞后/)
 assert.equal(chat.timeline.checkpoints.length,0)
 assert.deepEqual(h.records.get(source.id),source)
})
