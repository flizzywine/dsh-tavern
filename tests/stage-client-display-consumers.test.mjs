import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {createStageDisplayConsumers}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/display-consumers.cjs')
const {createStageDisplays}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/displays.cjs')
function harness({failOpen=false,failClose=false}={}){
 const calls=[],effects=[],displays=createStageDisplays()
 const React={useRef:value=>({current:value}),useMemo:fn=>fn(),useCallback:fn=>fn,useLayoutEffect:fn=>effects.push(fn())}
 const state={accepted:{scene:null},director:{},settings:{config:{stage:{director:true}}}}
 const store={getSnapshot:()=>state,dispatch:event=>{calls.push(event.opened?'open':'close');if(event.opened?failOpen:failClose)throw Error('dispatch')}}
 const consumers=createStageDisplayConsumers({React,displays,ambience:{performance:()=>calls.push('ambience-layer'),release:()=>calls.push('ambience-release')},sfx:{stop:()=>calls.push('sfx-stop')},voice:{allowed:()=>true,handle:()=>({click:options=>calls.push(options)}),stop:()=>calls.push('voice-stop'),stopPlayback:()=>calls.push('voice-playback')}})
 return {calls,effects,displays,consumers,store}
}
test('display confirmation, speech routing and plugin teardown use one instance lifetime',async()=>{
 const h=harness();const confirm=h.consumers.useConsumers('s',h.store,()=>{})
 const pending=h.displays.present('s',{groups:['visual'],accepted:{scene:null,presentationRevision:4}})
 confirm(4);assert.equal((await pending).status,'presented')
 h.displays.play('s',{kind:'voice'},{anchor:{para:1,paragraphId:'a'}})
 assert.deepEqual(h.calls[1],{handoff:true,automatic:true})
 const cancelled=h.displays.present('s',{groups:['visual'],accepted:{scene:null,presentationRevision:5}})
 h.consumers.dispose();assert.equal((await cancelled).status,'cancelled')
 h.effects[0]();assert.deepEqual(h.calls.slice(2),['close','ambience-layer','sfx-stop','voice-stop'])
 assert.ok(!h.calls.includes('ambience-release'));h.displays.dispose()
})
test('failed close still releases all instance media and settles presentation wait',async()=>{
 const h=harness({failClose:true});h.consumers.useConsumers('s',h.store,()=>{})
 const pending=h.displays.present('s',{groups:['visual'],accepted:{scene:null,presentationRevision:1}})
 assert.throws(()=>h.consumers.dispose(),/cleanup failed/)
 assert.equal((await pending).status,'cancelled');assert.deepEqual(h.calls,['open','close','ambience-layer','sfx-stop','voice-stop'])
 h.effects[0]();h.displays.dispose()
})
test('failed opening rolls back registration and media without waiting for React unmount',async()=>{
 const h=harness({failOpen:true})
 assert.throws(()=>h.consumers.useConsumers('s',h.store,()=>{}),/dispatch/)
 assert.equal((await h.displays.present('s',{})).reason,'absent')
 assert.deepEqual(h.calls,['open','close','ambience-layer','sfx-stop','voice-stop']);h.consumers.dispose();h.displays.dispose()
})
