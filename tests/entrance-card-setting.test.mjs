import test from 'node:test'
import assert from 'node:assert/strict'
import {selectStageEntrance, stageEntranceChoices} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/stage-entrance.js'
import {defaultAssetEngineSettings, validateAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {validateCardStage} from '../tavern-plugin/lib/domain/card-stage-settings.js'
import {createCardBundleAdapter} from '../tavern-plugin/packages/dsh-tavern-stage/lib/card-bundle.js'
import {createCardPreparation} from '../tavern-plugin/lib/domain/card-preparation.js'
import {entranceDoc} from './fixtures/stage-entrance.mjs'

const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222'
const ref={packId:A,kind:'entrances',assetId:'dive'}
const packs=[{manifest:{id:A,assets:[{id:'dive',kind:'entrances',name:'Dive',enabled:true,recall:{mode:'constant'},entrance:entranceDoc()}]}},{manifest:{id:B,assets:[]}}]
const card=ids=>({schemaVersion:1,assetBindings:{boundPackIds:ids}})

test('borrowing another card pack never implicitly selects its entrance; explicit choice, none and global precedence',()=>{
  const engine=defaultAssetEngineSettings(), owner=card([A]), borrower=card([B,A])
  assert.equal(selectStageEntrance(owner,packs,engine),null)
  assert.equal(selectStageEntrance(borrower,packs,engine),null)
  owner.stage={defaultEntrance:ref}
  assert.deepEqual(selectStageEntrance(owner,packs,engine).ref,ref)
  borrower.stage={defaultEntrance:ref}
  assert.deepEqual(selectStageEntrance(borrower,packs,engine).ref,ref)
  engine.defaultEntrance=ref
  borrower.stage={defaultEntrance:null}
  assert.equal(selectStageEntrance(borrower,packs,engine),null)
  delete borrower.stage.defaultEntrance
  assert.deepEqual(selectStageEntrance(borrower,packs,engine).ref,ref)
  borrower.stage={defaultEntrance:ref,switches:{entrance:'off'}}
  assert.equal(selectStageEntrance(borrower,packs,engine),null)
  assert.equal(selectStageEntrance(card([B]),packs,engine),null)
  assert.doesNotThrow(()=>validateAssetEngineSettings(engine))
})

test('entrance choices ignore recall lamps and include the selected skin pack',()=>{
  const snapshots=structuredClone(packs), engine=defaultAssetEngineSettings(), extension=card([B])
  snapshots[0].manifest.assets[0].enabled=false
  snapshots[0].manifest.assets[0].recall.mode='keyword'
  snapshots[0].manifest.assets.push({kind:'skins',id:'skin'})
  extension.stage={defaultSkin:{packId:A,kind:'skins',assetId:'skin'},defaultEntrance:ref}
  assert.deepEqual(stageEntranceChoices(extension,snapshots,engine),[{value:ref,label:'Dive'}])
  assert.deepEqual(selectStageEntrance(extension,snapshots,engine).ref,ref)
})

test('card export/import preserves chosen default and explicit none, and remaps pack identity',()=>{
  const adapter=createCardBundleAdapter({cardPreparation:createCardPreparation()})
  for(const choice of [ref,null]) {
    const extension={...card([A]),stage:{defaultEntrance:choice}}
    validateCardStage(extension.stage)
    const exported=adapter.exportRaw({name:'Entrance fixture',extensions:{dsh_tavern:extension}})
    const imported=adapter.inspectRaw(JSON.parse(JSON.stringify(exported))).raw
    assert.deepEqual(imported.extensions.dsh_tavern.stage.defaultEntrance,choice)
    const remapped=adapter.remapRaw(imported,[{from:A,packId:B,figures:{}}])
    assert.deepEqual(remapped.extensions.dsh_tavern.stage.defaultEntrance,choice?{...ref,packId:B}:null)
  }
})
