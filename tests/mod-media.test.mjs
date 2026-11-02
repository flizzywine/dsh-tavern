import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {installedFixture} from './helpers/mod-system-production-host.mjs'
import {createBuiltinModService} from '../tavern-plugin/packages/dsh-tavern-stage/lib/mod-service.js'
import {createManagedModPackOwner} from '../tavern-plugin/packages/dsh-tavern-stage/lib/mod-pack-owner.js'
import {validateModMedia,MOD_MEDIA_LIMITS} from '../tavern-plugin/lib/mod-media.js'
import {createModRuntime} from '../tavern-plugin/lib/domain/mods/runtime.js'
import {modSettingValue,validateModSettingsSchema} from '../tavern-plugin/lib/domain/mods/settings.js'
import {validateModPackAssetRefs} from '../tavern-plugin/lib/domain/mods/asset-references.js'
import sharp from 'sharp'

test('production mod packs expose the CAS save required to reference uploaded media', async t => {
  const f = await installedFixture(t)
  const service = createBuiltinModService({
    root:path.join(f.root, 'managed-mod-media'), management:f.production,
    readCard:f.readWorkspace, variables:{},
  })
  t.after(() => service.dispose())
  const authority = {origin:'https://offline.test'}
  const before = await service.call('getMod', {modId:'dsh.phone'}, authority)
  const pack = {
    format:'dsh-mod-pack', schemaVersion:1,
    id:'35f08180-af5f-43c6-b09c-635567e5c4c4', modId:'dsh.phone',
    requiresModVersion:'>=' + before.manifest.version + ' <' + (Number(before.manifest.version.split('.')[0])+1) + '.0.0',
    name:'Test media', fields:{}, entries:[], files:[],
  }
  const result = await service.call('saveModPack', {
    modId:'dsh.phone', pack, expectedRevision:before.revision,
  }, authority)
  assert.equal(result.pack.id,pack.id)
  const after=await service.call('getMod',{modId:'dsh.phone'},authority)
  assert.ok(after.packs.some(row=>row.id===pack.id))
  await assert.rejects(service.call('saveModPack',{modId:'dsh.phone',pack,expectedRevision:before.revision},authority),{code:'MOD_REVISION_CONFLICT'})
  const reopened=createBuiltinModService({root:path.join(f.root,'managed-mod-media'),management:f.production,readCard:f.readWorkspace,variables:{}})
  t.after(()=>reopened.dispose())
  assert.ok((await reopened.call('getMod',{modId:'dsh.phone'},authority)).packs.some(row=>row.id===pack.id))
})

test('purpose limits preserve small icons and allow image, background and audio budgets',async()=>{
  assert.deepEqual(MOD_MEDIA_LIMITS,{icon:512*1024,image:6*1024**2,background:4*1024**2,audio:60*1024**2})
  const bytes=await sharp({create:{width:1024,height:576,channels:3,background:'#447799'}}).png().toBuffer()
  assert.throws(()=>validateModMedia({mime:'image/png',bytes,purpose:'icon'}),{code:'LIMIT_EXCEEDED'})
  assert.doesNotThrow(()=>validateModMedia({mime:'image/png',bytes,purpose:'background'}))
  const square=await sharp({create:{width:600,height:600,channels:3,background:'#447799'}}).png().toBuffer()
  assert.throws(()=>validateModMedia({mime:'image/png',bytes:square,purpose:'background'}),/16:9/)
  for(const purpose of ['image','background','audio'])assert.throws(()=>validateModMedia({mime:purpose==='audio'?'audio/mpeg':'image/png',bytes:Buffer.alloc(MOD_MEDIA_LIMITS[purpose]+1),purpose}),{code:'LIMIT_EXCEEDED'})
})

test('authored mod packs persist through one CAS owner that rejects stale writers',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'mod-packs-'))
  t.after(()=>fs.rm(root,{recursive:true,force:true}))
  const owner=createManagedModPackOwner({root}),changes=[]
  owner.subscribe(()=>changes.push('changed'))
  assert.deepEqual(await owner.read(),{revision:'0',packs:{}})
  const first=await owner.compareAndSwap({expectedRevision:'0',modId:'example.mod',pack:{id:'p1',name:'One'}})
  await assert.rejects(owner.compareAndSwap({expectedRevision:'0',modId:'example.mod',pack:{id:'p2',name:'Two'}}),{code:'MOD_REVISION_CONFLICT'})
  await owner.compareAndSwap({expectedRevision:first.revision,modId:'example.mod',pack:{id:'p2',name:'Two'}})
  assert.deepEqual(Object.keys((await createManagedModPackOwner({root}).read()).packs['example.mod']),['p1','p2'])
  assert.deepEqual(changes,['changed','changed'])
})

test('a failing mod callback names the mod and the step; optional lifecycle hooks may be absent',async()=>{
  const seen=[]
  const runtime=createModRuntime({current:()=>true,createHost:()=>({}),onError:row=>seen.push(row),
    builtins:{module:()=>({command(){throw new Error('bad input')}})}})
  const failed=await runtime.invoke({modId:'example.mod'},'command',{})
  assert.equal(failed.ok,false)
  assert.equal(failed.error.code,'MOD_RUNTIME_FAILED')
  assert.equal(failed.error.modId,'example.mod')
  assert.equal(failed.error.operation,'command')
  assert.equal(failed.error.message,'example.mod command: bad input')
  assert.deepEqual(seen.map(row=>[row.modId,row.operation,row.message]),[['example.mod','command','bad input']])
  assert.deepEqual(await runtime.invoke({modId:'example.mod'},'settled',{}),{ok:true,value:null})
})

test('asset-ref fields hold one main-library background, and object children may be optional',async()=>{
  const field={key:'scene',type:'asset-ref',label:'Scene',default:null,target:{kinds:['backgrounds']}}
  const record={key:'row',type:'object',label:'Row',default:{},fields:[{...field,optional:true}]}
  assert.doesNotThrow(()=>validateModSettingsSchema({fields:[record]},'$.packSchema',false,'example.mod'))
  assert.throws(()=>validateModSettingsSchema({fields:[{...field,target:{kinds:['sfx']}}]},'$.packSchema',false,'example.mod'))
  const ref={packId:'35f08180-af5f-43c6-b09c-635567e5c4c4',kind:'backgrounds',assetId:'classroom'}
  assert.equal(modSettingValue(field,ref,'example.mod'),true)
  assert.equal(modSettingValue(field,{...ref,kind:'sfx'},'example.mod'),false)
  assert.equal(modSettingValue(record,{},'example.mod'),true)
  assert.equal(modSettingValue(record,{scene:ref},'example.mod'),true)
  const manifest={packSchema:{fields:[field]},assetKinds:[]},pack={fields:{scene:ref},entries:[]}
  await validateModPackAssetRefs(pack,manifest,async({refs})=>refs.map(row=>({ref:row,value:{id:row.assetId}})))
  await assert.rejects(validateModPackAssetRefs(pack,manifest,async({refs})=>refs.map(row=>({ref:row,value:null}))),{code:'MOD_RESOURCE_UNAVAILABLE'})
})
