import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
function harness(){
 const context=vm.createContext({})
 const files=['../tavern-plugin/lib/domain/indexed-array.js','../tavern-plugin/lib/domain/ordered-numeric-index.js','../tavern-plugin/src/client/modules/session-view-sync.js','../tavern-plugin/src/client/modules/live-tavern-view.js']
 vm.runInContext(files.map(path=>fs.readFileSync(new URL(path,import.meta.url),'utf8').replace(/^export .*$/gm,'')).join('\n'),context)
 return context
}
for(const count of [20,400,10000])test(`real delta routes only matching subscribers among ${count} turns`,async()=>{
 const h=harness(),begin=h.createSessionViewReader(),jobs=[]
 let cursor='a',sequence=0,edits=[],removals=[],fail=false
 const first=begin('s').accept({viewCursor:cursor,view:{inputSources:{},tavernHelper:{messages:[]}}}).view
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,schedule:run=>{jobs.push(run);return jobs.length},cancel(){},load:async()=>{
  if(fail)throw new Error('offline')
  const next=String(++sequence),result=begin('s').accept({viewCursor:next,viewDelta:{baseCursor:cursor,set:edits,remove:removals}})
  cursor=next;return result
 }})
 live.setView('s',first)
 let notices=0,global=0
 const selections=[]
 for(let i=0;i<count;i++){
  const selection=live.select('s',[['inputSources',String(i)]])
  selections.push(selection);selection.subscribe(()=>notices++)
 }
 live.subscribe('s',()=>global++)
 const snapshot=selections[0].getSnapshot();notices=0;global=0
 async function run(set=[],remove=[]){edits=set;removals=remove;if(!jobs.length)live.invalidate('s');jobs.shift()();await new Promise(resolve=>setImmediate(resolve))}
 await run([[['tavernHelper','variables'],{hp:1}]])
 assert.equal(notices,0);assert.equal(global,1);assert.equal(selections[0].getSnapshot(),snapshot)
 await run([[['inputSources','0'],undefined]])
 assert.equal(notices,1)
 assert.equal(Object.hasOwn(selections[0].getSnapshot().view.inputSources,'0'),true)
 await run([],[['inputSources','0']])
 assert.equal(notices,2);assert.equal(Object.hasOwn(selections[0].getSnapshot().view,'inputSources'),false)
 await run([[['inputSources'],{'0':'replaced'}]])
 assert.equal(notices,count+2)
 fail=true;await run();assert.equal(notices,2*count+2)
 fail=false;await run();assert.equal(notices,3*count+2)
 // A local optimistic view invalidates the incoming delta's published baseline.
 live.setView('s',{inputSources:{'0':'local'}});notices=0
 await run([[['tavernHelper','variables'],{hp:2}]])
 assert.equal(notices,count);assert.equal(selections[0].getSnapshot().view.inputSources['0'],'replaced')
})

test('overlapping dependencies notify once and unsubscribe removes path entries',async()=>{
 const h=harness(),begin=h.createSessionViewReader(),jobs=[]
 let cursor='a',sequence=0,edits=[]
 const first=begin('s').accept({viewCursor:cursor,view:{inputSources:{'1':'old'}}}).view
 const live=h.createLiveTavernViewModule({pollWhileBusy:false,schedule:run=>{jobs.push(run);return jobs.length},cancel(){},load:async()=>{
  const next=String(++sequence),result=begin('s').accept({viewCursor:next,viewDelta:{baseCursor:cursor,set:edits,remove:[]}});cursor=next;return result
 }})
 live.setView('s',first)
 let notices=0
 const stop=live.subscribe('s',()=>notices++,[['inputSources'],['inputSources','1']])
 live.subscribe('s',()=>{},[['mode']]);notices=0
 edits=[[['inputSources','1'],'new']];jobs.shift()();await new Promise(resolve=>setImmediate(resolve))
 assert.equal(notices,1)
 stop();live.invalidate('s');jobs.shift()();await new Promise(resolve=>setImmediate(resolve))
 assert.equal(notices,1)
})

test('overlapping selections preserve immutable parents and root selection returns full snapshot',()=>{
 const h=harness(),live=h.createLiveTavernViewModule({load:async()=>null,pollWhileBusy:false})
 const inputSources=Object.freeze({'1':'one'}),view=Object.freeze({inputSources})
 live.setView('s',view)
 const selection=live.select('s',[['inputSources','1'],['inputSources'],['inputSources']])
 assert.equal(selection.getSnapshot().view.inputSources,inputSources)
 assert.equal(live.select('s',[[]]).getSnapshot(),live.getSnapshot('s'))
})

for(const count of [20,400,10000])test(`Helper hydration does not broadcast to ${count} unrelated history subscribers`,async()=>{
 const h=harness(),jobs=[]
 let view={inputSources:{},tavernHelper:{messagesPending:{from:0,to:1}}}
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,
  schedule:run=>{jobs.push(run);return jobs.length},cancel(){},
  load:async()=>({view}),
  hydrateHelperMessages:async(_id,current)=>({...current,tavernHelper:{messages:[{text:'hydrated'}]}})
 })
 live.setView('s',view)
 let notices=0,helperNotices=0,globalNotices=0
 for(let i=0;i<count;i++)live.subscribe('s',()=>notices++,[['inputSources',String(i)]])
 live.subscribe('s',()=>helperNotices++,[['tavernHelper']])
 live.subscribe('s',()=>globalNotices++)
 notices=helperNotices=globalNotices=0
 jobs.shift()();await new Promise(resolve=>setImmediate(resolve))
 assert.equal(notices,0);assert.equal(helperNotices,1);assert.equal(globalNotices,1)
 assert.equal(live.getSnapshot('s').view.tavernHelper.messages[0].text,'hydrated')
 // Replacement and removal of an observed parent must still reach every child.
 view={...live.getSnapshot('s').view,inputSources:{'0':'new'}}
 live.setView('s',view);assert.equal(notices,count)
 const {inputSources,...removed}=view
 live.setView('s',removed);assert.equal(notices,2*count)
})

test('shared replacement routing preserves missing versus undefined and mutable compatibility',()=>{
 const h=harness()
 for(const deduplicateViews of [true,false]){
  const live=h.createLiveTavernViewModule({deduplicateViews,pollWhileBusy:false,schedule(){},cancel(){},load:async()=>({})})
  live.setView('s',{})
  let notices=0
  live.subscribe('s',()=>notices++,[['optional']]);notices=0
  live.setView('s',{optional:undefined});assert.equal(notices,1)
  live.setView('s',{});assert.equal(notices,2)
  if(!deduplicateViews){const mutable={nested:{value:1}};live.setView('s',mutable);notices=0;mutable.nested.value=2;live.setView('s',mutable);assert.equal(notices,1)}
 }
})

for(const count of [20,400,10000])test(`assistant field subscriptions exclude input and debug updates across ${count} floors`,()=>{
 const h=harness()
 const main=fs.readFileSync(new URL('../tavern-plugin/src/client/main.js',import.meta.url),'utf8')
 const paths=vm.runInContext(main.slice(main.indexOf('function tavernAssistantViewPaths('),main.indexOf('function TavernInlineStatusRuntime('))+';tavernAssistantViewPaths()',h)
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,schedule(){},cancel(){},load:async()=>({})})
 let view={mode:'story',replyProjections:[],tavernHelper:{variables:{hp:10}},inputSources:{}}
 live.setView('s',view)
 let notices=0,statusNotices=0
 for(let i=0;i<count;i++)live.select('s',paths).subscribe(()=>notices++)
 // Only the latest inline status runtime requires the complete view.
 live.subscribe('s',()=>statusNotices++)
 notices=statusNotices=0
 view={...view,inputSources:{'1':'changed'},debugTurns:[{turn:1}],cardUpdate:{available:true}}
 live.setView('s',view)
 assert.equal(notices,0);assert.equal(statusNotices,1)
 view={...view,tavernHelper:{variables:{hp:9}}};live.setView('s',view)
 assert.equal(notices,count,'arbitrary script dependencies must remain live')
 const assistant=main.slice(main.indexOf('function TavernAssistantNodeView('),main.indexOf('function TavernForkAssistantAction('))
 assert.match(assistant,/useLiveTavernView\(props.sessionId, revision, tavernAssistantViewPaths\(storyTurn,/)
 assert.match(assistant,/React.createElement\(TavernInlineStatusRuntime,/)
})

for(const count of [20,400,10000])test(`keyed receipt delta wakes only its turn among ${count} subscribers`,async()=>{
 const h=harness(),begin=h.createSessionViewReader(),jobs=[]
 let cursor='base',seq=0,receiptDelta,sets=[]
 const first=begin('s').accept({viewCursor:cursor,receiptSync:1,view:{mvuReceipts:Array.from({length:count},(_,turn)=>({turn,receipt:{status:'unchanged'}}))}}).view
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,schedule:run=>{jobs.push(run);return jobs.length},cancel(){},load:async()=>{
  const next=String(++seq),result=begin('s').accept({viewCursor:next,viewDelta:{baseCursor:cursor,set:sets,remove:[],receiptDelta}});cursor=next;return result
 }})
 live.setView('s',first)
 const notices=Array(count).fill(0)
 for(let turn=0;turn<count;turn++)live.subscribe('s',()=>notices[turn]++,[['$mvuReceiptTurn',String(turn)]])
 let whole=0;live.subscribe('s',()=>whole++,[['mvuReceipts']]);notices.fill(0);whole=0
 async function run(delta){receiptDelta=delta;if(!jobs.length)live.invalidate('s');jobs.shift()();await new Promise(resolve=>setImmediate(resolve))}
 await run({set:[{turn:3,receipt:{status:'updated'}}],remove:[]})
 assert.equal(notices.reduce((a,b)=>a+b),1);assert.equal(notices[3],1);assert.equal(whole,1)
 await run({set:[],remove:[3]})
 assert.equal(notices.reduce((a,b)=>a+b),2);assert.equal(notices[3],2)
 assert.equal(h.createSessionViewReader.receiptOrderedIndex.get(live.getSnapshot('s').view.mvuReceipts,3),undefined)
 // Whole-array replacement cannot assume unchanged turn identities.
 sets=[[['mvuReceipts'],[]]];await run(undefined)
 assert.equal(notices.reduce((a,b)=>a+b),count+2)
 live.setView('s',{mvuReceipts:[{turn:3,receipt:{status:'error'}}]})
 assert.equal(notices.reduce((a,b)=>a+b),2*count+2)
})

for(const count of [20,400,10000])test(`projection edits and newest ownership route by story turn across ${count} floors`,async()=>{
 const h=harness(),begin=h.createSessionViewReader(),jobs=[]
 let cursor='base',seq=0,sets=[],remove=[]
 const first=begin('s').accept({viewCursor:cursor,view:{replyProjections:Array.from({length:count},(_,turn)=>({turn:turn+1,version:2,parts:[]}))}}).view
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,schedule:run=>{jobs.push(run);return jobs.length},cancel(){},load:async()=>{
  const next=String(++seq),result=begin('s').accept({viewCursor:next,viewDelta:{baseCursor:cursor,set:sets,remove}});cursor=next;return result
 }})
 live.setView('s',first)
 const notices=new Map()
 for(let turn=1;turn<=count+1;turn++)live.subscribe('s',()=>notices.set(turn,(notices.get(turn)||0)+1),[['$projectionTurn',String(turn)],['$projectionLatestTurn',String(turn)]])
 notices.clear()
 async function run(edits,removed=[]){sets=edits;remove=removed;if(!jobs.length)live.invalidate('s');jobs.shift()();await new Promise(resolve=>setImmediate(resolve))}
 await run([[['replyProjections',2],{turn:3,version:2,parts:[{text:'edited'}]}]])
 assert.deepEqual([...notices.keys()],[3]);notices.clear()
 await run([[['replyProjections',count],{turn:count+1,version:2,parts:[]}],[['replyProjections','length'],count+1]])
 assert.deepEqual([...notices.keys()].sort((a,b)=>a-b),[count,count+1]);notices.clear()
 await run([[['replyProjections','length'],count]],[['replyProjections',count]])
 assert.deepEqual([...notices.keys()].sort((a,b)=>a-b),[count,count+1]);notices.clear()
 // Reassigning an existing row must invalidate both old and new turn identities.
 await run([[['replyProjections',2],{turn:4,version:2,parts:[]}]])
 assert.deepEqual([...notices.keys()].sort((a,b)=>a-b),[3,4]);notices.clear()
 await run([[['replyProjections'],[]]])
 assert.equal(notices.size,count+1)
})

for(const count of [20,400,10000])test(`regeneration mapping updates only old and new host turns across ${count} entries`,async()=>{
 const h=harness(),begin=h.createSessionViewReader(),jobs=[]
 let cursor='base',seq=0,sets=[],remove=[],visits=0
 h.createSessionViewReader.onStoryLookupVisit=()=>visits++
 h.createSessionViewReader.onTurnFieldVisit=()=>visits++
 const first=begin('s').accept({viewCursor:cursor,view:{regeneratedDshTurns:Object.fromEntries(Array.from({length:count},(_,id)=>[id+1,id+100]))}}).view
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,schedule:run=>{jobs.push(run);return jobs.length},cancel(){},load:async()=>{
  const next=String(++seq),result=begin('s').accept({viewCursor:next,viewDelta:{baseCursor:cursor,set:sets,remove}});cursor=next;return result
 }})
 live.setView('s',first)
 const notices=new Set()
 for(let turn=100;turn<count+100;turn++)live.subscribe('s',()=>notices.add(turn),[['$storyHostTurn',String(turn)]])
 notices.clear();visits=0
 async function run(edits,removed=[]){sets=edits;remove=removed;if(!jobs.length)live.invalidate('s');jobs.shift()();await new Promise(resolve=>setImmediate(resolve))}
 await run([[['regeneratedDshTurns','1'],101]])
 assert.deepEqual([...notices].sort((a,b)=>a-b),[100,101]);assert.ok(visits<1000,`${count}: ${visits}`)
 const lookup=h.createSessionViewReader.storyTurnLookup
 assert.equal(lookup.read(live.getSnapshot('s').view.regeneratedDshTurns,101),1,'first numeric story key wins duplicate host')
 assert.equal(lookup.read(first.regeneratedDshTurns,101),2,'old mapping remains isolated')
 notices.clear();visits=0
 await run([],[['regeneratedDshTurns','1']])
 assert.deepEqual([...notices],[101]);assert.equal(lookup.read(live.getSnapshot('s').view.regeneratedDshTurns,101),2)
 assert.ok(visits<1000)
 notices.clear()
 await run([[['regeneratedDshTurns'],{'legacy':101,'2':101}]])
 assert.equal(notices.size,count)
 assert.equal(lookup.read(live.getSnapshot('s').view.regeneratedDshTurns,101),2,'noncanonical keys retain ordinary object order')
})

for(const count of [20,400,10000])test(`Helper value updates only wake the eager floor among ${count} assistant floors`,()=>{
 const h=harness(),main=fs.readFileSync(new URL('../tavern-plugin/src/client/main.js',import.meta.url),'utf8')
 const paths=vm.runInContext(main.slice(main.indexOf('function tavernAssistantViewPaths('),main.indexOf('function TavernTurnMvuReceipt('))+';tavernAssistantViewPaths',h)
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,schedule(){},cancel(){},load:async()=>({})})
 let view={tavernHelper:{version:1},replyProjections:[]}
 live.setView('s',view)
 let notices=0
 for(let turn=1;turn<=count;turn++)live.subscribe('s',()=>notices++,paths(turn,turn===count))
 notices=0
 view={...view,tavernHelper:{version:2}};live.setView('s',view)
 assert.equal(notices,1)
 view={...view,tavernHelper:null};live.setView('s',view)
 assert.equal(notices,count+1,'Helper availability changes affect frame document identity')
 view={...view,tavernHelper:{version:3}};live.setView('s',view)
 assert.equal(notices,2*count+1)
})

test('deferred retained frames read Helper context at activation',()=>{
 let mounted
 const current={version:2},stale={version:1}
 const React={useRef:()=>({current:null}),useState:()=>[true,()=>{}],useSyncExternalStore:()=>[],useEffect(){},useLayoutEffect:run=>run(),createElement:()=>null}
 const h=vm.createContext({React,tavernPanelRegistry:{},tavernRetainedFrames:{key:()=> 'frame',mount:props=>{mounted=props;return {update(){},detach(){}}}}})
 vm.runInContext(fs.readFileSync(new URL('../tavern-plugin/lib/domain/frame-sizing.js',import.meta.url),'utf8').replace(/export \{[^}]+\}/,''),h)
 vm.runInContext(fs.readFileSync(new URL('../tavern-plugin/src/client/modules/frame-sizing.js',import.meta.url),'utf8'),h)
 vm.runInContext(fs.readFileSync(new URL('../tavern-plugin/src/client/modules/retained-message-frames.js',import.meta.url),'utf8'),h)
 h.TavernRetainedMessageFrame({sessionId:'s',turn:1,partIndex:0,content:'<p>hello</p>',helperContext:stale,helperContextReader:()=>current})
 assert.equal(mounted.helperContext,current)
})

for(const count of [20,400,10000])test(`busy and settlement ownership avoid ${count} historical body updates`,()=>{
 const h=harness(),main=fs.readFileSync(new URL('../tavern-plugin/src/client/main.js',import.meta.url),'utf8')
 const paths=vm.runInContext(main.slice(main.indexOf('function tavernReceiptViewPaths('),main.indexOf('function TavernTurnMvuReceipt('))+';tavernReceiptViewPaths',h)
 const bodyPaths=vm.runInContext(main.slice(main.indexOf('function tavernAssistantViewPaths('),main.indexOf('function tavernReceiptViewPaths('))+';tavernAssistantViewPaths',h)
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,schedule(){},cancel(){},load:async()=>({})})
 let view={activity:{busy:false},settlementTurn:count}
 live.setView('s',view)
 const receipts=new Set();let bodies=0
 for(let turn=1;turn<=count;turn++){
  live.subscribe('s',()=>receipts.add(turn),paths(turn,{status:turn===2?'pending':'updated'},turn===count))
  live.subscribe('s',()=>bodies++,bodyPaths(turn,false))
 }
 receipts.clear();bodies=0
 view={...view,activity:{busy:true}};live.setView('s',view)
 assert.deepEqual([...receipts].sort((a,b)=>a-b),[2,count]);assert.equal(bodies,0)
 receipts.clear()
 view={...view,activity:{busy:true,phase:'different'}};live.setView('s',view)
 assert.equal(receipts.size,0);assert.equal(bodies,0)
 view={...view,settlementTurn:count-1};live.setView('s',view)
 assert.deepEqual([...receipts].sort((a,b)=>a-b),[count-1,count]);assert.equal(bodies,0)
})

test('receipt component renews busy dependencies when ownership and pending status change',()=>{
 const main=fs.readFileSync(new URL('../tavern-plugin/src/client/main.js',import.meta.url),'utf8')
 let view={settlementTurn:3,activity:{busy:true}},receipt={status:'updated'},observed
 const h=vm.createContext({liveTavernView:{getSnapshot:()=>({view})},tavernMvuReceiptForTurn:()=>receipt,
  useLiveTavernView:(_session,_revision,paths)=>{observed=paths;return {view}},
  React:{createElement:(_tag,props)=>props},TavernMvuReceipt:()=>{}})
 vm.runInContext(main.slice(main.indexOf('function tavernReceiptViewPaths('),main.indexOf('function TavernInlineStatusRuntime(')),h)
 let output=h.TavernTurnMvuReceipt({sessionId:'s',turn:3})
 assert.equal(output.latest,true);assert.equal(output.busy,true);assert.ok(observed.some(path=>path[0]==='$receiptBusy'))
 view={settlementTurn:4,activity:{busy:false}}
 output=h.TavernTurnMvuReceipt({sessionId:'s',turn:3})
 assert.equal(output.latest,false);assert.equal(output.busy,false);assert.ok(!observed.some(path=>path[0]==='$receiptBusy'))
 receipt={status:'pending'};h.TavernTurnMvuReceipt({sessionId:'s',turn:3})
 assert.ok(observed.some(path=>path[0]==='$receiptBusy'))
 receipt=null;assert.equal(h.TavernTurnMvuReceipt({sessionId:'s',turn:3}),null)
})
