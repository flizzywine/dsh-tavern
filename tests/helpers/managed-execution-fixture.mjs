import assert from 'node:assert/strict'
import {createManagedModHost} from '../../tavern-plugin/lib/domain/mod-system-host.js'
import {emptyGlobalMods,emptyCardMods} from '../../tavern-plugin/lib/domain/mod-system-contract.js'
import {managedExecutionView} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/mod-system-execution.js'
import {MOD_MANAGEMENT_METHODS} from '../../tavern-plugin/packages/dsh-tavern-stage/lib/mod-service.js'

// Runtime doubles use managed installation/choice owners, not a legacy settings store.
// performances: {[modId]: manifest.performances} for doubles that place stage performances (required declarations).
// manifests: {[modId]: mod.json} for doubles that need a release's real config (its settings), else a bare release.
export function executionFixture(t,{builtins,enabled=[],cardId='card-a',performances={},manifests={}}) {
  const ids=builtins.catalogue().map(row=>row.id),modHost=createManagedModHost({authorized:ids}),listeners=new Set()
  let revision=0,value=emptyGlobalMods()
  value.mods=Object.fromEntries(enabled.map(id=>[id,true]))
  const releases=ids.map(id=>{
    const manifest=manifests[id] || {format:'dsh-tavern-mod',schemaVersion:5,performances:performances[id] || [],id,name:id,packageName:id.replaceAll('.','-'),version:'1.0.0',hostApi:'>=1.0.0 <2.0.0',dependencies:[],config:{version:1,schema:{type:'object',properties:{},additionalProperties:false},defaults:{}},preferences:{schema:{type:'object',properties:{},additionalProperties:false},defaults:{}},dataVersion:1,coreAssets:[],permissions:[],entry:'plugin.mjs'}
    modHost.register(manifest.packageName,manifest,{execution:builtins.module(id)})
    return {manifest,digest:id+'-release',active:true,installed:true,authorized:true}
  })
  t.after(()=>modHost.dispose())
  const settings={read:()=>({revision:String(revision),value:structuredClone(value)}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    async compareAndSwap(input){assert.equal(input.expectedRevision,String(revision));assert.deepEqual(input.expectedValue,value);value=structuredClone(input.value);revision++;for(const fn of listeners)fn();return settings.read()}}
  const management={ready:Promise.resolve(),modHost,settings,installations:{read:async()=>({revision:'installed',value:{releases:structuredClone(releases)}})},cards:{list:async()=>[{cardId,revision:'card-1',value:emptyCardMods()}]}}
  const setEnabled=async(id,on)=>{const current=settings.read(),next=structuredClone(current.value);next.mods[id]=on;await settings.compareAndSwap({expectedRevision:current.revision,expectedValue:current.value,value:next})}
  return {management,builtins:{...builtins,module:id=>modHost.execution(id)},setEnabled}
}

// The production director library (managedExecutionView) over the fixture's managed owners. Production
// rebuilds the view after every owner change (mod-service invalidate); library always reads the current one.
export async function executionLibrary(t,options) {
  const native=executionFixture(t,options),open=()=>managedExecutionView({management:native.management,builtins:native.builtins})
  let view=await open()
  const library=new Proxy({},{get:(_,key)=>key==='saveModSettings'?async input=>{const result=await view.saveModSettings(input);view=await open();return result}:view[key]})
  // api: the mod management RPCs the production service serves (mod-service.js call), for client tests.
  const api=Object.fromEntries(MOD_MANAGEMENT_METHODS.map(method=>[method,async args=>structuredClone(await library[method](structuredClone(args)))]))
  return {...native,library,api,async setEnabled(id,on){await native.setEnabled(id,on);view=await open()}}
}
