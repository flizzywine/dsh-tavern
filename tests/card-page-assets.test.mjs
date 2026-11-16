import {syntheticPack,FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {locateCardPageAsset,listCardPageAssets} from '../tavern-plugin/packages/dsh-tavern-stage/lib/domain/card-page-assets.js'

const snapshot=async packId=>({manifest:{assets:[
  {kind:'backgrounds',id:'garden',name:'庭院',enabled:true,variants:{default:'day',entries:[{id:'day',content:{media:packId+'-day'}},{id:'night',content:{media:packId+'-night'}}]}},
  {kind:'backgrounds',id:'hidden',enabled:false,media:'hidden'},
  {kind:'videos',id:'opening',bundleKey:'intro',entry:'main.webm',poster:'poster.webp'}
],files:[{path:'bundles/intro/main.webm'},{path:'bundles/intro/poster.webp'}]}})

test('bound pack order, variants and thumbnail sizes resolve without unbound lookups',async()=>{
  const read=[]
  const lookup=async id=>{read.push(id);return snapshot(id)}
  assert.deepEqual(await locateCardPageAsset(lookup,['first','second'],{kind:'backgrounds',id:'garden',variant:'night',size:512}),{packId:'first',hash:'first-night',size:512})
  assert.deepEqual(read,['first'])
  assert.equal(await locateCardPageAsset(snapshot,[],{kind:'backgrounds',id:'garden'}),null)
  assert.deepEqual(await locateCardPageAsset(snapshot,['second'],{kind:'backgrounds',id:'garden'}),{packId:'second',hash:'second-day'})
})

test('bundle files and deduplicated enabled lists follow the pack',async()=>{
  assert.deepEqual(await locateCardPageAsset(snapshot,['first'],{kind:'videos',id:'opening',file:'poster'}),{packId:'first',bundleKey:'intro',file:'poster.webp'})
  assert.deepEqual(await listCardPageAssets(snapshot,['first','second'],'backgrounds'),[{id:'garden',name:'庭院',variants:['day','night']}])
  assert.deepEqual(await listCardPageAssets(snapshot,['first'],'videos'),[{id:'opening',name:'opening',files:['main.webm','poster.webp']}])
})

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
