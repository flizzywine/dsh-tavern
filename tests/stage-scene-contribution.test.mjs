import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {candidateSceneMerge,stageSceneActorRequest,stageSceneProgress,stageScenePlayback}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/controller.cjs')

test('scene dialogue progress follows its own lines and clears on release',()=>{
  assert.deepEqual(stageSceneProgress({lines:[{text:'battle'}],index:0}),{index:0,count:1})
  assert.deepEqual(stageSceneProgress({lines:[{},{}],index:1}),{index:1,count:2})
  assert.equal(stageSceneProgress(null),null)
})

test('two actors retain authored reactions while line emotion takes precedence for the speaker',()=>{
  const first={instanceId:'a',ref:{packId:'p',figureId:'a'},emotion:'calm'},second={instanceId:'b',ref:{packId:'p',figureId:'b'},emotion:'anxious'}
  assert.equal(stageSceneActorRequest(first,first,{emotion:'joy'}).stateId,'joy')
  assert.equal(stageSceneActorRequest(second,first,{emotion:'joy'}).stateId,'anxious')
  assert.equal(stageSceneActorRequest(first,first,{}).stateId,'calm')
})

test('contributed actors preserve the native camera and never substitute a different outfit while loading',()=>{
  const ref={packId:'pack',figureId:'actor'},native={sourceRef:ref,sourceOutfitKey:'normal'},scene={figures:[native],effects:[],camera:{shot:'pan-left'}}
  const normal={instanceId:'a',ref,outfitKey:'normal'},shiny={...normal,outfitKey:'shiny'}
  assert.equal(candidateSceneMerge(scene,{},[normal],[],null,null).figures[0],native)
  assert.equal(candidateSceneMerge(scene,{},[shiny],[],null,null).figures.length,0)
  const rendered={sourceRef:ref}
  const result=candidateSceneMerge(scene,{},[normal],[rendered],{text:'hello'},normal)
  assert.deepEqual(result.figures,[rendered]);assert.equal(result.camera,scene.camera)
  const background={identity:'new'}
  assert.equal(candidateSceneMerge(scene,{resolvedBackground:background},[],[],null,null).background,background)
  assert.equal(candidateSceneMerge({...scene,background}, {resolvedBackground:null},[],[],null,null).background,background)
})

test('native and contributed actors share the skin layout and speaker priority',()=>{
  const scene={figures:[{alias:'story',x:0.5}],effects:[],camera:{},figureLayout:{cast:['story'],priority:['story'],slots:[0.2,0.5,0.8],max:3,framing:{mode:'fit'}}}
  const actors=[{instanceId:'left',ref:{packId:'p',figureId:'a'}},{instanceId:'right',ref:{packId:'p',figureId:'b'}}]
  const contributed=[{alias:'candidate:left',x:0.2,sourceRef:actors[0].ref},{alias:'candidate:right',x:0.8,sourceRef:actors[1].ref}]
  const merged=candidateSceneMerge(scene,{},actors,contributed,{text:'line'},actors[1])
  assert.deepEqual(merged.figureLayout.cast,['candidate:left','story','candidate:right'])
  assert.equal(merged.figureLayout.priority[0],'candidate:right')
  assert.equal(merged.figureLayout.max,3)
  assert.equal(merged.figureLayout.slots,scene.figureLayout.slots)
  assert.equal(merged.figureLayout.framing,scene.figureLayout.framing)
})


test('ordinary story speaker retains priority when its stage actor is replaced',()=>{
  const ref={packId:'p',figureId:'oak'}
  const scene={figures:[{alias:'oak',sourceRef:ref}],effects:[],figureLayout:{priority:['oak']}}
  const actor={instanceId:'oak',ref}
  const rendered={alias:'candidate:oak',sourceRef:ref,speaking:true,x:0.4}
  const result=candidateSceneMerge(scene,{},[actor],[rendered],null,null)
  assert.deepEqual(result.figures,[rendered])
  assert.equal(result.figureLayout.priority[0],'candidate:oak')
})


test('HUD playback signals only completed, presentable latest live story',()=>{
 const ready={turn:2,latestTurn:2,mode:'live',atEnd:true,typed:true,current:{pending:false},blocked:false}
 assert.deepEqual(stageScenePlayback(ready),{turn:2,atEnd:true})
 for(const changes of [{mode:'history'},{mode:'replay'},{turn:1},{atEnd:false},{typed:false},{current:{pending:true}},{current:null},{blocked:true}])
   assert.equal(stageScenePlayback({...ready,...changes}).atEnd,false)
})
