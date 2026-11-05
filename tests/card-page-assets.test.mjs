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
