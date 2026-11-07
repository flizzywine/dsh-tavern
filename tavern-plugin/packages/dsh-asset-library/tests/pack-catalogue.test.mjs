import {readSmallArchive} from '../../../../tests/fixtures/asset-packs/pack.mjs'
// all remote bytes come from a local HTTP fixture; production remains HTTPS-only.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { createAssetPackService } from '../src/pack-v2/service.js'
import { createAssetPackTransport, PACK_CONTROL_PATH } from '../src/pack-v2/transport.js'
import { sealPack, jsonBytes } from '../src/pack-v2/validation.js'
import { writeZip } from '../src/zip.js'
import { syntheticPack, PACK_ID, FIGURE_ID } from '../../../../tests/fixtures/asset-packs/pack.mjs'
import { parseCatalogue, digest, compareVersions, httpsUrl } from '../src/pack-catalogue/catalogue.js'
import { publicAddress, createPublicNetwork } from '../src/pack-catalogue/network.js'
import { catalogueSettingsModel, createCatalogueSettings } from '../src/pack-catalogue/settings.js'
import { decodeMedia } from '../src/pack-v2/media.js'
import { baseMetadata, mergeMetadata } from '../src/pack-catalogue/merge.js'
// Synthetic directories are retained for the operator's approved safe cleanup walker.
async function fixture(t, options={}) {
  const root=await mkdtemp(path.join(os.tmpdir(),'pack-catalogue-')), resources=new Map(), requests=[]
  const server=http.createServer((req,res)=>{
    requests.push({url:req.url,headers:req.headers})
    const item=resources.get(req.url)
    if(!item) {res.writeHead(404);res.end();return}
    if(typeof item==='function') return item(req,res)
    res.writeHead(200,{'Content-Length':item.length,'ETag':'"fixture-v1"'});res.end(item)
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const network=(url,{signal,headers={}}={})=>new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port:server.address().port,path:new URL(url).pathname,headers,signal},res=>resolve({status:res.statusCode,headers:res.headers,body:res,url}));req.on('error',reject)
  })
  const model=catalogueSettingsModel('https://official.test/catalogue'), values={...model.defaults,sources:[...model.defaults.sources,{url:'https://community.test/community',enabled:true}]}
  let saved=values
  const settings={read:()=>({values:model.expose(saved),revision:digest(JSON.stringify(saved))}),save:async input=>{assert.equal(input.expectedRevision,settings.read().revision);saved=model.fromInput(input,saved);return settings.read()}}
  const service=createAssetPackService({assetRoot:path.join(root,'assets'),catalogueNetwork:network,catalogueSettings:settings,...options})
  t.after(async()=>{await service.dispose();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  async function archive(pack=undefined) {
    pack ||= await syntheticPack()
    const file=path.join(root,crypto.randomUUID()+'.zip')
    await writeZip(file,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data])=>({path,data}))]);return readFile(file)
  }
  function catalogue(bytes,version='1.0.0',patch={}) {
    return {format:'dsh-pack-catalogue',schemaVersion:1,id:'fixture',title:'Fixture',updatedAt:'2026-10-01T00:00:00Z',packs:[{id:PACK_ID,title:'Synthetic',version,size:bytes.length,sha256:digest(bytes),licence:{id:'CC0-1.0'},credits:[],requires:['asset-pack-schema:1'],downloads:[{id:'original',label:'Original',url:'https://packs.test/pack'},{id:'mirror',label:'Mirror',url:'https://mirror.test/mirror'}],...patch}]}
  }
  async function selection(bytes,version='1.0.0',patch={}) {
    resources.set('/pack',bytes);resources.set('/mirror',bytes);resources.set('/catalogue',Buffer.from(JSON.stringify(catalogue(bytes,version,patch))))
    const sourceId=settings.read().values.sources[0].sourceId,c=await service.refreshCatalogue({sourceId})
    return {sourceId,catalogueRevision:c.catalogueRevision,packId:PACK_ID,version,downloadId:'original'}
  }
  return {root,service,resources,requests,archive,catalogue,selection,settings,network}
}
async function wait(service,jobId,states=['ready','failed']) {
  for(let i=0;i<1000;i++) {const j=await service.getPackDownload({jobId});if(states.includes(j.state)) return j;await new Promise(r=>setTimeout(r,10))}
  throw Error('job did not finish')
}
async function start(service,input) {return wait(service,(await service.startPackDownload(input)).jobId)}
async function apply(service,j,decision='install',extra={}) {assert.equal(j.state,'ready',JSON.stringify(j.error));const p=j.inspection;return service.applyImport({inspectionId:p.inspectionId,expectedRevision:p.expectedRevision,decision,...extra})}

test('catalogue v1 parser is bounded, versioned, strict and cannot forge official identity',async t=>{
  const f=await fixture(t),bytes=await f.archive(),c=f.catalogue(bytes)
  assert.equal(parseCatalogue(Buffer.from(JSON.stringify(c))).packs.length,1)
  for(const bad of [{...c,schemaVersion:2},{...c,official:true},{...c,packs:[c.packs[0],c.packs[0]]},{...c,packs:[{...c.packs[0],sha256:'A'.repeat(64)}]},{...c,extensions:{script:'bad'}},{...c,packs:[{...c.packs[0],version:'1.0.0-beta'}]}]) assert.throws(()=>parseCatalogue(Buffer.from(JSON.stringify(bad))))
  assert.throws(()=>parseCatalogue(Buffer.alloc(2*1024**2+1)))
  assert.throws(()=>httpsUrl('http://public.test/'));assert.throws(()=>httpsUrl('https://user:pass@test/'))
  assert.equal(compareVersions('10.0.0','2.9.9'),1)
  const settings=f.settings.read(), official=settings.values.sources[0]
  assert.equal(official.official,true)
  const changed=await f.settings.save({...settings.values,expectedRevision:settings.revision,sources:[{...official,url:'https://evil.test/catalogue',official:true}]})
  assert.equal(changed.values.sources[0].official,false)
})

test('URL and frozen catalogue install use importer; local distribution is not exported',async t=>{
  const f=await fixture(t), bytes=await f.archive(), sel=await f.selection(bytes)
  const job=await start(f.service,{selection:sel})
  assert.equal(job.source.official,true);assert.equal(job.integrity,'sha256');assert.equal(job.receivedBytes,bytes.length)
  const result=await apply(f.service,job)
  assert.equal(result.snapshot.distribution.version,'1.0.0')
  assert.equal(result.snapshot.distribution.archiveSha256,digest(bytes))
  assert.equal((await f.service.getPackDownload({jobId:job.jobId})).state,'completed')
  const exported=await f.service.exportPack({packId:PACK_ID,expectedRevision:result.snapshot.revision})
  const preview=await f.service.inspectImport({bytes:(await readSmallArchive(exported))});assert.equal(preview.incoming.manifest.distribution,undefined)
  const direct=await start(f.service,{url:'https://packs.test/pack'});assert.equal(direct.integrity,'unverified')
  assert.deepEqual(await f.service.controlPackDownload({jobId:direct.jobId,action:'cancel'}).then(j=>j.state),'cancelled')
  assert.equal((await f.service.getPackSnapshot({packId:PACK_ID})).revision,result.snapshot.revision)
})

test('digest, exact size, UUID, ZIP slip and ZIP bomb reject before publication',async t=>{
  const f=await fixture(t), bytes=await f.archive();f.resources.set('/pack',bytes)
  // the user-supplied fingerprint is gone; the catalogue's own sha256 still guards the archive.
  await assert.rejects(f.service.startPackDownload({url:'https://packs.test/pack',expectedSha256:'0'.repeat(64)}),e=>e.code==='UNKNOWN_FIELD'&&e.path==='$.expectedSha256')
  const badHash=await start(f.service,{selection:await f.selection(bytes,'1.0.0',{sha256:'0'.repeat(64)})})
  assert.equal(badHash.error.code,'INTEGRITY_MISMATCH')
  const sel=await f.selection(bytes,'1.0.0',{size:bytes.length+1})
  assert.equal((await start(f.service,{selection:sel})).error.code,'INTEGRITY_MISMATCH')
  const wrongId=await f.selection(bytes,'1.0.0',{id:'33333333-3333-4333-8333-333333333333'})
  wrongId.packId='33333333-3333-4333-8333-333333333333'
  assert.equal((await start(f.service,{selection:wrongId})).error.code,'INTEGRITY_MISMATCH')
  const slip=Buffer.from(bytes); for(let pos=0;(pos=slip.indexOf('manifest.json',pos))!==-1;pos+=13) slip.write('../escape.txt',pos)
  f.resources.set('/slip',slip)
  assert.equal((await start(f.service,{url:'https://packs.test/slip'})).state,'failed')
  const bomb=Buffer.from(bytes), central=bomb.indexOf(Buffer.from('504b0102','hex'));bomb.writeUInt32LE(0x7fffffff,central+24)
  f.resources.set('/bomb',bomb);assert.equal((await start(f.service,{url:'https://packs.test/bomb'})).state,'failed')
  assert.deepEqual(await f.service.listPacks(),[])
})

test('explicit mirror fallback freezes digest; prefix is opt-in and requires trusted hash',async t=>{
  const f=await fixture(t),bytes=await f.archive(),sel=await f.selection(bytes)
  f.resources.delete('/pack')
  assert.equal((await start(f.service,{selection:sel})).state,'failed')
  const next=await start(f.service,{selection:{...sel,downloadId:'mirror'}});await apply(f.service,next)
  const settings=f.settings.read();await f.settings.save({...settings.values,expectedRevision:settings.revision,mirrorPrefix:'https://proxy.test/'})
  await assert.rejects(f.service.startPackDownload({url:'https://packs.test/pack',useMirrorPrefix:true}),e=>e.code==='UNKNOWN_FIELD'&&e.path==='$.useMirrorPrefix')
  f.resources.set('/https://packs.test/pack',bytes)
  const prefixed=await start(f.service,{selection:sel,useMirrorPrefix:true})
  assert.equal(prefixed.downloadUrl,'https://proxy.test/https://packs.test/pack');assert.equal(prefixed.source.official,true)
  f.resources.set('/mirror',Buffer.from('corrupt'))
  assert.equal((await start(f.service,{selection:{...sel,downloadId:'mirror'}})).state,'failed')
})

test('cancel aborts HTTP and frees only its own file; strong ETag resumes with Range',async t=>{
  const f=await fixture(t),bytes=await f.archive();let closed=false
  f.resources.set('/slow',(req,res)=>{
    const offset=Number(/^bytes=(\d+)-$/.exec(req.headers.range || '')?.[1] || 0)
    res.writeHead(offset?206:200,{'ETag':'"stable"','Content-Length':bytes.length-offset,...(offset?{'Content-Range':`bytes ${offset}-${bytes.length-1}/${bytes.length}`}:{})})
    if(offset) return res.end(bytes.subarray(offset))
    res.write(bytes.subarray(0,100));res.on('close',()=>{closed=true})
  })
  const {jobId}=await f.service.startPackDownload({url:'https://packs.test/slow'}) // no user fingerprint
  for(let i=0;i<100 && !(await f.service.getPackDownload({jobId})).receivedBytes;i++) await new Promise(r=>setTimeout(r,10))
  assert.equal((await f.service.controlPackDownload({jobId,action:'pause'})).state,'paused')
  await f.service.controlPackDownload({jobId,action:'resume'});const ready=await wait(f.service,jobId)
  assert.equal(ready.state,'ready',JSON.stringify(ready.error));assert.equal(f.requests.at(-1).headers.range,'bytes=100-');assert.equal(f.requests.at(-1).headers['if-range'],'"stable"')
  await f.service.controlPackDownload({jobId,action:'cancel'})
  const cancelled=(await f.service.startPackDownload({url:'https://packs.test/slow'})).jobId
  await wait(f.service,cancelled,['downloading']);await f.service.controlPackDownload({jobId:cancelled,action:'cancel'})
  assert.equal((await f.service.getPackDownload({jobId:cancelled})).state,'cancelled')
  assert.equal(closed,true);assert.deepEqual(await readdir(path.join(f.root,'assets','downloads')),[])
})

test('whole-pack update preserves local enabled/recall, follows unchanged author fields, CAS and provenance',async t=>{
  const f=await fixture(t),original=await syntheticPack(),bytes=await f.archive(original)
  const initial=await apply(f.service,await start(f.service,{selection:await f.selection(bytes)}))
  const assets=structuredClone(initial.snapshot.manifest.assets);assets[0].enabled=false;assets[0].recall={mode:'constant',keywords:['自习']} // no priority; a local trigger word is the local edit
  const local=await f.service.patchPack({packId:PACK_ID,expectedRevision:initial.snapshot.revision,patch:{assets}})
  assert.equal(local.snapshot.distribution.version,'1.0.0')
  const next=await syntheticPack();next.manifest.name='Author v2';next.manifest.assets[0].recall={mode:'constant',keywords:['课堂']};next.manifest.assets[2].enabled=false
  await sealPack(next.manifest,next.files)
  const newBytes=await f.archive(next),sel=await f.selection(newBytes,'2.0.0')
  const updates=await f.service.checkPackUpdates({});assert.equal(updates.updates[0].status,'update')
  const job=await start(f.service,{selection:sel});assert.ok(job.inspection.merge.preserved.includes('asset/backgrounds/classroom'))
  const updated=await apply(f.service,job,'update'), snap=updated.snapshot
  assert.equal(snap.manifest.assets[0].enabled,false);assert.deepEqual(snap.manifest.assets[0].recall.keywords,['自习']);
  assert.equal(snap.manifest.assets[2].enabled,false)
  assert.deepEqual(snap.distribution.baseMetadata['asset/backgrounds/classroom'].recall,{mode:'constant',keywords:['课堂']})
  assert.equal(snap.distribution.version,'2.0.0');assert.equal((await f.service.checkPackUpdates({})).updates[0].status,'current')
  const stale=await start(f.service,{selection:sel})
  await f.service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:snap.revision,patch:{enabled:false}})
  await assert.rejects(apply(f.service,stale,stale.inspection.choices[0]),e=>e.code==='REVISION_CONFLICT')
  f.resources.set('/catalogue',Buffer.from(JSON.stringify(f.catalogue(bytes,'2.0.0'))))
  assert.equal((await f.service.checkPackUpdates({})).updates[0].status,'release-changed')
  f.resources.delete('/catalogue')
  const unavailable=await f.service.checkPackUpdates({});assert.deepEqual(unavailable.updates,[]);assert.equal(unavailable.unavailableSources.length,1)
})

test('merge stable IDs protect false, missing fields and empty recall; deletion/new IDs and no baseline',async()=>{
  const old=await syntheticPack(),base=baseMetadata(old),local=await syntheticPack(),next=await syntheticPack()
  local.figures[FIGURE_ID].outfits[0].enabled=false
  local.manifest.assets[1].enabled=false;next.manifest.assets.splice(1,1)
  next.figures[FIGURE_ID].recall={mode:'keyword'} // no priority
  const merged=await mergeMetadata(next,local,base)
  assert.equal(merged.pack.figures[FIGURE_ID].outfits[0].enabled,false)
  assert.equal(merged.pack.figures[FIGURE_ID].recall.mode,'keyword')
  assert.deepEqual(merged.merge.removedEdited,['asset/backgrounds/pending'])
  const first=await mergeMetadata(next,local,undefined)
  assert.deepEqual(first.pack.figures[FIGURE_ID].recall,{mode:'constant'});
  assert.equal(first.merge.withoutBaseline,true)
})

test('URL widget script warning is surfaced and official update cannot bypass consent',async t=>{
  const f=await fixture(t),pack=await syntheticPack()
  pack.files.set('bundles/widget/index.html',Buffer.from('<!doctype html><script>console.log("test")</script>'))
  await sealPack(pack.manifest,pack.files)
  const bytes=await f.archive(pack),sel=await f.selection(bytes),j=await start(f.service,{selection:sel})
  assert.ok(j.inspection.scriptRisk.length)
  await assert.rejects(apply(f.service,j),e=>e.code==='SCRIPT_CONFIRMATION_REQUIRED')
  assert.deepEqual(await f.service.listPacks(),[])
  await apply(f.service,j,'install',{acceptScriptRisk:true})
  const update=await start(f.service,{selection:await f.selection(bytes,'2.0.0')})
  await assert.rejects(apply(f.service,update,'update'),e=>e.code==='SCRIPT_CONFIRMATION_REQUIRED')
  const copy=await apply(f.service,update,'keep-both',{acceptScriptRisk:true});assert.equal(copy.snapshot.distribution,undefined)
})

test('production network pins public DNS and rejects private redirects and equivalent addresses',async()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2002:7f00:1::1','2001:db8::1']) assert.equal(publicAddress(ip),false,ip)
  assert.equal(publicAddress('8.8.8.8'),true);assert.equal(publicAddress('2606:4700:4700::1111'),true)
  let called=0
  const refused=createPublicNetwork({resolve:async()=>[{address:'127.0.0.1',family:4}],request:()=>{called++}})
  await assert.rejects(refused('https://public.test/'));assert.equal(called,0)
  await assert.rejects(refused('https://2130706433/'))
  const {EventEmitter}=await import('node:events')
  const pinned=createPublicNetwork({resolve:async()=>[{address:'8.8.8.8',family:4}],request:(url,options,cb)=>{
    options.lookup('public.test',{},(err,ip)=>assert.equal(ip,'8.8.8.8'))
    assert.equal(options.agent,false);assert.equal(options.headers.Authorization,undefined)
    const req=new EventEmitter();req.setTimeout=()=>{};req.end=()=>cb({statusCode:302,headers:{location:'https://127.0.0.1/secret'},destroy(){}});return req
  }})
  await assert.rejects(pinned('https://public.test/'),e=>e.code==='DOWNLOAD_FAILED')
})

test('download RPCs remain behind exact authenticated same-origin allowlist',async t=>{
  const f=await fixture(t),transport=createAssetPackTransport({assetRoot:path.join(f.root,'transport-assets'),catalogueSettings:f.settings,catalogueNetwork:f.network}),routes=new Map()
  transport.attach({fetch:{register:route=>{routes.set(route.path,route);return()=>routes.delete(route.path)}}})
  t.after(()=>transport.service.dispose())
  const route=routes.get(PACK_CONTROL_PATH)
  const request=(args,origin='https://host.test')=>new Request('https://host.test'+PACK_CONTROL_PATH,{method:'POST',headers:{Host:'host.test',Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(args)})
  assert.equal((await route.fetch(request({method:'catalogueSettings',args:{}}))).status,200)
  assert.equal((await route.fetch(request({method:'catalogueSettings',args:{}},'https://evil.test'))).status,403)
  assert.notEqual((await route.fetch(request({method:'startPackDownload',args:{url:'https://packs.test/pack',filePath:'C:/secret'}}))).status,200)
  // an old caller still sending the removed fingerprint fails loudly with the field named.
  const stale=await route.fetch(request({method:'startPackDownload',args:{url:'https://packs.test/pack',expectedSha256:'0'.repeat(64)}}))
  assert.equal(stale.status,400);assert.deepEqual(await stale.json(),{error:'UNKNOWN_FIELD'})
})

for(const fallback of ['200','416','changed-etag','bad-range','weak-etag']) test('resume safely restarts for '+fallback,async t=>{
  const f=await fixture(t),bytes=await f.archive();let count=0
  f.resources.set('/resume',(req,res)=>{
    count++
    if(count===1) {
      res.writeHead(200,{'Content-Length':bytes.length,'ETag':fallback==='weak-etag'?'W/"one"':'"one"'});res.write(bytes.subarray(0,100));return
    }
    if(req.headers.range && fallback==='416') {res.writeHead(416);res.end();return}
    if(req.headers.range && ['changed-etag','bad-range'].includes(fallback)) {
      res.writeHead(206,{'ETag':fallback==='changed-etag'?'"two"':'"one"','Content-Range':`bytes ${fallback==='bad-range'?101:100}-${bytes.length-1}/${bytes.length}`});res.end(bytes.subarray(100));return
    }
    res.writeHead(200,{'Content-Length':bytes.length,'ETag':'"two"'});res.end(bytes)
  })
  const {jobId}=await f.service.startPackDownload({url:'https://packs.test/resume'}) // no user fingerprint
  for(let i=0;i<100 && !(await f.service.getPackDownload({jobId})).receivedBytes;i++) await new Promise(r=>setTimeout(r,10))
  await f.service.controlPackDownload({jobId,action:'pause'});await f.service.controlPackDownload({jobId,action:'resume'})
  const j=await wait(f.service,jobId);assert.equal(j.state,'ready',JSON.stringify(j.error));assert.equal(j.inspection.uploadHash,digest(bytes))
  assert.equal(f.requests[1].headers.range,fallback==='weak-etag'?undefined:'bytes=100-')
})

for(const point of ['prepared','backed-up','pack-published','local-published']) test('catalogue content and distribution roll back atomically at '+point,async t=>{
  let failing=false
  const f=await fixture(t,{fault:async stage=>{if(failing && stage===point) throw Error('catalogue injected '+point)}}),bytes=await f.archive()
  const initial=await apply(f.service,await start(f.service,{selection:await f.selection(bytes)}))
  const pack=await syntheticPack();pack.manifest.name='next';await sealPack(pack.manifest,pack.files)
  const job=await start(f.service,{selection:await f.selection(await f.archive(pack),'2.0.0')})
  failing=true;await assert.rejects(apply(f.service,job,'update'),/catalogue injected/)
  assert.deepEqual(await f.service.getPackSnapshot({packId:PACK_ID}),initial.snapshot)
})

test('actual streaming size cap, unsupported requirements and frozen in-flight revision',async t=>{
  const f=await fixture(t,{maxArchiveBytes:32768}),bytes=await f.archive()
  f.resources.set('/oversize',(req,res)=>{res.writeHead(200);res.end(Buffer.alloc(32769))})
  assert.equal((await start(f.service,{url:'https://packs.test/oversize'})).error.code,'LIMIT_EXCEEDED')
  const unsupported=await f.selection(bytes,'1.0.0',{requires:['unknown:feature']})
  await assert.rejects(f.service.startPackDownload({selection:unsupported}),e=>e.code==='ASSET_UNAVAILABLE')
  const sel=await f.selection(bytes),{jobId}=await f.service.startPackDownload({selection:sel})
  f.resources.set('/catalogue',Buffer.from(JSON.stringify(f.catalogue(Buffer.from('replacement'),'2.0.0'))))
  await f.service.refreshCatalogue({sourceId:sel.sourceId})
  const j=await wait(f.service,jobId);assert.equal(j.state,'ready',JSON.stringify(j.error));assert.equal(j.inspection.uploadHash,digest(bytes))
  await assert.rejects(f.service.startPackDownload({selection:sel}),e=>e.code==='REVISION_CONFLICT')
})

test('different source UUID does not take over updates; explicit switch has no old author baseline',async t=>{
  const f=await fixture(t),bytes=await f.archive(),sel=await f.selection(bytes)
  await apply(f.service,await start(f.service,{selection:sel}))
  const community=f.settings.read().values.sources[1]
  f.resources.set('/community',Buffer.from(JSON.stringify(f.catalogue(bytes,'9.0.0'))))
  const c=await f.service.refreshCatalogue({sourceId:community.sourceId})
  assert.equal(c.official,false);assert.equal(c.packs[0].official,false)
  assert.equal((await f.service.checkPackUpdates({})).updates[0].status,'current')
  const j=await start(f.service,{selection:{sourceId:community.sourceId,catalogueRevision:c.catalogueRevision,packId:PACK_ID,version:'9.0.0',downloadId:'original'}})
  assert.equal(j.inspection.merge.withoutBaseline,true)
  const result=await apply(f.service,j,'update');assert.equal(result.snapshot.distribution.sourceId,community.sourceId)
})

test('media ingress validates once; apply, reads, version checks and metadata changes never decode',async t=>{
  let decodes=0
  const f=await fixture(t,{decodeMedia:async(...args)=>{decodes++;return decodeMedia(...args)}}),pack=await syntheticPack()
  const webp=Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64'),hash=digest(webp)
  pack.manifest.blobs[hash]={ext:'webp',mime:'image/webp',size:webp.length};pack.files.set(`media/${hash}.webp`,webp)
  pack.manifest.assets[1].media=hash;delete pack.manifest.assets[1].pendingMedia
  await sealPack(pack.manifest,pack.files)
  const sel=await f.selection(await f.archive(pack)),job=await start(f.service,{selection:sel})
  assert.equal(decodes,1)
  const installed=await apply(f.service,job);await f.service.listPacks();await f.service.checkPackUpdates({})
  await f.service.patchFigure({packId:PACK_ID,figureId:FIGURE_ID,expectedRevision:installed.snapshot.revision,patch:{enabled:false}})
  assert.equal(decodes,1)
  const update=await start(f.service,{selection:sel});assert.equal(decodes,2)
  await apply(f.service,update,update.inspection.choices[0]);assert.equal(decodes,2)
})

test('native catalogue settings use provider CAS, retain built-in identity only unchanged, and persist preferences',async()=>{
  let stored,definition,disposed
  const provider={writable:true,describe:()=>[{ns:'asset-library-catalogues',revision:'native-revision'}],installSection(_ctx,ns,schema,defaults,options){stored=defaults;definition=options;options.setSource(()=>stored)},async replace(ns,next,revision){assert.equal(revision,'native-revision');stored=definition.validate(next)}}
  const ctx={get:()=>provider,inject:(_names,fn)=>fn({get:()=>provider}),effect:fn=>{disposed=fn()}}
  const settings=createCatalogueSettings(ctx,'https://official.test/catalogue'),current=settings.read()
  const saved=await settings.save({...current.values,expectedRevision:current.revision,preferredDownloadId:'mirror',mirrorPrefix:'https://proxy.test/'})
  assert.equal(saved.values.sources[0].official,true);assert.equal(saved.values.preferredDownloadId,'mirror')
  await assert.rejects(settings.save({...saved.values,expectedRevision:current.revision}),e=>e.code==='REVISION_CONFLICT')
  disposed();assert.throws(()=>settings.read())
})
