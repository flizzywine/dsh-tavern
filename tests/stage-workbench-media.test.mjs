import test from 'node:test'
import assert from 'node:assert/strict'
import {writeFile,readFile,mkdir} from 'node:fs/promises'
import {deflateSync,crc32} from 'node:zlib'
import {workbenchFixture} from './fixtures/workbench-features.mjs'
import {createWorkbenchFiles} from '../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/files.js'
import {featureProjection} from '../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/projections.js'
import {validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'
import {writeZip} from '../tavern-plugin/packages/dsh-asset-library/src/zip.js'
function png() {
  const chunk=(name,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b}
  const h=Buffer.alloc(13);h.writeUInt32BE(2);h.writeUInt32BE(2,4);h[8]=8;h[9]=6
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.alloc(18))),chunk('IEND',Buffer.alloc(0))])
}
test('workspace image enters via one atomic bound patch, and archive export is exclusive',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  await writeFile(f.workspace+'/image.png',png())
  const result=await f.invoke('media_upload',{action:'image',packId:f.pack.manifest.id,expectedRevision:f.pack.revision,file:'image.png',target:{kind:'asset',slot:'media',asset:{kind:'backgrounds',id:'room',name:'Room',enabled:true,recall:{mode:'keyword',keywords:['教室','课桌','黑板']},directorNote:''}}})
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.attached,true)
  const pack=await f.library.getPackSnapshot({packId:f.pack.manifest.id})
  assert.equal(pack.manifest.assets[0].media,result.data.hash)
  const before=featureProjection({ok:true,data:{items:await f.library.listPackSummaries(),total:1}})
  const list=await f.invoke('assets_read',{action:'list'})
  assert.deepEqual(list.data.items[0].scope,{global:false,card:true})
  for(const key of ['pictures','description','installedAt','updatedAt'])assert.equal(Object.hasOwn(list.data.items[0],key),false)
  assert.equal((await f.invoke('assets_read',{action:'pack',packId:pack.manifest.id})).data.manifest.assets[0].media,result.data.hash)
  const bindings=await f.invoke('assets_read',{action:'bindings'})
  assert.deepEqual(bindings.data.globalEnabledPackIds,[])
  assert.deepEqual(bindings.data.boundPackIds,[pack.manifest.id])
  const bytes=value=>Buffer.byteLength(JSON.stringify(value))
  t.diagnostic('list result UTF-8 bytes: '+bytes(before)+' -> '+bytes(list))
  assert.ok(bytes(list)<bytes(before))
  const output={action:'export-pack',packs:[{packId:pack.manifest.id,expectedRevision:pack.revision}],output:'pack.zip'}
  assert.equal((await f.invoke('assets_transfer',output)).ok,true)
  assert.ok((await readFile(f.workspace+'/pack.zip')).length>0)
  assert.equal((await f.invoke('assets_transfer',output)).ok,false)
  assert.equal((await f.invoke('media_upload',{action:'blob',packId:pack.manifest.id,expectedRevision:pack.revision,file:'image.png',purpose:'music'})).error.code,'INVALID_INPUT')
})

test('workspace intake rejects escapes, device paths, credentials and oversized mod media',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const files=createWorkbenchFiles(f.workspace)
  for(const name of ['../outside','C:/outside','image.png:stream','NUL','.credentials.yaml','folder/../../outside','folder\\..\\outside'])await assert.rejects(files.read(name),{code:'WORKSPACE_PATH_DENIED'})
  await writeFile(f.workspace+'/large.png',Buffer.alloc(60*1024**2+1))
  f.setApproval('allowed-once')
  assert.equal((await f.invoke('media_upload',{action:'mod-media',modId:'dsh.phone',packId:'pack',kind:'image',slot:'base-1',file:'large.png'})).error.code,'LIMIT_EXCEEDED')
  await mkdir(f.workspace+'/bundle');await writeFile(f.workspace+'/bundle/model.json','{}')
  assert.deepEqual([...await files.directory('bundle')].map(([key])=>key),['model.json'])
})

test('exported card ZIP inspects losslessly; missing target and malformed members stay actionable JSON',async t=>{
  const f=await workbenchFixture();t.after(()=>f.close())
  const path=f.chat.cardPath,card=await f.cardTransactions.snapshot({path})
  assert.equal((await f.invoke('assets_transfer',{action:'export-card',path,expectedRevision:card.revision,packIds:[f.pack.manifest.id],output:'card.zip'})).ok,true)
  f.chat.cardPath=undefined
  const missing=await f.invoke('assets_transfer',{action:'inspect',kind:'card',file:'card.zip'})
  assert.equal(missing.error.code,'SOURCE_UNAVAILABLE')
  assert.equal(missing.error.path,'$.path')
  assert.match(missing.error.next,/Supply path/)
  const inspected=await f.invoke('assets_transfer',{action:'inspect',kind:'card',file:'card.zip',path})
  assert.equal(inspected.ok,true,JSON.stringify(inspected))
  assert.equal(inspected.data.packs[0].packId,f.pack.manifest.id)
  assert.equal(Object.hasOwn(inspected.data.packs[0],'incoming'),false)
  assert.equal(Object.hasOwn(inspected.data.packs[0],'current'),false)
  assert.ok(inspected.data.packs[0].choices.includes('noop'))
  const absent=await f.invoke('assets_transfer',{action:'inspect',kind:'card',file:'absent.zip',path})
  for(const value of [missing,inspected,absent]) {
    assert.deepEqual(validateJsonSchemaValue({},value),[])
    assert.deepEqual(JSON.parse(JSON.stringify(value)),value)
  }
  await writeZip(f.workspace+'/bad.zip',[{path:'dsh-tavern-card-bundle.json',data:Buffer.from('{"format":"dsh-tavern-card-bundle"}')}])
  const bad=await f.invoke('assets_transfer',{action:'inspect',kind:'card',file:'bad.zip',path})
  assert.equal(bad.error.code,'INVALID_JSON')
  assert.equal(bad.error.path,'dsh-tavern-card-bundle.json:$.schemaVersion')
  assert.match(bad.error.message,/Missing field schemaVersion/)
  assert.deepEqual(validateJsonSchemaValue({},bad),[])
})
test('bundle upload forwards every library bundle kind without a second kind list',async()=>{
  const {BUNDLE_KINDS,validatePackManifest}=await import('../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js')
  const {requestFor}=await import('./fixtures/workbench-features.mjs')
  const {runWorkbenchAction}=await import('../tavern-plugin/packages/dsh-tavern-stage/lib/workbench/actions.js')
  const f=await workbenchFixture()
  try {
    for(const kind of BUNDLE_KINDS) {
      const input={action:'bundle',packId:f.pack.manifest.id,expectedRevision:f.pack.revision,directory:'bundle',bundleKey:'sample',kind,entry:'entry.json'}
      requestFor('media_upload',input)
      const manifest=structuredClone(f.pack.manifest)
      manifest.bundles.sample={kind,entry:'entry.json',contentHash:'a'.repeat(64)}
      manifest.files.push({path:'bundles/sample/entry.json',sha256:'a'.repeat(64),size:2})
      validatePackManifest(manifest)
      let received
      const files=new Map([['entry.json',Buffer.from('{}')]])
      await runWorkbenchAction('media_upload',{input,snapshot:async()=>f.pack,files:{directory:async path=>{assert.equal(path,'bundle');return files}},library:{putBundle:async args=>{received=args;return {snapshot:f.pack}}}})
      assert.deepEqual(received,{packId:input.packId,expectedRevision:input.expectedRevision,bundleKey:'sample',descriptor:{kind,entry:'entry.json'},files})
    }
  } finally {await f.close()}
})
