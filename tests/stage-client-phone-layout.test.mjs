import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStagePhoneLayout}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/phone-layout.cjs')
test('phone layout keeps legacy preferences and separates wide and narrow layouts',()=>{
  const writes=[],sections={}
  const view=createStagePhoneLayout({width:()=>500,sections,storage:{
    getItem:key=>{assert.equal(key,'fork-phone-layout');return JSON.stringify({wide:{size:80,place:[.2,.7]},narrow:{size:50},unlocked:true})},
    setItem:(key,value)=>writes.push([key,JSON.parse(value)]),
  }})
  assert.equal(view.prefs.current(),'narrow')
  assert.equal(view.prefs.current(900),'wide')
  assert.equal(view.prefs.get().narrow.size,70)
  assert.equal(view.prefs.get().wide.size,80)
  let notices=0
  view.prefs.subscribe(()=>notices++)
  view.prefs.update('narrow',{size:140})
  assert.equal(notices,1)
  assert.equal(writes[0][0],'fork-phone-layout')
  assert.deepEqual(writes[0][1].wide,{size:80,place:[.2,.7]})
  assert.ok(sections['dsh.phone'])
  view.dispose()
  view.prefs.update('wide',{size:100})
  assert.equal(writes.length,1)
  assert.equal(sections['dsh.phone'],undefined)
})
test('phone settings disposal preserves a replacement settings section',()=>{
  const sections={}
  const view=createStagePhoneLayout({sections})
  sections['dsh.phone']='replacement'
  view.dispose();view.dispose()
  assert.equal(sections['dsh.phone'],'replacement')
})
