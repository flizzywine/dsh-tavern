import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'

for(const count of [20,400,10000])test(`production mapping delta is keyed and only wakes affected host turns at ${count} rows`,async()=>{
 const h=vm.createContext({})
 const files=['../tavern-plugin/lib/domain/indexed-array.js','../tavern-plugin/lib/domain/ordered-numeric-index.js','../tavern-plugin/src/client/modules/session-view-sync.js','../tavern-plugin/src/client/modules/live-tavern-view.js']
 vm.runInContext(files.map(path=>fs.readFileSync(new URL(path,import.meta.url),'utf8').replace(/^export .*$/gm,'')).join('\n'),h)
 const server=createSessionViewSync(),begin=h.createSessionViewReader(),jobs=[]
 let view={regeneratedDshTurns:Object.fromEntries(Array.from({length:count},(_,id)=>[id+1,id+100]))}
 const first=server('s',view)
 const client=begin('s').accept(first)
 let cursor=first.viewCursor,lastDelta
 const live=h.createLiveTavernViewModule({deduplicateViews:true,pollWhileBusy:false,schedule:run=>{jobs.push(run);return jobs.length},cancel(){},load:async()=>{
  const result=server('s',view,cursor);cursor=result.viewCursor;lastDelta=result.viewDelta;return begin('s').accept(result)
 }})
 live.setView('s',client.view)
 const notified=new Set()
 for(let turn=100;turn<count+100;turn++)live.subscribe('s',()=>notified.add(turn),[['$storyHostTurn',String(turn)]])
 notified.clear()
 async function refresh(){if(!jobs.length)live.invalidate('s');jobs.shift()();await new Promise(resolve=>setImmediate(resolve))}
 view.regeneratedDshTurns['1']=101
 await refresh()
 assert.deepEqual(lastDelta.set,[[['regeneratedDshTurns','1'],101]])
 assert.deepEqual([...notified].sort((a,b)=>a-b),[100,101])
 assert.ok(JSON.stringify(lastDelta).length<200)
 notified.clear()
 delete view.regeneratedDshTurns['1'];await refresh()
 assert.deepEqual(lastDelta.remove,[['regeneratedDshTurns','1']]);assert.deepEqual([...notified],[101])
 assert.equal(h.createSessionViewReader.storyTurnLookup.read(live.getSnapshot('s').view.regeneratedDshTurns,101),2)
 assert.equal(h.createSessionViewReader.storyTurnLookup.read(client.view.regeneratedDshTurns,100),1)
})

test('mapping parent replacement and removal preserve wire semantics',()=>{
 const sync=createSessionViewSync()
 let result=sync('s',{})
 result=sync('s',{regeneratedDshTurns:{'1':8}},result.viewCursor)
 assert.deepEqual(result.viewDelta.set,[[['regeneratedDshTurns'],{}],[['regeneratedDshTurns','1'],8]])
 result=sync('s',{regeneratedDshTurns:null},result.viewCursor)
 assert.deepEqual(result.viewDelta.set,[[['regeneratedDshTurns'],null]])
 assert.deepEqual(result.viewDelta.remove,[['regeneratedDshTurns','1']])
 result=sync('s',{},result.viewCursor)
 assert.deepEqual(result.viewDelta.remove,[['regeneratedDshTurns']])
})
