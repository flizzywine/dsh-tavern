import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageBacklogVoice}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/backlog-voice.cjs')
function fixture(){
 let current=null;const listeners=new Set()
 const player={get:()=>current,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}}
 const view=createStageBacklogVoice({player})
 return {view,listeners,set(value){current=value;for(const fn of [...listeners])fn()}}
}
test('narration advances only after its own audio ends and releases on disposal',async()=>{
 const f=fixture(),played=[]
 const handles=['a','b'].map(name=>({id:name,async click({id}){played.push(name);f.set({id,audio:{ended:false}});return true}}))
 await f.view.narration(handles).click()
 assert.deepEqual(played,['a']);assert.equal(f.listeners.size,1)
 const callback=[...f.listeners][0]
 // Another voice interrupts the sequence, even if the previous audio has ended.
 f.set({id:'other',audio:{ended:true}})
 assert.equal(f.listeners.size,0);assert.deepEqual(played,['a'])
 await f.view.narration(handles).click()
 f.view.dispose();callback()
 assert.equal(f.listeners.size,0);assert.deepEqual(played,['a','a'])
})
test('late playback completion cannot subscribe after unloading',async()=>{
 const f=fixture();let resolve
 const first={id:'a',click:()=>new Promise(done=>{resolve=done})}
 let second=0
 const pending=f.view.narration([first,{id:'b',click(){second++}}]).click()
 f.view.dispose();resolve(true);await pending
 assert.equal(f.listeners.size,0);assert.equal(second,0)
})
test('ended narration continues in order with one replay identity',async()=>{
 const f=fixture(),ids=[],audios=[]
 const handles=['a','b'].map(name=>({id:name,async click({id}){ids.push(id);const audio={ended:false};audios.push(audio);f.set({id,audio});return true}}))
 await f.view.narration(handles).click()
 audios[0].ended=true;f.set(null);await Promise.resolve()
 assert.deepEqual(ids,['["a","b"]','["a","b"]'])
 audios[1].ended=true;f.set(null);await Promise.resolve()
 assert.equal(f.listeners.size,0)
})
