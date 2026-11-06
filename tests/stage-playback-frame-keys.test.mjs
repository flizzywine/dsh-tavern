import {figureActorKey} from '../tavern-plugin/lib/domain/figure-catalogue.js'
import {PACK_ID,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {readStageProjection} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-projection.js'
import {saveStagePlayback} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-playback.js'
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
test('external pack publication during reconstruction prevents saving stale frames',async t=>{
  const f=await fixture(request=>request.onToolCall({name:'stage_update',arguments:{...answer,beats:[{...answer.beats[0],ops:[...answer.beats[0].ops,{op:'cast.add',actor:figureActorKey({packId:PACK_ID,figureId:FIGURE_ID})}]},answer.beats[1]]}}))
  t.after(()=>f.dispose())
  await f.director.get(f.read());await f.director.drain()
  const lib=f.services.get('assetLibrary'),get=lib.getPackSnapshot.bind(lib)
  let reads=0
  lib.getPackSnapshot=async args=>{
    const pack=structuredClone(await get(args))
    if(++reads>1 && pack) pack.revision='external-publication'
    return pack
  }
  const readDirection=()=>f.director.get(f.read(),1,null,{readOnly:true})
  const direction=await readDirection()
  const result=await readStageProjection({at:1,history:true,expectedDirectionToken:direction.token,readDirection,
    readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),
    readSettings:()=>f.engineSettings.read(),revision:()=>f.assets.revision,
    readPlayback:()=>f.read().messages[0].stagePlaybackV1,
    writePlayback:async (direction,candidate)=>{
      let saved
      await f.store.updateChat('chat',chat=>{saved=saveStagePlayback(chat,1,direction,candidate);return chat})
      return saved
    }})
  assert.equal(result.status,'stale')
  assert.equal(f.read().messages[0].stagePlaybackV1,undefined)
})
