import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {JSDOM} from 'jsdom'
const require=createRequire(import.meta.url)
const {createStageSourceWidgets}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/source-widgets.cjs')
function fixture({prepare,...options}={}){
 const dom=new JSDOM('<!doctype html><main class="fork-gal-stage"></main>',{url:'https://example.test'}),{window}=dom,document=window.document
 const previous={window:globalThis.window,document:globalThis.document,act:globalThis.IS_REACT_ACT_ENVIRONMENT}
 globalThis.window=window;globalThis.document=document;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const jobs=new Map(),subscriptions=new Set();let serial=0,observers=0,widgetReads=0
 const prefs={get:()=>null,subscribe:fn=>{subscriptions.add(fn);return ()=>subscriptions.delete(fn)}}
 window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
 window.ResizeObserver=class{constructor(){observers++}observe(){}disconnect(){observers--}}
 const foreground={setInterval:fn=>{jobs.set(++serial,fn);return serial},clearInterval:id=>jobs.delete(id)}
 const context={state:null,refs:new Map()}
 prepare?.(window)
 const plugin=createStageSourceWidgets({React,window,document,storage:window.localStorage,foreground,
  views:{sourceDevice:{modId:'dsh.phone',presentation:'getStagePhonePresentation',glyph:'phone',mark:'mark',group:'group',threads:state=>state?.threads,prefs,min:()=>50},admission:{shown:{get:()=>true,settled:()=>Promise.resolve()}},scene:{rects:()=>[]}},
  sessions:()=>({owner:{getWidgetContext(){widgetReads++;return context}}}),sandbox:{theme:()=>null,stopSfx(){},scroll(){}},
  playerErrorText:String,...options})
 const mount=document.querySelector('main'),root=createRoot(mount)
 return {plugin,mount,root,jobs,subscriptions,window,document,get observers(){return observers},get widgetReads(){return widgetReads},
  close(){try{plugin.dispose()}finally{act(()=>root.unmount());dom.window.close();Object.assign(globalThis,{window:previous.window,document:previous.document,IS_REACT_ACT_ENVIRONMENT:previous.act})}}}
}
test('widget controller reads plugin session context and releases geometry and preferences before unmount',()=>{
 const f=fixture();let value
 function View(){value=f.plugin.useStage({sessionId:'s',rootRef:{current:f.mount},config:{characters:[]},widgets:[],pages:[],turn:1,page:0,enabled:true,mode:'live'});return null}
 try {
 act(()=>f.root.render(React.createElement(View)))
 assert.ok(f.widgetReads>0);assert.equal(value.items.length,0);assert.equal(f.observers,1);assert.equal(f.jobs.size,1);assert.ok(f.subscriptions.size>0)
 const late=[...f.jobs.values()][0]
 act(()=>f.plugin.dispose());assert.equal(f.observers,0);assert.equal(f.jobs.size,0);assert.equal(f.subscriptions.size,0)
 act(()=>late());assert.equal(f.jobs.size,0)
 }finally{f.close()}
})
test('stopping phone settings prevents queued writes after an in-flight config read',async()=>{
 let finish;const calls=[]
 const f=fixture({rpc:(method,args)=>{calls.push(method);if(method==='getModConfig')return new Promise(resolve=>finish=resolve);return Promise.resolve({sources:[]})}})
 let settings
 function View(){settings=f.plugin.usePhoneSettings({sessionId:'s'});return null}
 try {
 act(()=>f.root.render(React.createElement(View)))
 let work
 await act(async()=>{work=settings.request({op:'save',key:'sound',layer:'card',value:{fixed:false}});await Promise.resolve()})
 assert.deepEqual(calls,['getModConfig','listModConfigSources'])
 act(()=>f.plugin.dispose())
 await act(async()=>{finish({schema:[],card:{},global:{},resolved:{},revision:1});await work})
 assert.deepEqual(calls,['getModConfig','listModConfigSources'])
 await assert.rejects(settings.request({op:'load'}),{name:'AbortError'})
 }finally{f.close()}
})
test('a phone config response from the prior session cannot replace the new session view',async()=>{
 const pending=new Map()
 const f=fixture({rpc:(method,args,id)=>method==='getModConfig'?new Promise(resolve=>pending.set(id,resolve)):Promise.resolve({sources:[]})})
 let settings
 function View({id}){settings=f.plugin.usePhoneSettings({sessionId:id});return null}
 try {
 act(()=>f.root.render(React.createElement(View,{id:'old'})))
 let old;await act(async()=>{old=settings.request({op:'load'})})
 act(()=>f.root.render(React.createElement(View,{id:'new'})))
 let current;await act(async()=>{current=settings.request({op:'load'})})
 await act(async()=>{pending.get('new')({schema:[],card:{},global:{},resolved:{},revision:2});await current})
 const accepted=settings.view
 await act(async()=>{pending.get('old')({schema:[],card:{},global:{},resolved:{},revision:1});await old})
 assert.equal(settings.view,accepted)
 }finally{f.close()}
})
test('a late widget avatar lease is released without warming the shared cache after stop',async()=>{
 let finish,prepared=0,released=0
 const f=fixture({characters:{face:(config,name,sessionId)=>({identity:'face',revision:1,sessionId})},
  avatarCache:{subscribe:()=>()=>{},get:()=>null,ready:()=>null,prepare:()=>prepared++},
  sessions:()=>({resourceOwner:{acquire:()=>new Promise(resolve=>finish=resolve)}})})
 function View(){f.plugin.useFaces({config:{},sessionId:'s',source:{sessionId:'s',authorityEpoch:1},names:['person'],px:96});return null}
 try {
 act(()=>f.root.render(React.createElement(View)))
 act(()=>f.plugin.dispose())
 await act(async()=>{finish({handle:{url:'blob:face'},release:()=>released++});await Promise.resolve()})
 assert.equal(released,1);assert.equal(prepared,0)
 }finally{f.close()}
})
test('a phone contact keeps one face across rounds, outfit changes and moods',async()=>{
 const phoneProtocol=require('../tavern-plugin/mods/phone/stage-phone.cjs'),drawn=[]
 // The card face is the contact's only face; the stage portrait follows the current outfit and mood.
 const characters=[{alias:'alice',name:'Alice',avatarMedia:{default:{identity:'alice-default-calm',revision:1},moods:{happy:{identity:'alice-happy'},sad:{identity:'alice-sad'}}}}]
 const f=fixture({phoneProtocol,
  characters:{character:(config,name)=>config.characters.find(row=>row.alias===(name?.alias ?? name)),
   face:(config,name,sessionId)=>{const row=config.characters.find(row=>row.alias===name);return row ? {...row.avatarMedia.default,sessionId} : null}},
  figureResolution:{resolveFigureName:(rows,id)=>{const row=rows.find(value=>value.actorKey===id);return row ? {status:'resolved',row,actorKey:id} : {status:'unresolved'}}},
  avatarCache:{subscribe:()=>()=>{},get:face=>'card:'+face.identity,ready:face=>'card:'+face.identity,prepare(){}},
  sessions:()=>({owner:{getWidgetContext:()=>null}}),
  // Thumbnails are drawn from the face's image: a canvas here keeps the url it drew.
  prepare:window=>{
   window.Image=class{set src(value){this.url=value;this.naturalWidth=this.naturalHeight=64;queueMicrotask(()=>this.onload())}get src(){return this.url}}
   window.HTMLCanvasElement.prototype.getContext=function(){return {drawImage:image=>{this.drawn=image.src;drawn.push(image.src)}}}
   window.HTMLCanvasElement.prototype.toDataURL=function(){return 'thumb:'+this.drawn}
  }})
 const phone={ref:{modId:'dsh.phone'},modSource:true,sourceOnly:true,state:{},definition:{contentIdentity:'phone',document:{presentation:{open:{width:280,anchor:'corner-right'}}}}}
 const round=(turn,mood,outfitKey)=>({turn,page:0,pages:[{kind:'line',para:1,alias:'alice',name:'Alice',mood,text:'hi '+turn}],
  actors:{alice:{outfitKey,figure:{packId:'p',figureId:'f'}}},
  record:{phase:'done',through:1,token:{bindingKey:'b',sourceKey:'k'+turn,generation:1},entries:[{at:1,ops:[{op:'mod.command',modId:'dsh.phone',commandId:'mark',params:{contact:'alice',side:'in'}}]}]}})
 let value
 function View(props){value=f.plugin.useStage({sessionId:'s',rootRef:{current:f.mount},config:{characters},widgets:[phone],enabled:true,mode:'live',
  readHistory:()=>Promise.resolve(null),phoneThreadsRpc:()=>Promise.resolve(null),
  avatarOf:()=>({src:'stage:'+props.mood+':'+props.actors.alice.outfitKey}),...props});return null}
 const faces=()=>{const source=value.items.find(item=>item.ref.modId==='dsh.phone').source
  const person=source.threads.flatMap(thread=>thread.participants).find(row=>row.id==='alice')
  return {contact:source.avatars[person.avatar],messages:source.messages.map(row=>row.avatar ?? null)}}
 try {
 const seen=[]
 for (const props of [round(1,'happy','i01'),round(2,'sad','i05'),round(3,'angry','i02')]) {
  await act(async()=>{f.root.render(React.createElement(View,props));await new Promise(resolve=>setTimeout(resolve,0))})
  await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})
  seen.push(faces())
 }
 // The header, every bubble, the banner and the call read the contact face; no message carries a face of its own.
 assert.deepEqual(seen,Array(3).fill({contact:'thumb:card:alice-default-calm',messages:[null]}))
 assert.deepEqual([...new Set(drawn)],['card:alice-default-calm'])
 }finally{f.close()}
})
test('a real phone that covers the stage stops the 100 ms re-measure until it is put away',async()=>{
 const phoneProtocol=require('../tavern-plugin/mods/phone/stage-phone.cjs')
 // A real phone: a narrow viewport with a coarse pointer, so the open phone is the device itself.
 const f=fixture({phoneProtocol,sessions:()=>({owner:{getWidgetContext:()=>null}}),prepare:window=>{
  window.matchMedia=query=>({matches:query.includes('coarse'),addEventListener(){},removeEventListener(){}})
  Object.assign(window,{innerWidth:390,innerHeight:844});Object.defineProperty(window.document,'hidden',{value:false})
  Object.assign(window,{requestAnimationFrame:()=>0,cancelAnimationFrame(){}})
 }})
 f.mount.getBoundingClientRect=()=>({left:0,top:0,width:390,height:844})
 const phone={ref:{modId:'dsh.phone'},modSource:true,sourceOnly:true,state:{},definition:{contentIdentity:'phone',document:{presentation:{open:{width:280,anchor:'corner-right'}}}}}
 let value
 function View(){value=f.plugin.useStage({sessionId:'s',rootRef:{current:f.mount},config:{characters:[]},widgets:[phone],turn:1,page:0,
  pages:[{kind:'line',para:1,name:'Alice',text:'hi'}],enabled:true,mode:'live',readHistory:()=>Promise.resolve(null),phoneThreadsRpc:()=>Promise.resolve(null)});return null}
 const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,0))})
 try {
 act(()=>f.root.render(React.createElement(View)));await settle()
 assert.equal(f.jobs.size,1,'the stage is in view')
 assert.equal(value.covered,false)
 const item=()=>value.items.find(row=>row.ref.modId==='dsh.phone')
 act(()=>value.action(item().key,'open'));act(()=>value.onReady(item().identity,true));await settle()
 assert.equal(item().presentation.device?.kind,'phone')
 assert.equal(f.jobs.size,0,'nothing re-measures under the opaque phone')
 assert.equal(value.covered,true,'the stage reports the cover to other plugins')
 act(()=>value.action(item().key,'collapse'));await settle()
 assert.equal(f.jobs.size,1,'putting it away measures again')
 assert.equal(value.covered,false)
 }finally{f.close()}
})
test('the stage exports its widget placement and the handheld phone decision',()=>{
 const f=fixture({prepare:window=>{window.matchMedia=query=>({matches:query.includes('coarse'),addEventListener(){},removeEventListener(){}})}})
 try {
 assert.equal(f.plugin.phoneHandheld({width:390,height:844}),true,'a narrow touch screen holds the phone as the device')
 assert.equal(f.plugin.phoneHandheld({width:1280,height:800}),false,'a wide screen shows the phone on the stage')
 assert.deepEqual(f.plugin.place({width:800,height:600,size:{width:200,height:100},anchor:'top-center'}),{x:300,y:16,width:200,height:100})
 const clear=f.plugin.place({width:800,height:600,size:{width:200,height:100},blocked:[{x:250,y:0,width:300,height:120}],anchor:'top-center'})
 assert.ok(clear.y>=132 || clear.x+clear.width<=238 || clear.x>=562,'it keeps clear of a blocked control')
 assert.equal(f.plugin.place({width:100,height:100,size:{width:200,height:100}}),null,'no safe space places nothing')
 }finally{f.close()}
})
