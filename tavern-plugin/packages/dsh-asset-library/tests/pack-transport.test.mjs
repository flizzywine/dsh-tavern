import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAssetPackTransport, PACK_CONTROL_PATH, PACK_UPLOAD_PATH, PACK_DOWNLOAD_PATH, PACK_CHANGES_PATH, PACK_THUMBNAIL_PATH, PACK_THUMBNAILS_PATH } from '../src/pack-v2/transport.js'
import { writeZip } from '../src/zip.js'
import { jsonBytes } from '../src/pack-v2/validation.js'
import { syntheticPack, digest, PACK_ID } from '../../../../tests/fixtures/asset-packs/pack.mjs'
const origin = 'http://localhost:123'
function request(path, options = {}) {
  return new Request('http://dsh.internal' + path,{...options,headers:{host:'localhost:123',origin,'sec-fetch-site':'same-origin',...options.headers}})
}
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(),'pack-transport-')), routes = new Map()
  const transport = createAssetPackTransport({assetRoot:join(root,'assets'),...options})
  const carrier = {fetch:{register(route) {
    assert.equal(routes.has(route.path),false,'no duplicate route')
    routes.set(route.path,route); return () => routes.delete(route.path)
  }}}
  const detach = transport.attach(carrier)
  t.after(async () => {detach(); await transport.service.dispose(); await rm(root,{recursive:true,force:true})})
  const fetch = req => routes.get(new URL(req.url).pathname).fetch(req)
  const control = (method,args,headers = {}) => fetch(request(PACK_CONTROL_PATH,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({method,args})}))
  async function install() {
    const pack = await syntheticPack(), zip = join(root,'pack.zip')
    await writeZip(zip,[{path:'manifest.json',data:jsonBytes(pack.manifest)},...[...pack.files].map(([path,data]) => ({path,data}))])
    const bytes = await readFile(zip)
    const upload = await (await fetch(request(PACK_UPLOAD_PATH,{method:'POST',headers:{'content-type':'application/octet-stream'},body:bytes}))).json()
    const preview = await (await control('inspectImport',{bytes:upload.ticket})).json()
    const response = await control('applyImport',{inspectionId:preview.inspectionId,expectedRevision:null,decision:'install'})
    assert.equal(response.status,200,await response.clone().text())
    return {pack,bytes,snapshot:(await response.json()).snapshot}
  }
  return {root,routes,transport,carrier,detach,fetch,control,install,service:transport.service}
}
test('v2 control and binary upload install a complete ordinary pack; no v1 dispatch',async t => {
  const f = await fixture(t), {snapshot,bytes} = await f.install()
  assert.deepEqual([...f.routes.keys()],[PACK_THUMBNAIL_PATH,PACK_THUMBNAILS_PATH,PACK_CONTROL_PATH,PACK_UPLOAD_PATH,PACK_DOWNLOAD_PATH,PACK_CHANGES_PATH])
  assert.equal(snapshot.manifest.id,PACK_ID)
  for (const method of ['getPlan','patchSources','listLibraries','constructor','dispose']) assert.equal((await f.control(method,{})).status,400)
  // the browser lists summaries; the full list is host-only.
  const listed = await f.control('listPackSummaries',{}); assert.equal(listed.status,200)
  const [row] = await listed.json(); assert.equal(row.packId,PACK_ID); assert.equal(row.revision,snapshot.revision); assert.equal(row.manifest,undefined)
  assert.equal((await f.control('listPacks',{})).status,400)
  assert.equal((await f.control('listPackSummaries',{packId:PACK_ID})).status,400)
  const exported = await (await f.control('exportPack',{packId:PACK_ID,expectedRevision:snapshot.revision})).json()
  const response = await f.fetch(request(exported.download.url,{headers:{origin:''}}))
  assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'application/zip')
  assert.ok((await response.arrayBuffer()).byteLength >= bytes.byteLength)
  const events = await (await f.fetch(request(PACK_CHANGES_PATH + '?since=0',{headers:{origin:''}}))).json()
  assert.equal(events.changes[0].packId,PACK_ID)
})
test('card bundle route accepts the explicit widget consent choice',async t => {
  const f = await fixture(t)
  for (const disableWidgets of [false,true]) {
    const response = await f.control('applyCardBundle',{inspectionId:'expired-preview',expectedRevision:null,decisions:{},acceptScriptRisk:true,disableWidgets})
    assert.equal(response.status,503)
    assert.equal((await response.json()).error,'ASSET_UNAVAILABLE','Consent reaches the native preview gate instead of unknown-field rejection')
  }
})
test('media leases do not hydrate or clone figure documents and warm responses stay under 100ms',async t => {
  const installed = await fixture(t), {pack} = await installed.install()
  const documents = []
  const f = await fixture(t, {assetRoot:join(installed.root,'assets'), inspectPath:async file => {
    if (/[\\/]figures[\\/]|[\\/]sprites[\\/]/.test(file)) documents.push(file)
    return lstat(file)
  }})
  const hash = Object.keys(pack.manifest.blobs)[0]
  const response = await f.control('leaseMedia',{packId:PACK_ID,hash})
  assert.equal(response.status,200,await response.clone().text())
  const lease = await response.json(), durations = []
  for (let i=0;i<7;i++) {
    const start = performance.now(), response = await f.fetch(request(lease.url))
    assert.equal(response.status,200)
    assert.ok((await response.arrayBuffer()).byteLength > 0)
    if (i) durations.push(performance.now()-start)
  }
  assert.deepEqual(documents,[], 'Media access reads the manifest, not unrelated author documents')
  const median = durations.sort((a,b)=>a-b)[Math.floor(durations.length/2)]
  assert.ok(median < 100, `Warm media median ${median.toFixed(1)}ms`)
  t.diagnostic(`Warm media median ${median.toFixed(1)}ms`)
  const detail = await f.service.getPackSnapshot({packId:PACK_ID})
  assert.ok(Object.keys(detail.figures).length > 0, 'Detail reads upgrade the manifest-only cache')
  assert.ok(documents.length > 0)
})
test('lazy exact buffered leases preserve retained Host, relative trees, HEAD, Range and revocation',async t => {
  let calls = 0
  const f = await fixture(t,{authorizeLease:async () => {calls++;return true}}), {pack,snapshot} = await f.install()
  await f.service.listPacks(); await f.service.getPackSnapshot({packId:PACK_ID})
  assert.equal(calls,0); assert.equal(f.routes.size,6)
  const hash = Object.keys(pack.manifest.blobs)[0]
  const lease = await (await f.control('leaseMedia',{packId:PACK_ID,hash})).json()
  assert.equal(calls,1)
  assert.equal(f.routes.get(lease.url).requestBody,'buffered')
  const get = await f.fetch(request(lease.url,{headers:{origin:'',range:'bytes=0-7'}}))
  assert.equal(get.status,206); assert.equal((await get.arrayBuffer()).byteLength,8)
  const head = await f.fetch(request(lease.url,{method:'HEAD'}))
  assert.equal(head.status,200); assert.equal((await head.arrayBuffer()).byteLength,0)
  assert.equal((await f.fetch(request(lease.url,{headers:{origin:'https://evil.invalid'}}))).status,403)
  assert.equal((await f.fetch(request(lease.url,{headers:{origin:'',host:'localhost:999'}}))).status,403)
  const bundleKey = Object.keys(pack.manifest.bundles).find(key => pack.manifest.bundles[key].kind === 'live2d')
  const bundle = await f.service.leaseBundle({packId:PACK_ID,bundleKey,origin,scope:'dsh-browser'})
  assert.ok(bundle.resources.length > 1)
  for (const path of bundle.resources) assert.equal(f.routes.get(path).requestBody,'buffered')
  const handler = f.routes.get(lease.url)
  const changed = await f.service.patchPack({packId:PACK_ID,expectedRevision:snapshot.revision,patch:{name:'Changed'}})
  assert.equal(f.routes.get(lease.url),handler,'unrelated publication preserves the in-flight route')
  assert.equal((await handler.fetch(request(lease.url))).status,200)
  assert.equal((await f.fetch(request(bundle.url + '?bundle=1'))).status,200)
  await f.service.removePack({packId:PACK_ID,expectedRevision:changed.snapshot.revision})
  assert.equal(f.routes.size,6); assert.equal((await handler.fetch(request(lease.url))).status,503)
})
test('4K media mounts across an unrelated publication without entering the thumbnail path',async t => {
  const {default:sharp} = await import('sharp')
  let encodes = 0
  const f = await fixture(t,{thumbnails:{startupMs:60000,delayMs:60000,encodeImage:async () => {encodes++; throw Error('not a thumbnail request')}}})
  const {snapshot} = await f.install()
  const bytes = await sharp({create:{width:2560,height:3840,channels:4,background:{r:20,g:40,b:60,alpha:1}}}).png().toBuffer()
  const hash = digest(bytes), assets = structuredClone(snapshot.manifest.assets)
  assets.find(asset => asset.kind === 'backgrounds').variants.entries[0].content.media = hash
  const installed = await f.service.patchPack({packId:PACK_ID,expectedRevision:snapshot.revision,
    patch:{assets,blobs:{...snapshot.manifest.blobs,[hash]:{ext:'png',mime:'image/png',size:bytes.length}}},
    fileUpdates:new Map([[`media/${hash}.png`,bytes]])})
  const lease = await (await f.control('leaseMedia',{packId:PACK_ID,hash})).json()
  await f.service.patchPack({packId:PACK_ID,expectedRevision:installed.snapshot.revision,patch:{name:'Updated skin metadata'}})
  const response = await f.fetch(request(lease.url))
  assert.equal(response.status,200)
  const delivered = Buffer.from(await response.arrayBuffer())
  assert.deepEqual(delivered,bytes)
  const info = await sharp(delivered).metadata()
  assert.deepEqual([info.width,info.height],[2560,3840])
  assert.equal(encodes,0)
})

test('transport gates forged authority, client scope, duplicate JSON, oversize and stale handlers',async t => {
  const f = await fixture(t,{limits:{totalSize:64,spoolBytes:128}})
  for (const headers of [{origin:'null'},{origin:'http://dsh.internal'},{'sec-fetch-site':'cross-site'},{host:''},{origin:''}]) assert.equal((await f.control('capabilities',{},headers)).status,403)
  assert.equal((await f.control('leaseMedia',{packId:PACK_ID,hash:'a'.repeat(64),scope:'other'})).status,400)
  const duplicate = await f.fetch(request(PACK_CONTROL_PATH,{method:'POST',headers:{'content-type':'application/json'},body:'{"method":"listPacks","method":"dispose"}'}))
  assert.equal(duplicate.status,400)
  let cancelled = false
  const body = new ReadableStream({pull(controller) {controller.enqueue(new Uint8Array(65))},cancel(){cancelled=true}})
  const response = await f.fetch(request(PACK_UPLOAD_PATH,{method:'POST',headers:{'content-type':'application/octet-stream'},body,duplex:'half'}))
  assert.equal(response.status,413); assert.equal(cancelled,true)
  const stale = f.routes.get(PACK_CONTROL_PATH)
  f.detach(); assert.equal(f.routes.size,0)
  assert.equal((await stale.fetch(request(PACK_CONTROL_PATH))).status,503)
  const stop = f.transport.attach(f.carrier)
  assert.equal((await f.control('capabilities',{})).status,200)
  assert.equal((await stale.fetch(request(PACK_CONTROL_PATH))).status,503)
  await f.service.dispose(); assert.equal(f.routes.size,0); stop()
})
test('Map file updates use single-use bounded binary tickets, not JSON byte arrays',async t => {
  const f = await fixture(t)
  const created = await (await f.control('createPack',{name:'Empty',expectedRevision:null})).json()
  const upload = await (await f.fetch(request(PACK_UPLOAD_PATH,{method:'POST',headers:{'content-type':'application/octet-stream'},body:Buffer.from('license')}))).json()
  const args = {packId:created.snapshot.manifest.id,expectedRevision:created.snapshot.revision,fileUpdates:[['credits/license.txt',upload.ticket]]}
  assert.equal((await f.control('patchPack',args)).status,200)
  assert.equal((await f.control('patchPack',args)).status,503)
  assert.equal((await f.control('patchPack',{...args,fileUpdates:{'credits/license.txt':[1,2]}})).status,400)
})

test('detach cancels an in-flight upload and releases its shared spool reservation',async t => {
  const f = await fixture(t,{limits:{totalSize:64,spoolBytes:64}})
  let cancelled = false, started
  const ready = new Promise(resolve => {started=resolve})
  const body = new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(40));started()},cancel(){cancelled=true}})
  const pending = f.fetch(request(PACK_UPLOAD_PATH,{method:'POST',headers:{'content-type':'application/octet-stream'},body,duplex:'half'}))
  await ready; await new Promise(resolve => setImmediate(resolve))
  const rejected = await f.fetch(request(PACK_UPLOAD_PATH,{method:'POST',headers:{'content-type':'application/octet-stream'},body:new Uint8Array(40)}))
  assert.equal(rejected.status,413)
  f.detach()
  assert.equal((await pending).ok,false); assert.equal(cancelled,true)
  const stop = f.transport.attach(f.carrier)
  assert.equal((await f.fetch(request(PACK_UPLOAD_PATH,{method:'POST',headers:{'content-type':'application/octet-stream'},body:new Uint8Array(64)}))).status,200)
  stop()
})
test('expiry removes exact lease routes and binary tickets; client cannot keep expired capabilities',async t => {
  let now = 1000
  const f = await fixture(t,{now:() => now,leaseTtlMs:10,limits:{previewTtlMs:20}}), {pack} = await f.install()
  const lease = await f.service.leaseMedia({packId:PACK_ID,hash:Object.keys(pack.manifest.blobs)[0],origin,scope:'dsh-browser'})
  const upload = await (await f.fetch(request(PACK_UPLOAD_PATH,{method:'POST',headers:{'content-type':'application/octet-stream'},body:Buffer.from('data')}))).json()
  now += 25
  assert.equal((await f.control('capabilities',{})).status,200)
  assert.equal(f.routes.has(lease.url),false)
  assert.equal((await f.control('inspectImport',{bytes:upload.ticket})).status,503)
})

// only host-issued widget leases admit opaque iframe subresources.
test('widget routes bind full ref and revision; opaque resources do not relax control or media authority', async t => {
  const f=await fixture(t), {snapshot}=await f.install()
  const asset=snapshot.manifest.assets.find(asset=>asset.kind==='widgets')
  const ref={packId:PACK_ID,kind:'widgets',assetId:asset.id}
  // widget-pack v2 retired digest grants; host leases bind the current revision.
  assert.equal('inspectWidgetPermissions' in f.service,false)
  let enabled=true
  const input={ref,expectedRevision:snapshot.revision,origin,scope:'dsh-browser',authorize:()=>enabled}
  assert.equal((await f.control('leaseWidget',{ref,expectedRevision:snapshot.revision})).status,400)
  await assert.rejects(f.service.leaseWidget({...input,expectedRevision:'stale-revision'}),{code:'ASSET_UNAVAILABLE'})
  const lease=await f.service.leaseWidget(input)
  const entry=await f.fetch(request(lease.url, {headers:{'sec-fetch-dest':'iframe'}}))
  assert.equal(entry.status,200)
  assert.match(entry.headers.get('content-security-policy'),/sandbox allow-scripts/)
  assert.match(entry.headers.get('content-security-policy'),/connect-src 'none'/)
  const opaque={origin:'null','sec-fetch-site':'cross-site','sec-fetch-dest':'script'}
  assert.equal((await f.fetch(request(lease.url,{headers:opaque}))).status,200)
  assert.equal((await f.fetch(request(lease.url,{headers:{...opaque,host:'evil.invalid'}}))).status,403)
  assert.equal((await f.fetch(request(lease.url,{headers:{...opaque,'sec-fetch-dest':'iframe'}}))).status,403)
  assert.equal((await f.control('listPacks',{},opaque)).status,403)
  enabled=false
  assert.notEqual((await f.fetch(request(lease.url,{headers:opaque}))).status,200)
  enabled=true
  const handler = f.routes.get(lease.url)
  await f.service.patchPack({packId:PACK_ID,expectedRevision:snapshot.revision,patch:{name:'Widget publication'}})
  assert.equal(f.routes.has(lease.url),false,'executable widget leases still revoke on every publication')
  assert.equal((await handler.fetch(request(lease.url,{headers:opaque}))).status,503)
})

test('thumbnail route lazily encodes, caches, lists identities and rejects traversal and cross-origin requests',async t => {
  let encodes = 0
  const {default:sharp} = await import('sharp')
  const f = await fixture(t,{thumbnails:{startupMs:60000,delayMs:60000,encodeImage:async (bytes,size) => {
    encodes++; return sharp(bytes).resize({width:size,height:size,fit:'inside',withoutEnlargement:true}).webp().toBuffer()
  }}}), {pack} = await f.install()
  const hash = Object.keys(pack.manifest.blobs).find(hash => pack.manifest.blobs[hash].mime.startsWith('image/'))
  const url = PACK_THUMBNAIL_PATH + '?packId=' + PACK_ID + '&hash=' + hash
  const manifest = () => f.fetch(request(PACK_THUMBNAILS_PATH+'?packId='+PACK_ID)).then(r=>r.json())
  assert.deepEqual(await manifest(),{hashes:[]})
  const [a,b] = await Promise.all([f.fetch(request(url)),f.fetch(request(url))])
  assert.equal(a.status,200); assert.equal(b.status,200); assert.equal(encodes,1)
  const bytes = Buffer.from(await a.arrayBuffer()), info = await sharp(bytes).metadata()
  assert.equal(info.format,'webp'); assert.ok(info.width<=256 && info.height<=256)
  assert.match(a.headers.get('cache-control'),/immutable/)
  assert.deepEqual(Buffer.from(await b.arrayBuffer()),bytes)
  assert.deepEqual((await manifest()).hashes,[hash])
  assert.equal((await f.fetch(request(url))).status,200); assert.equal(encodes,1)
  // A larger tier is its own derived file; the warmed 256 tier and the manifest stay as they were.
  const large = await f.fetch(request(url+'&size=1024'))
  assert.equal(large.status,200); assert.equal(encodes,2)
  assert.equal((await f.fetch(request(url+'&size=1024'))).status,200); assert.equal(encodes,2)
  assert.deepEqual((await manifest()).hashes,[hash])
  for (const size of ['300','abc','']) assert.equal((await f.fetch(request(url+'&size='+size))).status,400)
  for (const [packId,id] of [[PACK_ID,'../outside'],['../outside',hash],[PACK_ID,hash+'%2f..']]) {
    assert.equal((await f.fetch(request(PACK_THUMBNAIL_PATH+'?packId='+encodeURIComponent(packId)+'&hash='+encodeURIComponent(id)))).status,400)
  }
  assert.equal((await f.fetch(request(PACK_THUMBNAIL_PATH+'?packId='+PACK_ID+'&hash='+'f'.repeat(64)))).status,404)
  assert.equal((await f.fetch(request(url,{headers:{origin:'https://evil.invalid'}}))).status,403)
})
test('change stream pushes mutations, resumes by sequence and closes on detach', async t => {
  const f = await fixture(t)
  const response = await f.fetch(request(PACK_CHANGES_PATH+'?stream=1&since=0'))
  assert.equal(response.headers.get('content-type'),'text/event-stream')
  const reader = response.body.getReader()
  const read = async () => JSON.parse(new TextDecoder().decode((await reader.read()).value).trim().slice(6))
  assert.deepEqual((await read()).changes,[])
  await f.install()
  const feed = await read()
  assert.equal(feed.changes[0].packId,PACK_ID)
  const resumed = await f.fetch(request(PACK_CHANGES_PATH+'?stream=1&since='+feed.sequence))
  const second = resumed.body.getReader()
  assert.deepEqual(JSON.parse(new TextDecoder().decode((await second.read()).value).trim().slice(6)).changes,[])
  await second.cancel()
  f.detach()
  assert.equal((await reader.read()).done,true)
})
