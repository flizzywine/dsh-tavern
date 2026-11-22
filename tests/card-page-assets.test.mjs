import {syntheticPack,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {locateCardPageAsset,listCardPageAssets} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/card-page-assets.js'

test('figures resolve by id or name, outfit and emotion from the bound packs',async()=>{
  const pack=await syntheticPack(),figure=pack.figures[FIGURE_ID]
  const lookup=async packId=>packId==='first'?{manifest:{assets:[]},figures:pack.figures,sprites:pack.sprites}:{manifest:{assets:[]}}
  const avatar=await locateCardPageAsset(lookup,['none','first'],{kind:'figures',id:FIGURE_ID,file:'avatar',size:256})
  assert.match(avatar.hash,/^[0-9a-f]{64}$/);assert.deepEqual({...avatar,hash:0},{packId:'first',hash:0,size:256})
  assert.deepEqual(await locateCardPageAsset(lookup,['first'],{kind:'figures',id:figure.name,variant:'casual',file:'sprite'}),{packId:'first',hash:Object.values(figure.outfits[1].sprite.assets)[0]})
  assert.equal(await locateCardPageAsset(lookup,['first'],{kind:'figures',id:'nobody'}),null)
  assert.equal(await locateCardPageAsset(lookup,['none'],{kind:'figures',id:FIGURE_ID}),null)
  assert.deepEqual(await listCardPageAssets(lookup,['none','first'],'figures'),[{id:FIGURE_ID,name:figure.name,variants:['school','casual']}])
})
