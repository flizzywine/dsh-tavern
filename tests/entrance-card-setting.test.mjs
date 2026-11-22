import test from 'node:test'
import assert from 'node:assert/strict'
import { selectStageEntrance } from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-entrance.js'
import {defaultAssetEngineSettings, validateAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {validateCardStage} from '../tavern-plugin/lib/domain/card-stage-settings.js'
import {entranceDoc} from './fixtures/stage-entrance.mjs'

const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222'
const ref={packId:A,kind:'entrances',assetId:'dive'}
const packs=[{manifest:{id:A,assets:[{id:'dive',kind:'entrances',name:'Dive',enabled:true,recall:{mode:'constant'},entrance:entranceDoc()}]}},{manifest:{id:B,assets:[]}}]
const card=ids=>({schemaVersion:1,assetBindings:{boundPackIds:ids}})

test('the card choice alone plays an entrance: none by default, explicit null is none, no switch or global default',()=>{
  const engine=defaultAssetEngineSettings(), owner=card([A]), borrower=card([B,A])
  assert.equal(selectStageEntrance(owner,packs,engine),null,'default none')
  assert.equal(selectStageEntrance(borrower,packs,engine),null)
  owner.stage={defaultEntrance:ref}
  assert.deepEqual(selectStageEntrance(owner,packs,engine).ref,ref)
  borrower.stage={defaultEntrance:ref}
  assert.deepEqual(selectStageEntrance(borrower,packs,engine).ref,ref)
  borrower.stage={defaultEntrance:null}
  assert.equal(selectStageEntrance(borrower,packs,engine),null)
  // the retired switches never gate it: a stored card switch is dropped on validation, the global one on read.
  const stage={defaultEntrance:ref,switches:{entrance:'off'}}
  validateCardStage(stage)
  assert.deepEqual(stage.switches,{})
  assert.deepEqual(selectStageEntrance({...card([A]),stage},packs,{...engine,stageToggles:{...engine.stageToggles,entrance:false}}).ref,ref)
  assert.equal(selectStageEntrance(card([B]),packs,engine),null)
  assert.doesNotThrow(()=>validateAssetEngineSettings(engine))
})
