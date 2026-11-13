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

for (const textOnly of [false,true]) test(`历史导入与旧预筛调用均不启动 Agent（textOnly=${textOnly}）`, async()=>{
 const h=fixture(), runtime=await UpstreamTemplateRuntime.create()
 let calls=0
 const worldBook={view:{entries:[{comment:'[initvar]',content:'hp: 10',enabled:false},
  ...['walk','rest'].flatMap(word=>Array.from({length:6},(_,i)=>({ref:word+i,enabled:true,primaryKeys:[word],content:`${word} rule ${i} `+'x'.repeat(4400)})))]}}
 const project=createForegroundWorldbook({bound:async()=>worldBook,runtime:async()=>runtime,globalVariables:async()=>({}),
  filterCandidates:async()=>{calls++;throw Error('model transport reached')}})
 h.options.worldBooks.bound=async()=>worldBook;h.options.projectForegroundWorldbook=args=>project({...args,chat:{...args.chat,backgroundTasks:{worldbookScreening:true}}})
 await createChatHistoryImportService(h.options).import({...input,textOnly})
 assert.equal(calls,0)
 const frames=foregroundContexts(h.session)
 assert.doesNotMatch(frames[0],/walk rule/);assert.doesNotMatch(frames[1],/rest rule/)
 assert.match(frames[0],/<lorebook_title_hints>/);assert.match(frames[1],/<lorebook_title_hints>/)
 await project({chat:{id:'live',sessionId:'session',messages:[]},card:{},userText:'walk',worldBook})
 assert.equal(calls,0,'发送正文不等待模型筛选')
 await project({chat:{id:'live',sessionId:'session',backgroundTasks:{worldbookScreening:true},messages:[{role:'assistant',turn:1,text:'walk'}]},card:{},userText:'',worldBook,purpose:'prefilter'})
 assert.equal(calls,0,'旧预筛调用不再启动模型')
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

test('导入草稿在构帧期间能被模板会话解析，写入任何记录前撤销',async()=>{
 const h=fixture(), drafts=new Map(), resolved=[], heldAtWrite=[]
 h.options.drafts={hold:(id,chat)=>drafts.set(id,chat),clear:id=>drafts.delete(id)}
 const write=h.chats.write;h.chats.write=async chat=>{heldAtWrite.push(drafts.size);return write(chat)}
 // The world book projection resolves its Session the same way the template runtime does.
 h.options.projectForegroundWorldbook=async({chat})=>{resolved.push(drafts.get(chat.sessionId)?.id);return {context:''}}
 await createChatHistoryImportService(h.options).import(input)
 assert.deepEqual(resolved,['chat','chat'],'每一轮构帧时草稿都可解析')
 assert.equal(drafts.size,0,'导入完成后不再持有草稿')
 assert.ok(heldAtWrite.length&&heldAtWrite.every(size=>size===0),'checkpoint 与发布写入时草稿已撤销')
})

test('导入失败时同样撤销草稿引用，不泄漏到后续请求',async()=>{
 const h=fixture(), drafts=new Map()
 h.options.drafts={hold:(id,chat)=>drafts.set(id,chat),clear:id=>drafts.delete(id)}
 h.options.projectForegroundWorldbook=async()=>({context:'',error:'worldbook unavailable'})
 await assert.rejects(createChatHistoryImportService(h.options).import(input),/worldbook unavailable/)
 assert.equal(drafts.size,0)
})

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
