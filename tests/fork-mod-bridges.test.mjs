import { executionFixture } from './helpers/managed-execution-fixture.mjs'
import test from 'node:test'



import assert from 'node:assert/strict'
import {createFirstPartyMods,modResources,readModRelease} from './fixtures/mods/core-mod-v2.mjs'
import {createBuiltinModService,MOD_MANAGEMENT_METHODS} from '../tavern-plugin/packages/dsh-tavern-stage/lib/mod-service.js'
import {widgetChatFixture} from './fixtures/widget-variable-chat.mjs'
const {manifest,files}=await readModRelease(new URL('./fixtures/mods/demo/',import.meta.url))


test('production first-party service mounts management and revokes authority',async t=>{
  const h=await widgetChatFixture(t),stock=await createFirstPartyMods(),own=stock.manifest('dsh.demo'),calls={prepare:0,command:0},errors=[]
  let pause,started,release
  const builtin=modResources([{manifest:own,files:stock.files(own.id),module:{
    async prepare(){calls.prepare++;if(pause){started();await pause}return {sections:[]}},
    command(){calls.command++;return []},dispose(){}
  }}])
  const native=executionFixture(t,{builtins:{...builtin,catalogue:()=>stock.catalogue().filter(row=>row.id===own.id)}})
  const workbenchAuthority=Object.freeze({})
  const service=createBuiltinModService({workbenchAuthority,management:native.management,builtins:native.builtins,readCard:async()=>({meta:{id:'card-a'}}),variables:h.config,onError:error=>errors.push(error)})
  t.after(()=>service.dispose())
  assert.ok(!MOD_MANAGEMENT_METHODS.some(method=>/Import|export/.test(method)))
  assert.throws(()=>service.call('listMods',{},{}),{code:'MOD_PERMISSION_DENIED'})
  const authority={origin:'https://offline.test'},chat=await h.db.read('fixture'),target={sourceKey:'source-a',branchId:chat.timeline.branchId}
  let list=await service.call('listMods',{},authority)
  assert.equal(list.mods.length,1);assert.equal(list.mods[0].scope,'off')
  assert.deepEqual(await service.call('listMods',{},workbenchAuthority),list)
  assert.equal((await service.call('getMod',{modId:own.id},workbenchAuthority)).manifest.id,own.id)
  // disabled mods still publish installed grammar for the stable tool cache, never active commands.
  const disabled=await service.prepare(chat,1,{target})
  assert.deepEqual(disabled.commands,[]);assert.ok(disabled.schemaCommands.length);assert.deepEqual(disabled.fragments,[]);assert.equal(calls.prepare,0)
  assert.equal(await service.enabled(chat.cardPath),false)
  assert.deepEqual(disabled.enabledAssetKinds,[])
  await native.setEnabled(own.id,true)
  assert.equal(await service.enabled(chat.cardPath),true)
  assert.equal((await service.call('listMods',{},authority)).mods.some(row=>row.id==='dsh.performance' && row.effectiveEnabled),false)
  const preview=await service.prepare(chat,1,{target,preview:true});assert.equal(calls.prepare,0);assert.equal(preview.commands[0].op,own.commands[0].op)
  const prepared=await service.prepare(chat,1,{target});assert.equal(calls.prepare,1);assert.deepEqual((await service.prepare(chat,1,{target,preview:true})).fragments,prepared.fragments)
  assert.equal((await service.command(prepared,{modId:own.id,commandId:'mark',params:{label:'Live'}})).ok,true);assert.equal(calls.command,1)
  pause=new Promise(resolve=>{release=resolve});const waiting=new Promise(resolve=>{started=resolve})
  const pending=service.prepare(chat,1,{target})
  await waiting
  await native.setEnabled(own.id,false)
  release()
  // A mod switched off mid-round takes effect from the next round (stage-state.md): the round in flight
  // finishes on the runtime it prepared with, even after the service has opened the new library.
  const inFlight=await pending
  assert.equal(inFlight.commands[0].modId,own.id)
  const revoked=await service.prepare(chat,1,{target})
  assert.deepEqual(revoked.commands,[]);assert.deepEqual(revoked.fragments,[]);assert.deepEqual(revoked.schemaCommands,disabled.schemaCommands)
  assert.equal((await service.command(inFlight,{modId:own.id,commandId:'mark',params:{label:'Late'}})).ok,true);assert.equal(calls.command,2)
  assert.deepEqual(errors,[])
})

// bug:mod-runtime-disposed: the director's final preparation read the card while a reply-time write (the
// automatic pack bound to the card, a settings save) invalidated the service, then ran on the disposed runtime.
test('a library change while the director prepares leaves that round on the runtime it started with',async t=>{
  const h=await widgetChatFixture(t),stock=await createFirstPartyMods(),own=stock.manifest('dsh.demo'),calls={prepare:0,command:0},errors=[]
  const builtin=modResources([{manifest:own,files:stock.files(own.id),module:{prepare(){calls.prepare++;return {sections:[]}},command(){calls.command++;return []},dispose(){}}}])
  const native=executionFixture(t,{builtins:{...builtin,catalogue:()=>stock.catalogue().filter(row=>row.id===own.id)},enabled:[own.id]})
  let gate
  const readCard=async()=>{await gate?.promise;return {meta:{id:'card-a'}}}
  const service=createBuiltinModService({management:native.management,builtins:native.builtins,readCard,variables:h.config,onError:error=>errors.push(error)})
  t.after(()=>service.dispose())
  const chat=await h.db.read('fixture'),target={sourceKey:'source-a',branchId:chat.timeline.branchId}
  await service.prepare(chat,1,{target,preview:true})
  let opened;gate={promise:new Promise(resolve=>{opened=resolve})}
  const pending=service.prepare(chat,1,{target})
  await new Promise(resolve=>setTimeout(resolve,10))
  service.invalidate();gate=null;opened()
  const snapshot=await pending
  assert.equal(calls.prepare,1);assert.equal(snapshot.commands[0].modId,own.id)
  // The next read opens the changed library; the sealed round still commands its own runtime.
  await service.prepare(chat,1,{target,preview:true})
  assert.equal((await service.command(snapshot,{modId:own.id,commandId:'mark',params:{label:'After'}})).ok,true)
  assert.equal(calls.command,1);assert.deepEqual(errors,[])
})
