import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageDanmakuSettings}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/danmaku-settings.cjs')
test('danmaku setting conflict reloads revision and preserves other stored settings',async()=>{
 const writes=[],events=[];let reads=0
 const settings=createStageDanmakuSettings({window:{dispatchEvent:event=>events.push(event)},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init.detail}}})
 const rpc=async(name,args)=>{
  if(name==='getMod')return {revision:++reads,authorized:true,settings:{storedValues:{view:'overlay',opacity:reads*30}}}
  writes.push(args);if(writes.length===1)throw Object.assign(Error('conflict'),{code:'MOD_REVISION_CONFLICT'})
 }
 assert.equal(await settings.save(rpc,{view:'off'},true),true)
 assert.equal(writes.length,2);assert.deepEqual(writes[1].values,{view:'off',opacity:60})
 assert.equal(writes[1].expectedRevision,2);assert.equal(events.length,1)
})
test('unloading while permission is pending prevents authorization and save',async()=>{
 let confirm;const calls=[]
 const settings=createStageDanmakuSettings({})
 const pending=settings.save(async name=>{calls.push(name);return {revision:1,authorized:false}}, {view:'overlay'},false,()=>new Promise(resolve=>confirm=resolve))
 await Promise.resolve();settings.dispose();confirm(true)
 assert.equal(await pending,false);assert.deepEqual(calls,['getMod'])
})
