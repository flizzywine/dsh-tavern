import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const {createStageSpeaker}=createRequire(import.meta.url)('../tavern-plugin/packages/dsh-tavern-stage/src/client/speaker.cjs')
test('stage speaker resolves authored names to the same actor for avatar and lip sync',()=>{
 const speaker=createStageSpeaker({character:()=>({alias:'authored',ref:'figure-ref'}),resolve:()=>({actorKey:'actor'}),render:(figure,options)=>({...options,face:figure.alias})})
 const figures=[{alias:'actor'},{alias:'other'}],rows=speaker.rows(figures)
 assert.equal(speaker.key({},rows,{kind:'line'}),'actor')
 assert.equal(speaker.key({},rows,{kind:'narration'}),'')
 const portraits=speaker.portraits(figures,'s')
 assert.equal(speaker.avatarOf({},figures,portraits,{}),'actor')
 const voice=speaker.voiceInputs(figures,{audio:'voice',speaker:'actor',sessionId:'s',turn:1,page:2})
 assert.equal(voice.get('actor').speaking,true)
 assert.equal(voice.get('other').speaking,false)
 assert.equal(voice.get('actor').voiceKey,'1:2')
 const call=speaker.voiceInputs(figures,{callAudio:'call',phoneVoice:{alias:'other'},phoneCallKey:'key',sessionId:'s'})
 assert.equal(call.get('actor').audio,null)
 assert.equal(call.get('other').audio,'call')
 assert.equal(call.get('other').voiceKey,'phone-call:key')
})
test('stage-only figure placement and missing-image notices respect visibility and authored fallback',()=>{
 const speaker=createStageSpeaker({})
 const state={cast:['a','b'],actors:{a:{gaze:'b'},b:{gaze:'a'}}}
 assert.deepEqual(speaker.members(state,id=>id==='b').map(({id,x})=>({id,x})),[{id:'b',x:.5}])
 assert.equal(speaker.shade('b','a',[{id:'a'},{id:'b'}],{},false),1)
 assert.equal(speaker.shade('b','a',[{id:'a'},{id:'b'}],{mode:'close',actor:'a'},true),.8*.82)
 const missing={alias:'a',form:'sprite',spriteResolution:{missing:true,requestedEmotion:'joy'}}
 assert.equal(speaker.standIn(missing),true)
 assert.equal(speaker.fallbacks([missing],()=>true,()=>true)[0].shown,'@avatar')
 assert.deepEqual(speaker.fallbacks([{...missing,views:{stage:false}}]),[])
 assert.deepEqual(speaker.fallbacks([{...missing,spriteResolution:{...missing.spriteResolution,intentionalFallback:true}}]),[])
})
