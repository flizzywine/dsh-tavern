import test from 'node:test'
import assert from 'node:assert/strict'
import {fixture,answer} from './helpers/stage-director-harness.mjs'
import {assetPackDigest} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-asset-pack-catalogue.js'
import {createStagePlayback,stagePlaybackWriter,stagePlaybackFrames,validateStagePlayback} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-playback.js'

// A pack skin's document may carry its own figures.ruler and a mod's locks list; the frame writer drops every key the
// validator refuses, so the playback it saves always validates.
test('a skin document with its own figures.ruler and a mod locks list still freezes a frame that validates',async t=>{
  const f=await fixture(request=>request.onToolCall({name:'stage_update',arguments:answer}))
  t.after(()=>f.dispose())
  await f.director.get(f.read());await f.director.drain()
  const direction=await f.director.get(f.read(),1,null,{readOnly:true}), data=createStagePlayback(direction), append=stagePlaybackWriter(data)
  const key=assetPackDigest({id:'skin'}), skin={document:{figures:{ruler:160,scale:1.32},mods:{'dsh.timer':{enabled:true,locks:[]}}}}
  append.projection(key,{state:{},characters:[],avatars:[],scene:{skin,figureScale:{hMax:1}},audio:{music:null}})
  assert.doesNotThrow(()=>validateStagePlayback(data,direction))
  assert.deepEqual(stagePlaybackFrames(data)[key].scene,{skin:{document:{figures:{scale:1.32},mods:{'dsh.timer':{enabled:true}}}}})
})