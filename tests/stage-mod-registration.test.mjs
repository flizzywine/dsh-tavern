import test from 'node:test'
import assert from 'node:assert/strict'
import {createModPrivateMethods} from '../tavern-plugin/packages/dsh-asset-library/lib/pack-v2/mod-private.js'
import {createModConfigHost} from '../tavern-plugin/packages/dsh-tavern-stage/lib/mod-config-host.js'
const manifest=id=>({id,name:id,settingsSchema:{fields:[]}})
function host(manifests) {return createModConfigHost({manifests,store:{},listCards:async()=>[],readCard:async()=>null})}

test('private validator disposal is idempotent and does not remove a replacement',()=>{
  const validators=new Map(),methods=createModPrivateMethods({validators}),validate=()=>{}
  const old=methods.registerModPrivate({modId:'test.mod',validate})
  const next=methods.registerModPrivate({modId:'test.mod',validate})
  old();old();assert.equal(validators.size,1)
  next();assert.equal(validators.size,0)
})

test('mod config owner releases validators and refuses registration after disposal',()=>{
  const validators=new Map(),packs={apiVersion:2,...createModPrivateMethods({validators})},owner=host([manifest('test.mod')])
  owner.register(packs);owner.register(packs);assert.equal(validators.size,1)
  owner.unregister(packs);assert.equal(validators.size,0)
  owner.register(packs);assert.equal(validators.size,1)
  owner.dispose();owner.dispose();assert.equal(validators.size,0)
  assert.throws(()=>owner.register(packs),{code:'SOURCE_UNAVAILABLE'})
})

test('partially failed mod config registration rolls back its earlier validators',()=>{
  let live=0,calls=0
  const packs={apiVersion:2,registerModPrivate(){if(++calls===2)throw Error('registration failed');live++;return()=>live--}}
  const owner=host([manifest('test.one'),manifest('test.two')])
  assert.throws(()=>owner.register(packs),/registration failed/)
  assert.equal(live,0);owner.dispose();assert.equal(live,0)
})
