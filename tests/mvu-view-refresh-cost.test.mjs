import test from 'node:test'
import assert from 'node:assert/strict'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
for(const count of [20,400,10000]) test(`view transport visits only changed helper floor at ${count}`,()=>{
 let reads=0
 const rows=Array.from({length:count},(_,i)=>({message_id:i,message:'old'}))
 const messages=new Proxy(rows,{get(t,k,r){if(/^\d+$/.test(String(k)))reads++;return Reflect.get(t,k,r)}})
 const view={tavernHelper:{messages,stateRevision:1}}
 const sync=createSessionViewSync(),first=sync('s',view,undefined,{revision:1})
 rows[count-1]={message_id:count-1,message:'new'};view.tavernHelper.stateRevision=2;reads=0
 const next=sync('s',view,first.viewCursor,{revision:2,dirtyMessageIndices:new Set([count-1])})
 assert.equal(next.viewDelta.set.find(([path])=>path[2]===count-1)[1].message,'new')
 assert.ok(reads<=2,`read ${reads} historical floors`)
})

import {helperClient,helperHostHarness} from './fixtures/helper-host-harness.mjs'
for(const count of [20,400,10000]) test(`wire merge and parent refresh avoid unchanged history at ${count}`,async t=>{
 let reads=0,frame
 const sent=[],listeners={}
 const hostWindow={crypto:{randomUUID:()=> 'view-test'},setTimeout,clearTimeout,addEventListener(n,fn){listeners[n]=fn},removeEventListener(){}}
 const document={body:{appendChild(){}},createElement(tag){if(tag==='div')return {isConnected:true,appendChild(){},remove(){}};return frame={contentWindow:{postMessage(m){sent.push(m)}},listeners:{},addEventListener(n,fn){this.listeners[n]=fn},remove(){}}}}
 const runtime=helperClient.createTavernHelperScriptRuntime({window:hostWindow,document,reportError(){},resolveError(){}})
 t.after(()=>runtime.dispose())
 const messages=Array.from({length:count},(_,i)=>({message_id:i,role:'assistant',message:'body',variables:{hp:10}}))
 Object.defineProperty(messages[0],'pluginData',{enumerable:true,get(){reads++;return {custom:'untouched'}}})
 const view={chatId:'c',tavernHelper:{chatId:'c',stateRevision:1,lifecycleRevision:0,messages},tavernHelperScripts:[{id:'a',content:'void 0'}]}
 const sync=createSessionViewSync(),begin=helperClient.createSessionViewReader()
 let request=begin('s'),first=request.accept(sync('s',view,request.cursor,{revision:1})).view
 runtime.sync('s',first);frame.listeners.load()
 listeners.message({source:frame.contentWindow,data:{token:'view-test',type:'dsh-tavern-helper-subscriptions',ready:true,names:['MESSAGE_RECEIVED']}})
 // A transaction draft changes another floor. Committed refresh must restore it too.
 const pending=runtime.emit('MESSAGE_RECEIVED',[count-1],{contextDelta:{version:2,kind:'dispatch',chatId:'c',lifecycleRevision:0,baseRevision:1,stateRevision:1,eventId:'e',messageCount:count,header:{},messages:[{...messages[1],variables:{hp:123}}]}},[],'e')
 const next={...view,tavernHelper:{...view.tavernHelper,stateRevision:2,messages:messages.slice()}}
 next.tavernHelper.messages[count-1]={...messages[count-1],variables:{hp:9}}
 request=begin('s');reads=0;sent.length=0
 const updated=request.accept(sync('s',next,request.cursor,{revision:2,dirtyMessageIndices:new Set([count-1])})).view
 runtime.sync('s',updated)
 assert.equal(reads,0,'wire merge and context projection must not read historical payloads')
 assert.equal(sent.filter(m=>m.type==='dsh-tavern-helper-context').length,0,'committed refresh waits for transaction')
 const third={...next,tavernHelper:{...next.tavernHelper,stateRevision:3,messages:next.tavernHelper.messages.slice()}}
 third.tavernHelper.messages[2]={...messages[2],variables:{hp:8}}
 request=begin('s');reads=0
 runtime.sync('s',request.accept(sync('s',third,request.cursor,{revision:3,dirtyMessageIndices:new Set([2])})).view)
 assert.equal(reads,0,'successive deferred refreshes stay incremental')
 listeners.message({source:frame.contentWindow,data:{token:'view-test',type:'dsh-tavern-helper-event-complete',eventId:'e',args:[]}})
 await pending
 const delivered=sent.find(m=>m.contextDelta?.kind==='committed')
 assert.ok(delivered,'must deliver a committed delta')
 assert.equal(delivered.context,undefined)
 assert.deepEqual(Array.from(delivered.contextDelta.messages,m=>m.message_id),[1,2,count-1])
 assert.equal(delivered.contextDelta.messages[0].variables.hp,10,'restore uncommitted draft row')
 assert.equal(delivered.contextDelta.messages[2].variables.hp,9)
 assert.equal(reads,0)
 assert.equal(first.tavernHelper.messages[count-1].variables.hp,10,'previous view remains isolated')
 const iframe=helperHostHarness({...view.tavernHelper,transaction:{eventId:'e',sequence:0}})
 iframe.receive({...delivered,token:"host-test"})
 await new Promise(r=>setImmediate(r))
 assert.equal(iframe.window.getVariables({type:'message',message_id:count-1}).hp,9)
 assert.equal(iframe.window.getVariables({type:'message',message_id:2}).hp,8)
 const fourth={...third,tavernHelper:{...third.tavernHelper,stateRevision:4,messages:third.tavernHelper.messages.slice()}}
 fourth.tavernHelper.messages[count-1]={...messages[count-1],variables:{hp:7}}
 request=begin('s');reads=0;sent.length=0
 runtime.sync('s',request.accept(sync('s',fourth,request.cursor,{revision:4,dirtyMessageIndices:new Set([count-1])})).view)
 assert.equal(reads,0)
 assert.equal(sent.find(m=>m.contextDelta)?.contextDelta.messages.length,1,'ordinary refresh is incremental too')
 const switched={...fourth,tavernHelper:{...fourth.tavernHelper,stateRevision:5,lifecycleRevision:1}}
 request=begin('s');sent.length=0
 runtime.sync('s',request.accept(sync('s',switched,request.cursor,{revision:5,dirtyMessageIndices:new Set()})).view)
 assert.equal(sent.find(m=>m.context)?.context.lifecycleRevision,1,'lifecycle discontinuity sends a complete baseline')


})
