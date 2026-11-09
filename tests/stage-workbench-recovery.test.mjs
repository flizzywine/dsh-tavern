import test from 'node:test'
import assert from 'node:assert/strict'
import {validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {workbenchFixture} from './fixtures/workbench-features.mjs'

const json=value=>assert.deepEqual(validateJsonSchemaValue({},value),[])

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