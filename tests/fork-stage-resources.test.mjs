// resource ownership, not renderer URL suppression, proves renewal continuity.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const {createStageResourceOwner} = require('../tavern-plugin/src/client/stage-resources.cjs')
const ref = {packId:'p',kind:'music',assetId:'track'}
const descriptor = (id = 'a', extra = {}) => ({resource:true,kind:'media',ref,revision:'v1',hash:id,identity:'p:'+id,...extra})
function bytes({maxBytes, maxItems, block, decode, jsonFiles = {}} = {}) {
  let serial = 0, reads = 0
  const leases = [], releases = [], blobs = new Map(), revoked = []
  const service = {
    async leaseMedia({hash}) {const lease = {ticket:++serial,revision:'v1',url:'/lease/'+serial+'/'+hash}; leases.push(lease); return lease},
    async leaseBundle() {const lease = {ticket:++serial,revision:'v1',url:'/lease/'+serial+'/model.model3.json',resources:[...new Set(['model.model3.json','model.moc3','textures/body.png','motion.motion3.json',...Object.keys(jsonFiles)])].map(v => '/lease/'+serial+'/'+v)}; leases.push(lease); return lease},
    releaseLease(ticket) {releases.push(ticket)}
  }
  const owner = createStageResourceOwner({service,maxBytes,maxItems,decode,
    urls:{createObjectURL(blob) {const url = 'blob:'+blobs.size; blobs.set(url,blob); return url},revokeObjectURL(url) {revoked.push(url)}},
    async fetch(url) {
      reads++; await block?.(url)
      const json = jsonFiles[url.split('/').slice(3).join('/')]
      if (json) return new Response(JSON.stringify(json),{headers:{'content-type':'application/json'}})
      if (url.endsWith('model.model3.json')) return new Response(JSON.stringify({Version:3,FileReferences:{Moc:'model.moc3',Textures:['textures/body.png'],Motions:{Idle:[{File:'motion.motion3.json'}]}}}),{headers:{'content-type':'application/json'}})
      if (url.endsWith('.json')) return new Response('{}',{headers:{'content-type':'application/json'}})
      return new Response('bytes',{headers:{'content-type':url.endsWith('.png') ? 'image/png' : 'audio/wav'}})
    }})
  return {owner,leases,releases,blobs,revoked,get reads(){return reads}}
}

for (const kind of ['music','ambience','background','static','layered','avatar','sfx','bundle']) test(`${kind}: three re-acquisitions retain pinned bytes/handle without a lease, changed hash replaces once`,async () => {
  const h = bytes(), input = descriptor('a',{kind:kind === 'bundle' ? 'bundle' : 'media',bundleKey:kind === 'bundle' ? 'model' : undefined})
  const first = await h.owner.acquire(input,'authority'), reads = h.reads
  // The transfer lease is released once the bytes are local; the held handle needs none.
  assert.deepEqual(h.releases,[1])
  for (let i=0;i<3;i++) {
    const next = await h.owner.acquire({...input,revision:'v1'},'authority')
    assert.equal(next.handle,first.handle); assert.equal(next.handle.url,first.handle.url); next.release()
  }
  assert.equal(h.leases.length,1); assert.equal(h.reads,reads)
  const changed = await h.owner.acquire({...input,hash:'b',identity:'p:b'},'authority')
  assert.notEqual(changed.handle,first.handle)
  const duplicate = await h.owner.acquire({...input,hash:'b',identity:'p:b'},'authority')
  assert.equal(duplicate.handle,changed.handle); assert.equal(h.leases.length,2)
  first.release(); duplicate.release(); changed.release(); h.owner.dispose()
  assert.equal(h.owner.snapshot().bytes,0)
})

for (const kind of ['media','bundle']) test(`${kind}: lamp-only pack revisions preserve stage resources without issuing leases or fetching bytes`,async () => {
  const h=bytes(),input=descriptor('figure-art',{kind,ref:{packId:'p',figureId:'f'},...(kind==='bundle'?{bundleKey:'model'}:{})})
  const first=await h.owner.acquire(input,'authority'),reads=h.reads,leases=h.leases.length
  for(const revision of ['lamp-green','lamp-off','lamp-blue']) {
    const next=await h.owner.acquire({...input,revision},'authority')
    assert.equal(next.handle,first.handle);assert.equal(next.handle.url,first.handle.url)
    assert.equal(h.reads,reads);assert.equal(h.leases.length,leases);next.release()
  }
  first.release();h.owner.dispose()
})

test('Live2D bundle eagerly pins and rewrites deferred motion/texture dependencies before readiness',async () => {
  const h = bytes(), pin = await h.owner.acquire(descriptor('model',{kind:'bundle',bundleKey:'model'}),'a')
  const model = JSON.parse(await h.blobs.get(pin.handle.url).text())
  for (const url of [model.FileReferences.Moc,model.FileReferences.Textures[0],model.FileReferences.Motions.Idle[0].File]) assert.ok(h.blobs.has(url))
  assert.equal(h.reads,4)
  assert.ok(h.releases.length === 1)
  pin.release(); h.owner.dispose()
})

test('Live2D bundle preserves empty metadata in model, physics and expressions while rewriting resources',async () => {
  const h = bytes({jsonFiles:{
    'model.model3.json':{Version:3,Name:'',Description:'  ',FileReferences:{Moc:'model.moc3',Physics:'physics.physics3.json',Expressions:[{Name:'',File:'sad.exp3.json'}],Motions:{Idle:[{File:'motion.motion3.json',Sound:''}]}}},
    'physics.physics3.json':{Version:3,Meta:{EffectiveForces:{Gravity:{X:0,Y:-1}},PhysicsDictionary:[{Id:'',Name:''}]}},
    'sad.exp3.json':{Type:'Live2D Expression',Name:'',Parameters:[{Id:'ParamMouthOpenY',Value:0,Blend:'Add'}]}
  }})
  const pin = await h.owner.acquire(descriptor('model',{kind:'bundle',bundleKey:'model'}),'a')
  const model = JSON.parse(await h.blobs.get(pin.handle.url).text())
  assert.equal(model.Name,''); assert.equal(model.Description,'  ')
  assert.equal(model.FileReferences.Expressions[0].Name,''); assert.equal(model.FileReferences.Motions.Idle[0].Sound,'')
  for (const url of [model.FileReferences.Moc,model.FileReferences.Physics,model.FileReferences.Expressions[0].File,model.FileReferences.Motions.Idle[0].File]) assert.ok(h.blobs.has(url))
  const physics = JSON.parse(await h.blobs.get(model.FileReferences.Physics).text())
  assert.deepEqual(physics.Meta.PhysicsDictionary,[{Id:'',Name:''}])
  const expression = JSON.parse(await h.blobs.get(model.FileReferences.Expressions[0].File).text())
  assert.equal(expression.Name,''); assert.equal(expression.Parameters[0].Id,'ParamMouthOpenY')
  pin.release(); h.owner.dispose()
  assert.equal(h.owner.snapshot().bytes,0)
})

for (const indirect of [false,true]) test(`Live2D bundle rejects an explicit ${indirect ? 'indirect' : 'self'} reference cycle and releases bytes`,async () => {
  const h = bytes({jsonFiles:{
    'model.model3.json':{FileReferences:{Physics:indirect ? 'physics.physics3.json' : 'model.model3.json'}},
    ...(indirect ? {'physics.physics3.json':{File:'model.model3.json'}} : {})
  }})
  await assert.rejects(h.owner.acquire(descriptor('model',{kind:'bundle',bundleKey:'model'}),'a'),/RESOURCE_BUNDLE_CYCLE/)
  assert.deepEqual(h.owner.snapshot(),{bytes:0,items:0,pins:0})
  assert.equal(h.releases.length,1)
  h.owner.dispose()
})

test('budget refuses replacement without evicting accepted pins; unpinned LRU is bounded',async () => {
  const h = bytes({maxBytes:5,maxItems:2}), accepted = await h.owner.acquire(descriptor(),'a')
  await assert.rejects(h.owner.acquire(descriptor('b'),'a'),/RESOURCE_BUDGET/)
  assert.equal(h.owner.snapshot().bytes,5); assert.deepEqual(h.revoked,[])
  accepted.release()
  const next = await h.owner.acquire(descriptor('b'),'a')
  assert.equal(h.owner.snapshot().items,1); assert.deepEqual(h.revoked,[accepted.handle.url])
  next.release(); h.owner.dispose()
})

// a cache hit refreshes recency; eviction takes the least recently used entry, not the oldest.
test('a cache hit refreshes recency: eviction is LRU, not FIFO',async () => {
  const h = bytes({maxItems:2})
  const a = await h.owner.acquire(descriptor('a'),'s'), b = await h.owner.acquire(descriptor('b'),'s')
  a.release(); b.release()
  const reads = h.reads
  ;(await h.owner.acquire(descriptor('a'),'s')).release()
  assert.equal(h.reads,reads,'the hit reads no bytes')
  ;(await h.owner.acquire(descriptor('c'),'s')).release()
  assert.deepEqual(h.revoked,[b.handle.url],'b (least recently used) goes, a stays')
  assert.equal(h.owner.isPrepared(descriptor('a'),'s'),true)
  assert.equal(h.owner.isPrepared(descriptor('b'),'s'),false)
  const retained = h.owner.retain('p:c','s')
  ;(await h.owner.acquire(descriptor('d'),'s')).release()
  assert.equal(h.owner.isPrepared(descriptor('a'),'s'),false,'a is now the least recent')
  assert.equal(h.owner.isPrepared(descriptor('c'),'s'),true)
  retained.release(); h.owner.dispose()
})

test('scoped revoke preserves unrelated pins and rejects late byte completion without resurrection',async () => {
  let finish, blocked = false
  const h = bytes({block:() => blocked ? new Promise(resolve => {finish=resolve}) : undefined})
  const good = await h.owner.acquire(descriptor('music'),'a')
  blocked = true
  const loading = h.owner.acquire(descriptor('actor',{ref:{packId:'actors',figureId:'f'}}),'a')
  await new Promise(resolve => setImmediate(resolve))
  h.owner.revoke({packId:'actors'},'a'); finish()
  await assert.rejects(loading,/RESOURCE_REVOKED/)
  assert.equal(h.owner.snapshot().items,1); assert.deepEqual(h.revoked,[])
  assert.equal((await h.owner.acquire(descriptor('music'),'a')).handle,good.handle)
  h.owner.dispose()
})

test('authority isolation, partial preparation failure and decode failure release their own pins',async () => {
  const h = bytes()
  const a = await h.owner.acquire(descriptor(),'a'), b = await h.owner.acquire(descriptor(),'b')
  assert.notEqual(a.handle,b.handle)
  h.owner.revoke({authority:true},'a')
  assert.equal(h.owner.snapshot().items,1); assert.equal(h.revoked[0],a.handle.url)
  h.owner.dispose()
  const failed = bytes({decode:async () => {throw Error('decode failed')}})
  await assert.rejects(failed.owner.prepare({url:descriptor()},'a'),/decode failed/)
  assert.equal(failed.owner.snapshot().pins,0); assert.equal(failed.owner.snapshot().bytes,0)
  assert.equal(failed.revoked.length,1)
  failed.owner.dispose()
})

test('decoded-image budget refuses a candidate without destroying pinned last-good',async()=>{
  let size=1,closed=0
  const h=bytes({maxBytes:40,decode:async()=>({width:size,height:size,close(){closed++}})})
  const accepted=await h.owner.acquire(descriptor(),'a')
  assert.equal(h.owner.snapshot().bytes,9)
  size=4
  await assert.rejects(h.owner.acquire(descriptor('large'),'a'),/RESOURCE_BUDGET/)
  assert.equal(h.owner.snapshot().bytes,9)
  assert.equal(h.owner.snapshot().pins,1)
  assert.equal(closed,1)
  assert.ok(!h.revoked.includes(accepted.handle.url))
  accepted.release();h.owner.dispose();assert.equal(closed,2)
})

// turn-126-shaped retained memory; decode accounts dimensions without allocating pixels.
test('turn-126-like bundles, sprites and backgrounds reproduce 128 MiB pressure with per-kind evidence',async()=>{
  const MiB=1024**2
  const h=bytes({maxBytes:128*MiB,decode:async(blob)=>blob.type==='image/png'?{width:4096,height:2048}:null})
  const outgoing=await h.owner.acquire(descriptor('outgoing',{ref:{kind:'backgrounds'},hash:'outgoing.png'}),'a')
  const models=[]
  for(let i=0;i<2;i++) models.push(await h.owner.acquire(descriptor('model-'+i,{kind:'bundle',bundleKey:'model-'+i}),'a'))
  await assert.rejects(h.owner.acquire(descriptor('sprite',{ref:{kind:'portraits'},hash:'sprite.png'}),'a'),error=>{
    assert.equal(error.code,'RESOURCE_BUDGET')
    assert.equal(error.budget.byKind.bundle.entries,2)
    assert.equal(error.budget.byKind.bundle.pins,2)
    assert.equal(error.budget.byKind.backgrounds.bytes,32*MiB+5)
    assert.equal(error.budget.requestedBytes,32*MiB)
    assert.ok(error.budget.bytes+error.budget.requestedBytes>128*MiB)
    return true
  })
  assert.equal(h.owner.debug().lastBudgetFailure.byKind.portraits.entries,1)
  outgoing.release();models.forEach(pin=>pin.release());h.owner.dispose()
})

test('speculative holders yield before foreground pins, including entry-cap pressure',async()=>{
  const h=bytes({maxBytes:15,maxItems:3})
  const accepted=await h.owner.acquire(descriptor('accepted'),'a')
  const warm1=await h.owner.prepare(descriptor('warm1'),'a',{prefetch:true})
  const warm2=await h.owner.prepare(descriptor('warm2'),'a',{prefetch:true})
  const current=await h.owner.prepare([descriptor('current1'),descriptor('current2')],'a')
  assert.equal(h.owner.snapshot().bytes,15)
  assert.equal(h.owner.snapshot().pins,3)
  assert.equal(h.owner.debug().lastBudgetFailure,null)
  assert.ok(!h.revoked.includes(accepted.handle.url))
  warm1.release();warm2.release();assert.equal(h.owner.snapshot().pins,3)
  current.release();accepted.release();h.owner.dispose()
})

test('default ceiling fits several bundles plus full-resolution sprites and backgrounds',async()=>{
  const h=bytes({decode:async blob=>blob.type==='image/png'?{width:4096,height:2048}:null}),pins=[]
  for(let i=0;i<5;i++) pins.push(await h.owner.prepare(descriptor('model-'+i,{kind:'bundle',bundleKey:'model-'+i}),'a',{prefetch:true}))
  for(let i=0;i<4;i++) pins.push(await h.owner.prepare(descriptor('sprite-'+i,{hash:'sprite-'+i+'.png',ref:{kind:'portraits'}}),'a'))
  pins.push(await h.owner.prepare(descriptor('background',{hash:'background.png',ref:{kind:'backgrounds'}}),'a'))
  assert.ok(h.owner.snapshot().bytes>320*1024**2)
  assert.equal(h.owner.debug().maxBytes,2*1024**3)
  assert.equal(h.owner.debug().maxItems,2048)
  const resources=h.owner.debug().resources
  assert.equal(resources.length,10)
  assert.equal(resources.filter(item=>item.kind==='bundle').length,5)
  assert.ok(resources.every(item=>item.decodedBytes===32*1024**2))
  assert.equal(resources.reduce((sum,item)=>sum+item.bytes,0),h.owner.snapshot().bytes)
  assert.equal(resources.filter(item=>item.pins.every(pin=>pin.prefetch)).length,5)
  assert.equal(h.owner.debug().lastBudgetFailure,null)
  pins.forEach(pin=>pin.release());h.owner.dispose()
})

// scrolling a gallery cannot fill the decoded warm cache with full-resolution art.
test('gallery-only pins retire bytes and decoded handles while shared stage pins remain valid',async()=>{
  let closed=0;const h=bytes({decode:async()=>({width:4096,height:4096,close(){closed++}})});
  for(let i=0;i<60;i++){
    const pin=await h.owner.acquire(descriptor('cg'+i+'.png'),'gallery',{usage:'cg-gallery'});
    assert.equal(h.owner.snapshot().pins,1);pin.release();
    assert.deepEqual(h.owner.snapshot(),{bytes:0,items:0,pins:0});
  }
  assert.equal(closed,60);assert.equal(h.revoked.length,60);
  const image=descriptor('shared.png'),stage=await h.owner.acquire(image,'same',{usage:'cg'}),gallery=await h.owner.acquire(image,'same',{usage:'cg-gallery'});
  gallery.release();assert.equal(h.owner.snapshot().pins,1);assert.equal(closed,60);assert.equal(h.revoked.includes(stage.handle.url),false);
  stage.release();h.owner.dispose();assert.equal(closed,61);
});

test('bundle files fetch concurrently within a bound and failed siblings settle before cleanup',async()=>{
  let unblock,active=0,peak=0
  const gate=new Promise(resolve=>{unblock=resolve})
  const h=bytes({jsonFiles:Object.fromEntries(Array.from({length:12},(_,i)=>['extra-'+i+'.json',{}])),block:async url=>{
    active++;peak=Math.max(peak,active)
    await gate;active--
    if(url.endsWith('model.moc3'))throw Error('fixture read failure')
  }})
  const pending=h.owner.acquire(descriptor('model',{kind:'bundle',bundleKey:'model'}),'a')
  const rejected=assert.rejects(pending,/fixture read failure/)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(peak,6,'textures and model bytes start together, without fetching the whole pack at once')
  unblock();await rejected
  assert.equal(active,0)
  assert.deepEqual(h.owner.snapshot(),{bytes:0,items:0,pins:0})
  assert.equal(h.releases.length,1)
  h.owner.dispose()
})
test('projection resources start together, deduplicate shared leaves and release late sibling pins on failure',async()=>{
  let release
  const gate=new Promise(resolve=>{release=resolve}), started=[]
  const h=bytes({block:async url=>{started.push(url);await gate;if(url.endsWith('/bad'))throw Error('bad media')}})
  const pending=h.owner.prepare({first:descriptor('bad'),nested:[descriptor('slow'),descriptor('slow')],last:descriptor('last')},'a')
  const rejected=assert.rejects(pending,/bad media/)
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(started.length,3,'all unique first-view media start before any completes')
  release();await rejected
  assert.equal(h.owner.snapshot().pins,0,'successful late siblings are released after a failed prepare')
  const good=await h.owner.prepare([descriptor('slow'),descriptor('slow'),descriptor('last')],'a')
  assert.equal(good.value[0],good.value[1]);assert.equal(good.pins.length,2)
  good.release();h.owner.dispose();assert.deepEqual(h.owner.snapshot(),{bytes:0,items:0,pins:0})
})

test('skin SVG waits for intrinsic load, not a throttled raster decode; raster and failure semantics stay intact',async t=>{
  const {stageDecodeImage}=require('../tavern-plugin/src/client/stage-resources.cjs')
  const previous=globalThis.Image;let decoded=0
  globalThis.Image=class {set src(value){this.value=value;if(value)queueMicrotask(()=>value==='bad'?this.onerror?.():this.onload?.())}async decode(){decoded++}}
  t.after(()=>{if(previous===undefined)delete globalThis.Image;else globalThis.Image=previous})
  const svg=await stageDecodeImage(new Blob(['svg'],{type:'image/svg+xml'}),'svg')
  assert.equal(decoded,0);assert.equal(svg.value,'svg');assert.equal(svg.onload,null)
  await stageDecodeImage(new Blob(['png'],{type:'image/png'}),'png');assert.equal(decoded,1)
  await assert.rejects(stageDecodeImage(new Blob(['bad'],{type:'image/svg+xml'}),'bad'),/RESOURCE_DECODE_FAILED/)
})
// Only tiny ones: art URLs become root tokens, and every root style write re-serialises the whole style text (perf: a
// 128 KB limit made a stage root style 1.6 MB). A 3 KB drawing is a Blob URL.
test('small static SVG skin art uses inline images instead of per-icon Blob URL registrations',async()=>{
  const paths=['/lease/skin/skin.json','/lease/skin/art/icon.svg','/lease/skin/art/frame.svg'],svg='<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>',form=new FormData()
  form.append(paths[0],new Blob([JSON.stringify({art:{image:'art/icon.svg',frame:'art/frame.svg'}})],{type:'application/json'}),'resource')
  form.append(paths[1],new Blob([svg],{type:'image/svg+xml'}),'resource')
  form.append(paths[2],new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><path d="' + 'M0 0H8V8Z'.repeat(300) + '"/></svg>'],{type:'image/svg+xml'}),'resource')
  let registrations=0,reads=0
  const owner=createStageResourceOwner({service:{leaseBundle:async()=>({ticket:'skin',revision:'v1',url:paths[0],resources:paths}),releaseLease(){}},
    fetch:async()=>{reads++;return new Response(form)},decode:async blob=>blob.type.startsWith('image/')?{width:8,height:8}:null,
    urls:{createObjectURL:()=>`blob:${++registrations}`,revokeObjectURL(){}}})
  try {
    const pin=await owner.acquire(descriptor('skin',{kind:'bundle',bundleKey:'skin',ref:{packId:'p',kind:'skins',assetId:'skin'}}),'a')
    assert.equal(reads,1);assert.equal(registrations,2)
    assert.equal(decodeURIComponent(pin.handle.files['art/icon.svg'].url.split(',')[1]),svg)
    assert.match(pin.handle.files['art/frame.svg'].url,/^blob:/)
    assert.ok(pin.handle.files['art/icon.svg'].image);pin.release()
  } finally {owner.dispose()}
})
test('oversized skin transfer falls back only on the explicit bounded-transfer response',async()=>{
  const paths=['/lease/s/skin.json','/lease/s/icon.png'],calls=[]
  const owner=createStageResourceOwner({service:{leaseBundle:async()=>({ticket:'s',revision:'v1',url:paths[0],resources:paths}),releaseLease(){}},
    fetch:async url=>{calls.push(url);return url.includes('?bundle=1')?new Response(null,{status:413}):new Response(url.endsWith('.json')?'{}':'image')},
    urls:{createObjectURL:()=>`blob:${calls.length}`,revokeObjectURL(){}}})
  try {const pin=await owner.acquire(descriptor('skin',{kind:'bundle',ref:{packId:'p',kind:'skins'},bundleKey:'skin'}),'a');assert.equal(calls.length,3);assert.ok(pin.handle.files['icon.png']);pin.release()}
  finally {owner.dispose()}
})
test('skin font bytes are lazy, single-flight, budgeted and cannot outlive the skin owner',async()=>{
  const paths=['/lease/s/skin.json','/lease/s/font.woff2'],calls=[]
  const form=new FormData();form.append(paths[0],new Blob(['{"font":"font.woff2"}'],{type:'application/json'}),'resource');form.append(paths[1],'deferred-font')
  const owner=createStageResourceOwner({service:{leaseBundle:async()=>({ticket:'s',revision:'v1',url:paths[0],resources:paths}),releaseLease(){}},
    fetch:async url=>{calls.push(url);return url.includes('?bundle=1')?new Response(form):new Response('font',{headers:{'Content-Type':'font/woff2'}})},
    urls:{createObjectURL:()=>`blob:skin`,revokeObjectURL(){}}})
  const pin=await owner.acquire(descriptor('skin',{kind:'bundle',ref:{packId:'p',kind:'skins'},bundleKey:'skin'}),'a')
  const font=pin.handle.files['font.woff2'],before=owner.snapshot().bytes
  assert.equal(calls.length,1);assert.equal(font.blob,undefined)
  const [a,b]=await Promise.all([font.load(),font.load()])
  assert.equal(a,b);assert.equal(await a.text(),'font');assert.equal(calls.length,2)
  assert.equal(owner.snapshot().bytes,before+4)
  pin.release();owner.dispose()
  assert.throws(()=>font.load(),/RESOURCE_REVOKED/)
  assert.equal(owner.snapshot().bytes,0)
})

test('revoking a skin during its deferred font read prevents late accounting resurrection',async()=>{
  const paths=['/lease/s/skin.json','/lease/s/font.woff2'];let resolve
  const form=new FormData();form.append(paths[0],new Blob(['{}']),'resource');form.append(paths[1],'deferred-font')
  const owner=createStageResourceOwner({service:{leaseBundle:async()=>({ticket:'s',revision:'v1',url:paths[0],resources:paths}),releaseLease(){}},
    fetch:async url=>url.includes('?bundle=1')?new Response(form):new Promise(r=>resolve=r),urls:{createObjectURL:()=>`blob:skin`,revokeObjectURL(){}}})
  const pin=await owner.acquire(descriptor('skin',{kind:'bundle',ref:{packId:'p',kind:'skins'},bundleKey:'skin'}),'a')
  const pending=pin.handle.files['font.woff2'].load(),rejected=assert.rejects(pending,/RESOURCE_REVOKED/)
  // The font is read under its own lease: wait until that read is in flight.
  while(!resolve) await new Promise(r=>setImmediate(r))
  owner.dispose();resolve(new Response('font'));await rejected
  assert.deepEqual(owner.snapshot(),{bytes:0,items:0,pins:0})
})
// a stage holds
// descriptors minted at the revision it projected; another publication moves the pack revision, not unchanged content.
test('a descriptor from an older pack revision leases unchanged content and rejects changed content',async()=>{
  const {createPackLeases}=await import('../tavern-plugin/packages/dsh-asset-library/src/pack-v2/leases.js')
  const host=createPackLeases({authorize:async()=>true})
  const issued=await host.issue({packId:'p',revision:'v2',contentHash:'skin',origin:'http://127.0.0.1',scope:'s',entry:'skin.json',kind:'bundle',resources:[{name:'skin.json',path:'bundles/skin/skin.json',mime:'application/json'}]})
  assert.equal(issued.contentHash,'skin')
  for (const [contentHash,expected] of [['skin',null],['repainted','ASSET_STALE']]) {
    const released=[]
    const owner=createStageResourceOwner({service:{leaseBundle:async()=>({...issued,contentHash}),releaseLease(ticket){released.push(ticket)}},
      fetch:async url=>url.includes('?bundle=1')?new Response(null,{status:413}):new Response('{}',{headers:{'content-type':'application/json'}}),
      urls:{createObjectURL:()=>'blob:skin',revokeObjectURL(){}}})
    try {
      const acquiring=owner.acquire(descriptor('skin',{kind:'bundle',bundleKey:'skin',ref:{packId:'p',kind:'skins',assetId:'skin'}}),'a')
      if (expected) {await assert.rejects(acquiring,{code:expected});assert.deepEqual(released,[issued.ticket])}
      else {const pin=await acquiring;assert.ok(pin.handle.files['skin.json']);pin.release()}
    } finally {owner.dispose()}
  }
  host.dispose()
})