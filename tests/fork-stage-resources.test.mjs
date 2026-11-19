// resource ownership, not renderer URL suppression, proves renewal continuity.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
const require = createRequire(import.meta.url)
const {createStageResourceOwner} = require('./helpers/stage-resources.cjs')
const ref = {packId:'p',kind:'music',assetId:'track'}
const descriptor = (id = 'a', extra = {}) => ({resource:true,kind:'media',ref,revision:'v1',hash:id,identity:'p:'+id,...extra})
function bytes({maxBytes, maxItems, block, decode, jsonFiles = {}, status = 200} = {}) {
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
      return new Response('bytes',{status,headers:{'content-type':url.endsWith('.png') ? 'image/png' : 'audio/wav'}})
    }})
  return {owner,leases,releases,blobs,revoked,get reads(){return reads}}
}

test('a shared failed bubble avatar request logs the revision and redacts the lease ticket', async t => {
  const warn = t.mock.method(console,'warn',() => {})
  const h = bytes({status:404})
  const face = descriptor('face.png',{ref:{packId:'p',figureId:'f'},outfitKey:'school',stateId:'calm'})
  const load = () => h.owner.acquire(face,'authority',{usage:'bubble-avatar'})
  await Promise.all([assert.rejects(load(),{status:404}),assert.rejects(load(),{status:404})])
  assert.equal(h.reads,1)
  assert.deepEqual(warn.mock.calls.map(call => call.arguments[0]), ['[stage] Bubble avatar failed '+JSON.stringify({
    packId:'p',revision:'v1',figureId:'f',outfit:'school',state:'calm',hash:'face.png',
    url:'/lease/[redacted]/face.png',code:'RESOURCE_READ_FAILED',status:404,servedRevision:null
  })])
  h.owner.dispose()
})

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
