import test from 'node:test'
import assert from 'node:assert/strict'
import { createCardPreparation } from '../tavern-plugin/lib/domain/card-preparation.js'
import {createManagedModCardOwner,planCardModChoices} from '../tavern-plugin/lib/domain/mod-system-choices.js'
import {emptyCardMods,emptyGlobalMods} from '../tavern-plugin/lib/domain/mod-system-contract.js'

function fixture(wrapped=true) {
  const preparation=createCardPreparation({id:()=> 'card-a',now:()=>1})
  const data={name:'Different display name',description:'Keep this story',extensions:{other:{retained:true}}}
  let workspace=preparation.create({kind:'import',payload:wrapped?{spec:'chara_card_v2',spec_version:'2.0',data}:data}),writes=0,tail=Promise.resolve()
  const owner=createManagedModCardOwner({cardPreparation:preparation,listPaths:async()=>['cards/a.json'],readWorkspace:async()=>structuredClone(workspace),
    writeWorkspace:async(path,next)=>{assert.equal(path,'cards/a.json');workspace=structuredClone(next);writes++},
    withCardLock(id,fn){assert.equal(id,'card-a');const task=tail.then(fn);tail=task.catch(()=>{});return task}})
  return {owner,preparation,get workspace(){return workspace},get writes(){return writes}}
}

test('concurrent card edits serialize through the original card owner and only one CAS publishes',async()=>{
  const f=fixture(),[before]=await f.owner.list(),on=emptyCardMods(),off=emptyCardMods()
  on.mods['example.clock']='on';off.mods['example.clock']='off'
  const results=await Promise.allSettled([on,off].map(value=>f.owner.compareAndSwap({cardId:'card-a',expectedRevision:before.revision,expectedValue:before.value,value})))
  assert.deepEqual(results.map(row=>row.status),['fulfilled','rejected']);assert.equal(results[1].reason.code,'MOD_REVISION_CONFLICT');assert.equal(f.writes,1)
})

function manifests() {
  const base={version:'1.0.0',hostApi:'^1.0.0',dependencies:[]}
  return [{...base,id:'example.show',packageName:'example-show',dependencies:[{id:'example.clock',range:'^1.0.0'},{id:'example.sound',range:'^1.0.0',optional:true}]},
    {...base,id:'example.clock',packageName:'example-clock'},{...base,id:'example.sound',packageName:'example-sound'}]
}

test('card enable closes required dependencies; explicit card-off asks and remains off when declined',()=>{
  const card=emptyCardMods(),global=emptyGlobalMods();card.mods['example.show']='on'
  const automatic=planCardModChoices({card,global,manifests:manifests()})
  assert.equal(automatic.card.mods['example.clock'],'on');assert.equal(automatic.card.mods['example.sound'],undefined)
  assert.equal(card.mods['example.clock'],undefined)
  assert.deepEqual(automatic.resolution.enabled,[])
  const approved=planCardModChoices({card,global,manifests:manifests(),authorized:['example.show','example.clock']})
  assert.deepEqual(approved.resolution.enabled,['example.clock','example.show'])
  card.mods['example.clock']='off';global.mods['example.clock']=true
  const declined=planCardModChoices({card,global,manifests:manifests()})
  assert.equal(declined.card.mods['example.clock'],'off');assert.equal(declined.resolution.confirmations[0].dependency,'example.clock')
  assert.equal(declined.resolution.notices[0].onMissing,'notify')
  const confirmed=planCardModChoices({card,global,manifests:manifests(),enableDependencies:['example.clock']})
  assert.equal(confirmed.card.mods['example.clock'],'on');assert.deepEqual(confirmed.resolution.confirmations,[])
  assert.throws(()=>planCardModChoices({card,global,manifests:manifests(),enableDependencies:['example.sound']}),{code:'MOD_INVALID'})
})

// Copied card files can share an identity: listing keeps the first and leaves the copy out,
// instead of refusing the whole list (which kept Tavern from starting).
test('card owners list a duplicated card identity once, keeping the first file', async () => {
  const { createManagedModCardOwner } = await import('../tavern-plugin/lib/domain/mod-system-choices.js')
  const { createModCardOwner } = await import('../tavern-plugin/lib/mod-owners.js')
  const files = { 'cards/a.json': 'same-id', 'cards/a-copy.json': 'same-id', 'cards/b.json': 'other-id' }
  const deps = { listPaths: async () => Object.keys(files), readWorkspace: async path => ({ meta: { id: files[path], updatedAt: 1 }, raw: { data: {} } }) }
  const warn = console.warn; console.warn = () => {}
  try {
    for (const owner of [createManagedModCardOwner(deps), createModCardOwner(deps)]) {
      assert.deepEqual((await owner.list()).map(row => row.cardId), ['same-id', 'other-id'])
    }
  } finally { console.warn = warn }
})
