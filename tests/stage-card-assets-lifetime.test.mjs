import test from 'node:test'
import assert from 'node:assert/strict'
import {createStageCardAssets} from '../tavern-plugin/lib/stage-card-assets.js'

test('card import authorization rejects a card read completed after stage disposal',async()=>{
  let active=true,resolve;const pending=new Promise(done=>resolve=done),services=new Map()
  createStageCardAssets({ctx:{get:()=>null,provide:(name,value)=>services.set(name,value)},active:()=>active,
    assetEngineSettings:{read:()=>({values:{}})},modManifests:async()=>[],fileResources:{},readCardWorkspace:()=>pending,
    cardId:()=> 'card',cardPreparation:{},cardStorage:{},persistence:()=>({})})
  const read=services.get('tavernAssetCards').snapshot({path:'cards/card.json'})
  active=false;resolve({meta:{id:'card'}})
  await assert.rejects(read,{code:'ASSET_UNAVAILABLE'})
  await assert.rejects(services.get('tavernAssetCards').snapshot({path:'cards/card.json'}),{code:'ASSET_UNAVAILABLE'})
})
