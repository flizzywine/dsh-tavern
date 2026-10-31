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
