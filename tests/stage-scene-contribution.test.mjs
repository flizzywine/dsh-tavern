import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const {candidateSceneMerge}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/controller.cjs')

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
