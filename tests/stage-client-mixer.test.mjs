import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
const {createStageMixer} = createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/mixer.cjs')
const context={module:{exports:{}}}
vm.runInNewContext(readFileSync(new URL('../tavern-plugin/src/client/stage-entries.js',import.meta.url),'utf8'),context)
const {stageEntries}=context.module.exports
test('mixer owns its entry and icon and fences old controls on disposal', () => {
  const calls=[],icons={}, state={master:1,voice:1,music:1,sfx:.5,ambience:1,ui:1,muted:{sfx:true}}
  const view=createStageMixer({React:{createElement:(type,props,...children)=>({type,props,children})},Icon:'Icon',Slider:'Slider',
    audio:{toggleMute:layer=>calls.push(layer),setVolume:(layer,value)=>calls.push([layer,value])},
    sounds:{play:cue=>calls.push(cue)},entries:stageEntries,icons,
  })
  assert.equal(view.level(state),'partial')
  assert.equal(view.level({...state,master:0}),'muted')
  assert.equal(view.level({...state,muted:{}}),'normal')
  assert.equal(view.icon('partial'),'speaker-low')
  assert.ok(stageEntries.list().some(entry=>entry.id==='sound'))
  const tree=view.Rows({state}), rows=tree.children[0]
  assert.equal(rows.length,6)
  const sound=rows.find(row=>row.props['data-layer']==='sfx')
  sound.children[0].props.onClick()
  sound.children[2].props.onChange(.7)
  assert.deepEqual(calls,['sfx',['sfx',.7]])
  view.dispose();view.dispose()
  sound.children[0].props.onClick()
  sound.children[2].props.onChange(.2)
  assert.equal(calls.length,2)
  assert.equal(icons['speaker-low'],undefined)
  assert.equal(stageEntries.list().some(entry=>entry.id==='sound'),false)
})
test('old mixer cleanup does not unregister a replacement entry or remove host icon', () => {
  const icons={'speaker-low':'host'}
  const view=createStageMixer({entries:stageEntries,icons})
  const remove=stageEntries.register({id:'sound',label:'replacement'})
  view.dispose()
  assert.equal(stageEntries.list().find(row=>row.id==='sound').label,'replacement')
  assert.equal(icons['speaker-low'],'host')
  remove()
})

test('sound tab edits the shared voice-rate preference and ducking without owning their stores',()=>{
  const changes=[],controls=[]
  const fields={group:()=>null,row:()=>null,Switch:'Switch',slider:(_,props)=>{controls.push(props);return null}}
  const reading={get:()=>({voiceRate:1.2}),set:patch=>changes.push(patch)}
  const view=createStageMixer({React:{useSyncExternalStore:(_,get)=>get(),createElement:(type,props)=>{if(type==='Switch')controls.push(props);return null}},fields,reading,voiceRateLimits:[.8,2,.1],
    audio:{getSnapshot:()=>({duck:true}),setDucking:value=>changes.push(value)},
  })
  view.Sound({})
  assert.equal(controls[1].value,1.2)
  assert.deepEqual([controls[1].min,controls[1].max,controls[1].step],[.8,2,.1])
  controls[0].onChange(false);controls[1].onChange(1.5)
  assert.deepEqual(changes,[false,{voiceRate:1.5}])
  view.dispose()
  controls[0].onChange(true);controls[1].onChange(2)
  assert.equal(changes.length,2)
  assert.equal(reading.get().voiceRate,1.2)
})

test('shared audio snapshot remains stable between writes and publishes before listeners run',()=>{
  const sandbox={localStorage:{getItem:()=>null,setItem(){}}}
  const base=new URL('../tavern-plugin/src/client/',import.meta.url)
  vm.runInNewContext(readFileSync(new URL('stage-audio-math.js',base),'utf8')+'\n'+readFileSync(new URL('stage-audio.js',base),'utf8')+'\nthis.audio=forkStageAudio;',sandbox)
  const audio=sandbox.audio,first=audio.getSnapshot()
  assert.equal(audio.getSnapshot(),first)
  let observed
  const stop=audio.subscribe(()=>{observed=audio.getSnapshot()})
  audio.toggleMute('music')
  assert.notEqual(observed,first)
  assert.equal(observed,audio.getSnapshot())
  assert.equal(first.muted.music,undefined)
  assert.equal(observed.muted.music,true)
  audio.get().muted.music=false
  assert.equal(audio.getSnapshot().muted.music,true)
  stop()
})
