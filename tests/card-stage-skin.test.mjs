import test from 'node:test'
import assert from 'node:assert/strict'
import {activeStageSkin} from '../tavern-plugin/lib/domain/card-stage-settings.js'
import {PACK_ID} from './fixtures/asset-packs/pack.mjs'
test('active skin resolves historical override, card, global and built-in without writing state',()=>{
 const ref=id=>({packId:PACK_ID,kind:'skins',assetId:id})
 const input={extension:{stage:{defaultSkin:ref('trial')}},engine:{dialogueTheme:ref('pop')},manifests:[{id:PACK_ID,assets:[{kind:'skins',id:'trial'},{kind:'skins',id:'pop'}]}],state:{skin:{ref:ref('history')}}}
 const before=JSON.stringify(input)
 assert.deepEqual(activeStageSkin(input),ref('history'));assert.equal(JSON.stringify(input),before)
 assert.deepEqual(activeStageSkin({...input,state:null}),ref('trial'))
 assert.deepEqual(activeStageSkin({...input,state:null,extension:{}}),ref('pop'))
 assert.equal(activeStageSkin({...input,state:null,extension:{},engine:{dialogueTheme:'classic'}}),null)
})
