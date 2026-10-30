import test from 'node:test'
import assert from 'node:assert/strict'
import {createCardPreparation,rawData} from '../tavern-plugin/lib/domain/card-preparation.js'
import {createManagedModCardOwner,planCardModChoices} from '../tavern-plugin/lib/domain/mod-system-choices.js'
import {createManagedModSettingsOwner,MANAGED_MOD_SETTINGS_SECTION} from '../tavern-plugin/lib/mod-system-settings.js'
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

test('portable card choices use Card Preparation raw boundary, retain foreign fields, and never write on reads',async()=>{
  for(const wrapped of [false,true]) {
    const f=fixture(wrapped),[before]=await f.owner.list(),read=await f.owner.read({cardId:'card-a'}),next=emptyCardMods()
    assert.equal(f.writes,0);assert.deepEqual(before.value,read.value)
    next.mods['example.clock']='off';next.packs['pack-a']='on';next.config['example.clock']={version:1,values:{seconds:{auto:true}}}
    const saved=await f.owner.compareAndSwap({cardId:'card-a',expectedRevision:read.revision,expectedValue:read.value,value:next})
    assert.notEqual(saved.revision,read.revision);assert.equal(f.writes,1)
    const raw=rawData(f.workspace.raw)
    assert.equal(raw.description,'Keep this story');assert.deepEqual(raw.extensions.other,{retained:true});assert.deepEqual(raw.extensions.dsh_tavern.modSystem,next)
    const unchanged=await f.owner.compareAndSwap({cardId:'card-a',expectedRevision:saved.revision,expectedValue:saved.value,value:next})
    assert.equal(unchanged.revision,saved.revision);assert.equal(f.writes,1)
    saved.value.mods['example.clock']='on';assert.equal((await f.owner.read({cardId:'card-a'})).value.mods['example.clock'],'off')
    await assert.rejects(f.owner.compareAndSwap({cardId:'card-a',expectedRevision:read.revision,expectedValue:read.value,value:next}),{code:'MOD_REVISION_CONFLICT'})
    assert.equal(f.writes,1)
  }
})

test('concurrent card edits serialize through the original card owner and only one CAS publishes',async()=>{
  const f=fixture(),[before]=await f.owner.list(),on=emptyCardMods(),off=emptyCardMods()
  on.mods['example.clock']='on';off.mods['example.clock']='off'
  const results=await Promise.allSettled([on,off].map(value=>f.owner.compareAndSwap({cardId:'card-a',expectedRevision:before.revision,expectedValue:before.value,value})))
  assert.deepEqual(results.map(row=>row.status),['fulfilled','rejected']);assert.equal(results[1].reason.code,'MOD_REVISION_CONFLICT');assert.equal(f.writes,1)
})

test('raw card import and editor paths reject preference injection into portable mod choices',()=>{
  const f=fixture(),card={...emptyCardMods(),preferences:{'example.clock':{volume:0}}}
  assert.throws(()=>f.preparation.create({kind:'import',payload:{name:'Invalid',extensions:{dsh_tavern:{modSystem:card}}}}),{code:'MOD_INVALID'})
  assert.throws(()=>f.preparation.update({kind:'card',card:f.workspace,patch:{},rawOperations:[{op:'set',path:'/data/extensions/dsh_tavern/modSystem',value:card}]}),{code:'MOD_INVALID'})
  assert.equal(rawData(f.workspace.raw).extensions.dsh_tavern,undefined)
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

test('native SettingsForms preserves legacy fields and persists managed defaults with revision CAS',async t=>{
  const {nativeSettingsProfile}=await import('./fixtures/native-settings-profile.mjs')
  const settingsUrl=new URL('../tavern-plugin/lib/mod-system-settings.js',import.meta.url).href
  const configUrl=new URL('../tavern-plugin/lib/settings-config.js',import.meta.url).href
  const h=await nativeSettingsProfile(t,{ownerSource:`export {Config} from ${JSON.stringify(configUrl)};
import {createManagedModSettingsOwner} from ${JSON.stringify(settingsUrl)};
export function apply(ctx){ctx.provide('managedFixtureOwner',createManagedModSettingsOwner(ctx));}`})
  const owner=h.ctx.get('managedFixtureOwner'),initial=owner.read()
  assert.equal(typeof initial.revision,'number')
  assert.deepEqual(initial.value,emptyGlobalMods())
  const legacy={global:{enabledModIds:['dsh.phone'],mods:{}},grants:{}}
  await h.update(h.ownerId,legacy,'tavern-mods')
  const before=owner.read()
  assert.deepEqual(before.value,initial.value,'legacy fields do not alter managed choices')
  const value=structuredClone(before.value);value.mods['dsh.phone']=true
  const saved=await owner.compareAndSwap({expectedRevision:before.revision,expectedValue:before.value,value})
  assert.notEqual(saved.revision,before.revision)
  assert.equal(saved.value.mods['dsh.phone'],true)
  assert.deepEqual(h.value(h.ownerId,'tavern-mods'),legacy)
  assert.equal(h.value(h.ownerId,MANAGED_MOD_SETTINGS_SECTION).mods['dsh.phone'],true)
  assert.ok(JSON.stringify(await h.overrides()).includes('dsh.phone'))
  await assert.rejects(owner.compareAndSwap({expectedRevision:before.revision,expectedValue:before.value,value}),{code:'MOD_REVISION_CONFLICT'})
})

test('global choices and preferences use the native settings revision, change notifications and disposal',async()=>{
  let value,handlers,revision=0,dispose,writes=0,notifications=0
  const provider={writable:true,describe:()=>[{ns:MANAGED_MOD_SETTINGS_SECTION,revision:String(revision)}],
    installSection(ctx,ns,schema,defaults,callback){assert.equal(ns,MANAGED_MOD_SETTINGS_SECTION);value=structuredClone(defaults);handlers=callback;handlers.setSource(()=>value)},
    async replace(ns,next,expected){assert.equal(ns,MANAGED_MOD_SETTINGS_SECTION);assert.equal(expected,String(revision));value=structuredClone(handlers.validate(next));revision++;writes++;handlers.onChange()}}
  const ctx={get:()=>provider,inject(deps,fn){fn(ctx)},effect(fn){dispose=fn()}}
  const owner=createManagedModSettingsOwner(ctx),before=owner.read(),next=emptyGlobalMods()
  owner.subscribe(()=>notifications++)
  assert.deepEqual(before.value.mods,{});assert.equal(writes,0)
  next.mods['example.clock']=true;next.preferences['example.clock']={volume:0}
  const saved=await owner.compareAndSwap({expectedRevision:before.revision,expectedValue:before.value,value:next})
  assert.equal(saved.revision,'1');assert.equal(writes,1);assert.equal(notifications,1)
  saved.value.preferences['example.clock'].volume=100;assert.equal(owner.read().value.preferences['example.clock'].volume,0)
  await assert.rejects(owner.compareAndSwap({expectedRevision:before.revision,expectedValue:before.value,value:next}),{code:'MOD_REVISION_CONFLICT'})
  dispose();assert.throws(()=>owner.read(),{code:'MOD_DISABLED'})
})
