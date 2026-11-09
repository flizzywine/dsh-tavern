import test from 'node:test'
import assert from 'node:assert/strict'
import {join} from 'node:path'
import {fixture} from './helpers/mod-system-production-host.mjs'
import {firstPartyDistributions} from '../tavern-plugin/lib/mod-system-distributions.js'
import {createBuiltinModService} from '../tavern-plugin/packages/dsh-tavern-stage/lib/mod-service.js'

test('startup reads installed mod releases without scanning cards except to reconcile locks',async t=>{
  let scans=0
  const {production,root}=await fixture(t,{listPaths:async()=>{scans++;return ['card.json']}})
  await production.ready
  assert.equal(scans,0)
  await production.installBuiltins()

  scans=0
  await production.installBuiltins()
  assert.equal(scans,0,'matching releases do not require card locks on startup')
  const selected=await production.selection()
  assert.ok(selected.manifests.some(row=>row.id==='dsh.phone'))
  const manifest={id:'dsh.phone'},pack={id:'test-pack'},published=[]
  const service=createBuiltinModService({root:join(root,'media'),management:production,builtins:{
    catalogue:()=>[manifest],manifest:()=>manifest,assetPacks:()=>[pack]
  }})
  t.after(()=>service.dispose())
  assert.deepEqual(await service.manifests(),[manifest])
  await service.installBuiltinAssets({ensureBuiltinPack:async value=>published.push(value)})
  assert.deepEqual(published,[pack])
  assert.equal(scans,0)
})

// A rebuilt built-in (same version, new bytes) is the current code: cards that switched it on keep using it instead of
// showing 版本不符 for the digest they locked at the time.
test('a rebuilt built-in release keeps card locks current instead of reporting a version mismatch',async t=>{
  const first=await fixture(t);await first.production.installBuiltins()
  const listed=await first.rpc('managedModsList',{cardId:'native-card-id'})
  const plan=await first.rpc('managedModSwitchPlan',{scope:'card',kind:'mod',id:'dsh.phone',value:'on',cardId:'native-card-id',revision:listed.revision})
  await first.rpc('managedModApply',{token:plan.token,revision:plan.revision,answers:{}})
  const rebuilt='f'.repeat(64)
  const next=await fixture(t,{root:first.root,distributions:async()=>(await firstPartyDistributions()).map(row=>row.manifest.id==='dsh.phone'?{...row,sha256:rebuilt}:row)})
  await next.production.installBuiltins()
  const phone=(await next.rpc('managedModsList',{cardId:'native-card-id'})).mods.find(row=>row.id==='dsh.phone')
  assert.equal(phone.status,'ready')
  assert.deepEqual(phone.retainedByCards,['native-card-id'])
})
