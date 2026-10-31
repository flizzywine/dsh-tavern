import assert from 'node:assert/strict'
import {createPluginHost} from './plugin-host.mjs'
const host=await createPluginHost({withTools:true,config:{stage:false}})
try {
  assert.equal(host.services.has('tavernManagedModules'),false)
  assert.equal(host.services.has('tavernAssetCards'),false)
  assert.equal(host.services.has('tavernAssetDependencies'),false)
  const settings=await host.rpc('getTavernSettings',{})
  assert.equal(settings.modModelSlots.some(row=>row.modId==='dsh.stage'),false)
  assert.deepEqual(settings.scoringCatalog,[])
  const imported=await host.rpc('importCard',{payload:{name:'ordinary.json',text:JSON.stringify({spec:'chara_card_v2',spec_version:'2.0',data:{name:'Ordinary',first_mes:'Hello',extensions:{}}})}})
  assert.ok(imported.card.path)
  assert.ok(await host.rpc('listCards',{}))
  assert.equal(host.services.get('tavern').modHostApi,null)
  const background=await host.rpc('getBackgroundRuns',{sessionId:'ordinary'})
  assert.equal(background.catalog.some(row=>row.task==='stage-director'),false)
  await assert.rejects(host.rpc('getStageDirection',{sessionId:'ordinary'}),/未知方法/)
  console.log('core without stage completed')
} finally {await host.dispose()}
