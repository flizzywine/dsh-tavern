import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { nativeSettingsProfile } from '../../../../tests/fixtures/native-settings-profile.mjs'
import {createMediaStore} from '../src/pack-v2/media-store.js'
import { PACK_CONTROL_PATH } from '../src/pack-v2/transport.js'
const tick = () => new Promise(resolve => setTimeout(resolve, 30))
const req = (method, args) => new Request('http://dsh.internal' + PACK_CONTROL_PATH, {method:'POST', headers:{host:'localhost:123', origin:'http://localhost:123', 'content-type':'application/json'}, body:JSON.stringify({method, args})})
test('package root mounts only v2; native settings and Connection can arrive late and detach', async t => {
  const profile=await nativeSettingsProfile(t,{ownerUrl:new URL('../lib/index.js',import.meta.url).href,ownerId:'asset-library',ownerConfig:root=>({assetRoot:join(root,'packs')}),settings:false})
  const {ctx,home:root}=profile,routes=new Map()
  ctx.provide('tavernMediaStore',createMediaStore({root:join(root,'media'),copyOnly:true}))
  const service = ctx.get('assetLibrary')
  assert.equal(service.apiVersion, 2)
  assert.equal(service.getPlan, undefined)
  assert.deepEqual(await service.listPacks(), [])
  const {snapshot} = await service.createPack({name:'Decoder wired at root', expectedRevision:null})
  const bytes = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64')
  // Image bytes and their owning asset are installed atomically.
  const hash = createHash('sha256').update(bytes).digest('hex')
  const blob = await service.patchPack({packId:snapshot.manifest.id, expectedRevision:snapshot.revision,
    patch:{blobs:{[hash]:{ext:'webp',mime:'image/webp',size:bytes.length}},assets:[{kind:'backgrounds',id:'decoder',name:'Decoder',enabled:true,recall:{mode:'constant',keywords:['decoder','raster','fixture']},directorNote:'',media:hash}]},
    fileUpdates:new Map([[`media/${hash}.webp`,bytes]])})
  assert.equal(blob.status, 'updated', 'package root supplies the trusted structural port')
  const connection = ctx.plugin({name:'test-connection', apply(ctx) { ctx.provide('connection', {fetch:{register(route) { routes.set(route.path, route); return () => routes.delete(route.path) }}}) }})
  await tick(); assert.equal(routes.size, 6)
  const route = routes.get(PACK_CONTROL_PATH)
  const defaults = await (await route.fetch(req('settings'))).json()
  assert.equal(defaults.writable, false)
  assert.equal((await route.fetch(req('saveSettings', {...defaults.values, expectedRevision:defaults.revision}))).status, 503)
  await profile.setEnabled('settings',true)
  // The native form migration must settle before a competing settings write.
  const deadline=Date.now()+3000
  while(profile.value('asset-library','forkSettingsImported')!==1){if(Date.now()>=deadline)assert.fail('Native asset settings migration did not settle');await tick()}
  const forms=ctx.get('settings').describe()
  assert.deepEqual(forms.map(item=>item.ns),['asset-library'])
  for(const section of ['asset-library-packs','asset-library-catalogues'])assert.ok(JSON.stringify(forms[0].schema).includes(section))
  assert.equal((await route.fetch(req('saveSettings', {...defaults.values, expectedRevision:defaults.revision}))).status, 200)
  for (const method of ['getPlan', 'patchSources', 'listLibraries', 'save']) assert.equal((await route.fetch(req(method))).status, 400)
  await connection.dispose(); await tick(); assert.equal(routes.size, 0)
  assert.equal((await route.fetch(req('capabilities'))).status, 503)
  assert.equal(ctx.get('assetLibrary'), service)
  await profile.setEnabled('settings',false);await profile.setEnabled('asset-library',false)
  assert.equal(ctx.get('assetLibrary'), undefined)
  await assert.rejects(service.listPacks(), {code:'ASSET_UNAVAILABLE'})
  await profile.setEnabled('asset-library',true)
  assert.equal(ctx.get('assetLibrary').apiVersion, 2)
  assert.notEqual(ctx.get('assetLibrary'), service)
  await profile.setEnabled('asset-library',false)
  assert.deepEqual(profile.errors,[])
})
test('actual Connection rejects unauthenticated requests before a plugin handler', t => {
  const ctx=new Context();t.after(()=>ctx.fiber.dispose())
  const check = HostConnectionService.prototype.requestRejection
  let authenticated = false
  const connection = new HostConnectionService(ctx,[],{isAuthenticated:() => authenticated,authenticateApi:()=>undefined})
  const request = {headers:{host:'localhost:123', origin:'http://localhost:123', 'sec-fetch-site':'same-origin'}}
  assert.equal(check.call(connection, request), 401)
  authenticated = true
  assert.equal(check.call(connection, request), undefined)
  assert.equal(check.call(connection, {headers:{...request.headers, origin:'https://evil.invalid'}}), 403)
})
