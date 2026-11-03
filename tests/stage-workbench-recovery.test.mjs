import test from 'node:test'
import assert from 'node:assert/strict'
import {validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {workbenchFixture} from './fixtures/workbench-features.mjs'
import {featureRequestSchema} from '../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/tools.js'

const json=value=>assert.deepEqual(validateJsonSchemaValue({},value),[])
test('factored validation returns the nearest action and an executable minimal syntax skeleton',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const actions={assets_read:'list',assets_patch:'bind',media_upload:'image',assets_transfer:'export-card',stage_read:'director-preview',stage_patch:'engine',mods_read:'mod',mods_patch:'config',voice_read:'figure',voice_patch:'reading-create',asset_generation:'prepare'}
  for(const [name,action] of Object.entries(actions)) {
    const result=await f.tools.get('tavern_'+name).execute({request:{action,unexpected:true}},f.exec)
    assert.equal(result.error.code,'INVALID_ARGS',name)
    assert.match(result.error.path,/^\$\.request\./,name)
    assert.doesNotMatch(result.error.message,/oneOf/,name)
    assert.deepEqual(validateJsonSchemaValue(featureRequestSchema(name),result.error.example.request),[],name)
    assert.ok(JSON.stringify(result.error.example).includes('"action":"'+action+'"'),name)
    json(result)
  }
  const result=await f.tools.get('tavern_assets_patch').execute({request:{action:'bind',boundPackIds:[]}},f.exec)
  assert.equal(result.error.path,'$.request.expectedRevision')
  assert.equal(result.error.example.request.expectedRevision,'<read revision>')
  assert.equal(result.error.example.request.operation.action,'bind')
  assert.equal(f.calls.length,0)
})

test('owner field errors give the actual request path and schema-guided repair',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const item={kind:'directions',id:'quiet',name:'Quiet direction',enabled:true,recall:{mode:'constant',keywords:[]},directorNote:'',content:'Keep movements small.'}
  const input={action:'item',packId:f.pack.manifest.id,expectedRevision:f.pack.revision,item}
  const bad=await f.invoke('assets_patch',input)
  assert.equal(bad.error.code,'UNKNOWN_FIELD')
  assert.equal(bad.error.path,'$.request.operation.operation.item.content')
  assert.match(bad.error.next,/schema.*directions/)
  const schema=(await f.invoke('assets_read',{action:'schema',kind:'directions'})).data
  assert.ok(schema.fields.includes('text'))
  assert.equal((await f.invoke('assets_patch',{...input,item:schema.example})).ok,true)
  const read=await f.invoke('assets_read',{action:'item',packId:f.pack.manifest.id,kind:'directions',id:'quiet'})
  assert.equal(read.data.items[0].text,schema.example.text)
  json(bad);json(read)
})

test('name requests explain list-then-canonical-ref, and that exact recovery succeeds',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const packId=f.pack.manifest.id
  const bad=await f.invoke('assets_read',{action:'resolve',refs:[{packId,kind:'figures',name:'Canonical figure'}]})
  assert.equal(bad.error.path,'$.request.refs[0].name')
  assert.match(bad.error.next,/figureId:id/)
  const list=await f.invoke('assets_read',{action:'item',packId,kind:'figures'})
  const figure=list.data.items.find(row=>row.name==='Canonical figure')
  assert.notEqual(figure.id,figure.name)
  assert.equal(Object.hasOwn(figure,'outfits'),false)
  const detail=await f.invoke('assets_read',{action:'item',packId,kind:'figures',id:figure.id})
  assert.deepEqual(detail.data.items[0].outfits,[])
  t.diagnostic('figure item-list UTF-8 bytes: '+Buffer.byteLength(JSON.stringify(detail))+' -> '+Buffer.byteLength(JSON.stringify(list)))
  const resolved=await f.invoke('assets_read',{action:'resolve',refs:[{packId,figureId:figure.id}]})
  assert.equal(resolved.ok,true)
  assert.equal(resolved.data.figures[0].value.id,figure.id)
  json(resolved)
})

test('pack scope separates global enablement from card binding and an unattached workbench',async t=>{
  const f=await workbenchFixture({globalPack:true});t.after(()=>f.close())
  const list=await f.invoke('assets_read',{action:'list'})
  assert.deepEqual(list.data.items[0].scope,{global:true,card:true})
  const bindings=await f.invoke('assets_read',{action:'bindings'})
  assert.deepEqual(bindings.data.globalEnabledPackIds,[f.pack.manifest.id])
  assert.deepEqual(bindings.data.boundPackIds,[f.pack.manifest.id])
  f.chat.cardPath=undefined
  const unattached=await f.invoke('assets_read',{action:'list'})
  assert.equal(unattached.data.path,null)
  assert.deepEqual(unattached.data.items[0].scope,{global:true,card:null})
})