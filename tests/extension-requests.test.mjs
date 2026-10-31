import test from 'node:test'
import assert from 'node:assert/strict'
import {createExtensionRequests} from '../tavern-plugin/lib/domain/extension-requests.js'

test('request owners register and remove routes and remote-read admission together',async()=>{
  const registry=createExtensionRequests({reserved:['core']})
  assert.equal(registry.handles('stage'),false)
  let received
  const provider={methods:['stage'],remoteRead:()=>true,call:async(...args)=>{received=args;return 'ok'}}
  const off=registry.register('stage',provider)
  assert.equal(registry.remoteRead('stage'),true)
  const authority={origin:'trusted'}
  assert.equal(await registry.call('stage',{value:1},authority,true),'ok')
  assert.deepEqual(received,['stage',{value:1},authority,true])
  off();off();assert.equal(registry.handles('stage'),false);assert.equal(registry.remoteRead('stage'),false)
  const next=registry.register('stage',provider);off();assert.equal(registry.handles('stage'),true);next()
})

test('invalid registration cannot overwrite core or existing routes or leave partial routes',()=>{
  const registry=createExtensionRequests({reserved:['core']})
  registry.register('first',{methods:['existing'],call(){}})
  for(const method of ['core','existing','gameplay.edit']) {
    assert.throws(()=>registry.register('bad',{methods:['partial',method],call(){}}),/occupied/)
    assert.equal(registry.handles('partial'),false)
  }
})

test('removed requests cannot deliver late results into a replacement owner',async()=>{
  let resolve;const gate=new Promise(done=>resolve=done),registry=createExtensionRequests()
  const off=registry.register('stage',{methods:['read'],call:()=>gate})
  const pending=registry.call('read');off()
  registry.register('stage',{methods:['read'],call:async()=> 'new'})
  resolve('old');await assert.rejects(pending,{code:'EXTENSION_UNAVAILABLE'})
  assert.equal(await registry.call('read'),'new')
})
