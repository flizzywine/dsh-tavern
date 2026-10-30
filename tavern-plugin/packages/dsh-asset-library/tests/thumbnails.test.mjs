import test from 'node:test'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {createThumbnailCache} from '../src/pack-v2/thumbnails.js'

const packId = '11111111-1111-4111-8111-111111111111', first = 'a'.repeat(64), second = 'b'.repeat(64)
test('startup and update warm-up yield, pause while busy, skip cache hits and stop on dispose',async t => {
  const assetRoot = await mkdtemp(path.join(tmpdir(),'thumbnails-'))
  t.after(()=>rm(assetRoot,{recursive:true,force:true}))
  let encodes = 0, busy = true, listener, reads = 0
  const blobs = {[first]:{ext:'png'}}
  const service = {
    subscribe(fn) { listener = fn; return ()=>{listener=null} },
    async listPackSummaries() { return [{packId}] },
    async getPackSnapshot() { return {manifest:{blobs},revision:'r1'} },
    async readMedia() { reads++; return {bytes:Buffer.from('source')} }
  }
  const cache = createThumbnailCache({assetRoot,service,delayMs:5,startupMs:5,isBusy:()=>busy,encodeImage:async()=>{encodes++;return Buffer.from('derived')}})
  t.after(()=>cache.dispose())
  await cache.get({packId,hash:first})
  cache.start(); await sleep(30); assert.equal(encodes,1)
  blobs[second] = {ext:'webp'}; listener({packId,revision:'r2'})
  await sleep(30); assert.equal(encodes,1)
  busy = false
  for (let i=0;i<100 && encodes<2;i++) await sleep(5)
  assert.equal(encodes,2); assert.equal(reads,2)
  cache.warm(packId); await sleep(40)
  assert.equal(encodes,2); assert.deepEqual((await cache.manifest(packId)).hashes,[first,second])
  await cache.dispose(); assert.equal(listener,null)
  cache.warm(packId); await sleep(20); assert.equal(encodes,2)
})

test('real encoder normalizes grayscale, palette, CMYK, 16-bit and alpha WebP inputs',async t => {
  const {default:sharp} = await import(process.env.DSH_BOOT_MODULE
    ? pathToFileURL(createRequire(pathToFileURL(process.env.DSH_BOOT_MODULE)).resolve('sharp')).href : 'sharp')
  const assetRoot = await mkdtemp(path.join(tmpdir(),'thumbnail-colour-'))
  t.after(()=>rm(assetRoot,{recursive:true,force:true}))
  const source = () => sharp({create:{width:12,height:8,channels:4,background:{r:90,g:150,b:210,alpha:0.4}}})
  const inputs = [
    await source().greyscale().png().toBuffer(),
    await source().png({palette:true}).toBuffer(),
    await source().removeAlpha().toColourspace('cmyk').jpeg().toBuffer(),
    await source().toColourspace('rgb16').png().toBuffer(),
    await source().webp().toBuffer()
  ]
  // Desktop loads a different sharp first. Two versions in one process reproduce
  // the real 'colourspace: parameter space not set' failure even for sRGB PNGs.
  const inspect = sharp
  await import('sharp')
  let bytes = inputs[0]
  const service = {subscribe:()=>()=>{},listPackSummaries:async()=>[{packId}],getPackSnapshot:async()=>({manifest:{blobs:{[first]:{ext:'png'}}},revision:'r1'}),readMedia:async()=>({bytes})}
  for (let i=0;i<inputs.length;i++) {
    bytes=inputs[i]
    const cache=createThumbnailCache({assetRoot:path.join(assetRoot,String(i)),service})
    try {
      const result=await cache.get({packId,hash:first}), info=await inspect(result).metadata()
      assert.equal(info.format,'png'); assert.equal(info.space,'srgb')
      assert.equal(info.width,12); assert.equal(info.height,8)
      if (i===4) { assert.equal(info.hasAlpha,true); const {data,info:raw}=await inspect(result).raw().toBuffer({resolveWithObject:true}); assert.ok(data[raw.channels-1]>0 && data[raw.channels-1]<255) }
    } finally { await cache.dispose() }
  }
})