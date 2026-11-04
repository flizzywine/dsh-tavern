import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readCardArchive } from '../tavern-plugin/lib/domain/card-archive.js'
import { openZipFile } from '../tavern-plugin/lib/domain/zip-file.js'
import { createAssetPacks } from '../tavern-plugin/lib/domain/asset-packs.js'
import { createMediaStore } from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/media-store.js'
import { createCardFiles } from '../tavern-plugin/lib/domain/card-files.js'
import { createCardPlugins } from '../tavern-plugin/lib/domain/card-plugins.js'
import { createCardPreparation, projectCardSummary } from '../tavern-plugin/lib/domain/card-preparation.js'
import { createCardSummaryCache } from '../tavern-plugin/lib/domain/card-summary-cache.js'
import { createCastAssets } from '../tavern-plugin/lib/domain/cast-assets.js'
import { createFileResourceStore } from '../tavern-plugin/lib/domain/file-resources.js'
import { readZipEntries, writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { encryptCardArchiveFile } from '../tavern-plugin/lib/domain/card-encryption.js'
import { pngWithCard } from '../tavern-plugin/lib/domain/card-assets.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

// An export is a spool file; read its entries and remove it.
async function exportedEntries(exported) {
  try { return readZipEntries(await readFile(exported.file)) } finally { await exported.dispose() }
}

async function library(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'card-files-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profileData = createProfileDataStore({ dataRoot: root })
  const fileResources = createFileResourceStore({ dataRoot: root })
  let serial = 0
  const cardPreparation = createCardPreparation({ id: () => 'card-' + ++serial, now: Date.now })
  const castAssets = createCastAssets({ store: profileData })
  const readCardWorkspace = async cardPath => {
    const existing = await fileResources.readCard(cardPath)
    if (existing === undefined || cardPreparation.isWorkspace(existing)) return existing
    return await fileResources.ensureCardWorkspace(cardPath, (working, payload) => cardPreparation.migrate({ working, payload }))
  }
  const cardSummaries = createCardSummaryCache({ absolute: cardPath => fileResources.absolute(cardPath), read: async cardPath => projectCardSummary(await readCardWorkspace(cardPath)) })
  const files = createCardFiles({
    exportRoot: join(root, "exports"),
    cardPreparation, fileResources, castAssets, assetPacks: createAssetPacks({ root, store: profileData, mediaStore: createMediaStore({ root: join(root, 'asset-packs') }) }), cardSummaries, readCardWorkspace,
    worldBooks: { characterBookForCard: async () => undefined },
    cardPlugins: createCardPlugins({ dataRoot: root, pluginsDir: join(root, 'plugins') }), presetLibrary: {}, importPreset: () => assert.fail('no start defaults'), ...extra, pluginApi: () => assert.fail('not a plugin format')
  })
  return { root, files, fileResources, castAssets }
}

test('encrypted DSH imports authenticate before saving cards/plugins, and duplicates still require the password', async t => {
  const { root, files, fileResources, castAssets } = await library(t)
  const plain = join(root, 'plain.dshcard'), encrypted = join(root, 'locked.dshcard')
  await writeFile(plain, writeZipEntries([
    { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, plugins: [{ name: 'encrypted-game', path: 'plugins/game/' }] }) },
    { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name: '加密测试卡', description: 'opaque fixture' } }) },
    { path: 'plugins/game/package.json', content: JSON.stringify({ name: 'encrypted-game', version: '1.0.0' }) },
    { path: 'plugins/game/index.mjs', content: 'export function apply() {}' },
    { path: 'plugins/game/assets/data.bin', content: 'fixture bytes' },
  ]))
  await encryptCardArchiveFile(plain, encrypted, 'test-only-password')
  await assert.rejects(files.importCardArchiveFile(encrypted, 'locked.dshcard'), { code: 'TAVERN_CARD_PASSWORD_REQUIRED' })
  await assert.rejects(files.importCardArchiveFile(encrypted, 'locked.dshcard', { password: 'wrong' }), { code: 'TAVERN_CARD_PASSWORD_INVALID' })
  assert.deepEqual(await fileResources.list('card'), [])
  const card = await files.importCardArchiveFile(encrypted, 'locked.dshcard', { password: 'test-only-password' })
  assert.equal(card.name, '加密测试卡')
  assert.equal((await castAssets.read(card.path)).plugins[0].enabled, true)
  await assert.rejects(files.importCardArchiveFile(encrypted, 'locked.dshcard'), { code: 'TAVERN_CARD_PASSWORD_REQUIRED' })
  assert.equal((await files.importCardArchiveFile(encrypted, 'locked.dshcard', { password: 'test-only-password' })).duplicate, true)
  const entries = await exportedEntries(await files.exportCardFile(card.path))
  assert.equal(JSON.parse(entries.get('dsh.json')).plugins[0].name, 'encrypted-game')
  assert.equal(entries.get('plugins/game/assets/data.bin').toString(), 'fixture bytes')
})

test('a CHARX imports once; the same file again opens the card already imported; a bare card exports as DSH', async t => {
  const { root, files } = await library(t)
  const charx = join(root, '鱼.charx')
  await writeFile(charx, writeZipEntries([{ path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name: '鱼', description: '一条鱼' } }) }]))

  const first = await files.importCardArchiveFile(charx, '鱼')
  assert.equal(first.name, '鱼')
  assert.equal(first.format, 'charx')
  assert.equal(first.duplicate, undefined)

  const again = await files.importCardArchiveFile(charx, '鱼')
  assert.deepEqual(again, { path: first.path, name: '鱼', duplicate: true })

  const exported = await files.exportCardFile(first.path)
  assert.equal(exported.extension, 'dshcard')
  assert.equal(JSON.parse((await exportedEntries(exported)).get('card.json').toString()).data.description, '一条鱼')
})

test('an encrypted ST PNG imports its cover into the library and exports a single DSH container', async t => {
  const { root, files, fileResources } = await library(t)
  const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8V8AAAAASUVORK5CYII=', 'base64')
  const input = join(root, 'source.png'), locked = join(root, 'locked.dshcard')
  await writeFile(input, pngWithCard(cover, JSON.stringify({ spec: 'chara_card_v3', data: { name: '封面测试', description: 'private' } })))
  await encryptCardArchiveFile(input, locked, 'test-password', { name: 'source.png' })
  const card = await files.importCardArchiveFile(locked, 'locked.dshcard', { password: 'test-password' })
  assert.ok((await fileResources.readCardImage(card.path)).length >= cover.length)
  const exported = await files.exportCardFile(card.path)
  assert.equal(exported.extension, 'dshcard')
  assert.equal((await readFile(exported.file)).readUInt32LE(0), 0x04034b50)
  const entries = await exportedEntries(exported)
  assert.equal(JSON.parse(entries.get('dsh.json')).format, 'dshcard')
  assert.deepEqual(entries.get('assets/icon/images/main.png'), cover)
})


// A DSH card with a pack and a plugin imports and goes back out whole; a figure left out of the export leaves with the
// media only it uses, from the exported copy only.
test('v1 card, bound pack and plugin round trip; PNG imports and exclusion only changes the exported copy', async t => {
  const {root, files, fileResources} = await library(t)
  const id = '11111111-1111-4111-8111-111111111111', omitted = '22222222-2222-4222-8222-222222222222', kept = '33333333-3333-4333-8333-333333333333'
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=', 'base64')
  const hash = 'a'.repeat(64), media = 'media/' + hash + '.png'
  const manifest = {format:'dsh-asset-pack', schemaVersion:2, id, name:'Fixture pack', contentHash:'b'.repeat(64), figures:[omitted, kept], sprites:{}, bundles:{}, assets:[], blobs:{[hash]:{ext:'png', mime:'image/png', size:png.length}}, files:[]}
  const figure = (id, name, avatar) => ({id, name, aliases:[], outfits:[], ...(avatar ? {avatar} : {})})
  const ref = figureId => ({packId:id, figureId})
  const card = {spec:'chara_card_v3', spec_version:'3.0', data:{name:'Roundtrip', description:'Authored story', character_book:{entries:[{keys:['Removed'],comment:'speaker roster',content:omitted+' Removed\n'+kept+' Retained',enabled:true}]},
    assets:[{type:'icon',name:'main',ext:'png',uri:'embeded://assets/icon/images/main.png'}],
    extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[id]},speakers:[{name:'Removed',ref:ref(omitted)},{name:'Retained',ref:ref(kept)}],
      openings:{lead:ref(omitted),scenes:{primary:{greeting:'a'.repeat(16),background:null,timeOfDay:null,music:null,cast:[{figure:ref(omitted),outfitKey:null,emotion:'平静'},{figure:ref(kept),outfitKey:null,emotion:'平静'}]}}}}}}}
  const entries = [
    ['card.json',JSON.stringify(card)], ['dsh.json',JSON.stringify({format:'dshcard',formatVersion:1,packs:[{id,path:'assets/'+id+'/',format:'dsh-asset-pack',contentHash:manifest.contentHash}],plugins:[{name:'fixture-plugin',path:'plugins/fixture/'}],defaults:{stage:true,settings:{statusBarPlacement:'sidebar'}}})],
    ['assets/icon/images/main.png',png], ['assets/'+id+'/manifest.json',JSON.stringify(manifest)], ['assets/'+id+'/'+media,png],
    ['assets/'+id+'/figures/'+omitted+'.json',JSON.stringify(figure(omitted,'Removed',hash))], ['assets/'+id+'/figures/'+kept+'.json',JSON.stringify(figure(kept,'Retained'))],
    ['plugins/fixture/package.json',JSON.stringify({name:'fixture-plugin',version:'1.0.0',main:'./index.mjs'})], ['plugins/fixture/index.mjs','export function apply() {}']
  ]
  manifest.files = entries.filter(([name]) => name.startsWith('assets/'+id+'/') && !name.endsWith('/manifest.json')).map(([name, content]) => ({path:name.slice(('assets/'+id+'/').length), size:Buffer.byteLength(content), sha256:createHash('sha256').update(content).digest('hex')}))
  entries.find(([name]) => name === 'assets/'+id+'/manifest.json')[1] = JSON.stringify(manifest)
  const source = join(root,'source.dshcard')
  await writeFile(source,writeZipEntries(entries.map(([path,content])=>({path,content}))))
  const imported = await files.importCardArchiveFile(source,'source.dshcard')
  const before = await fileResources.readText(imported.path)
  {
    const exported = await files.exportCardFile(imported.path,{excludeFigures:[omitted]})
    try {
      const zip = await openZipFile(exported.file)
      try {
        const archive = await readCardArchive(zip)
        assert.equal(archive.kind,'dshcard')
        assert.equal(archive.plugins[0].name,'fixture-plugin')
        assert.equal(JSON.parse(await zip.readBuffer(zip.entries.get('dsh.json'))).defaults.stage,true)
        assert.equal(archive.card.data.extensions.dsh_tavern.stage.enabled,true)
        assert.equal(archive.defaults.settings.statusBarPlacement,'sidebar')
        assert.equal(JSON.stringify(archive.card).includes(omitted),false)
        assert.equal(zip.entries.has('assets/'+id+'/'+media),false)
        assert.equal(zip.entries.has('assets/'+id+'/figures/'+omitted+'.json'),false)
        assert.ok(zip.entries.has('assets/'+id+'/figures/'+kept+'.json'))
        assert.equal(archive.card.data.extensions.dsh_tavern.openings.scenes.primary.cast.length,1)
      } finally { await zip.close() }
      const target = await files.importCardArchiveFile(exported.file,'copy.dshcard')
      assert.equal(target.plugins[0].enabled,true)
      assert.equal(target.packs.length,1)
    } finally { await exported.dispose() }
  }
  await assert.rejects(files.exportCardFile(imported.path,{packIds:['44444444-4444-4444-8444-444444444444']}), error => error.code === 'TAVERN_EXPORT_INVALID')
  await assert.rejects(files.exportCardFile(imported.path,{packIds:'all'}), error => error.code === 'TAVERN_EXPORT_INVALID')
  assert.equal(await fileResources.readText(imported.path),before)
})

test('invalid card plugin identity fails before persistence; retries stay failures and a corrected archive imports normally', async t => {
  const { root, files, fileResources, castAssets } = await library(t)
  const archive = join(root, 'legacy.dshcard')
  const writeArchive = async pkg => writeFile(archive, writeZipEntries([
    { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, plugins: [{ name: 'director', path: 'plugins/director/' }] }) },
    { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name: '旧插件卡', description: '回归' } }) },
    { path: 'plugins/director/package.json', content: JSON.stringify(pkg) },
    { path: 'plugins/director/index.mjs', content: 'export function apply() {}' },
  ]))
  await writeArchive({ name: 'director', main: './index.mjs' })
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(files.importCardArchiveFile(archive, 'legacy.dshcard'), error => error.code === 'TAVERN_CARD_ARCHIVE_INVALID' && /version/.test(error.message))
    assert.deepEqual(await fileResources.list('card'), [], 'failed import must not save a card or remembered duplicate')
  }
  await writeArchive({ name: 'director', version: '1.0.0', main: './index.mjs' })
  const imported = await files.importCardArchiveFile(archive, 'legacy.dshcard')
  assert.equal(imported.duplicate, undefined)
  assert.equal(imported.plugins[0].enabled, true)
  assert.equal((await castAssets.read(imported.path)).plugins[0].enabled, true)
  assert.equal((await files.importCardArchiveFile(archive, 'legacy.dshcard')).duplicate, true)
})


// The stage reads packs from the asset library: a card's packs install there too. A new pack is installed, an
// identical one left as it is; a different installed version is not touched but reported. Importing the very same
// file again still makes sure its packs are in the library (cards imported before the library carry none there).
test('DSH 人物卡的素材包装进素材库：新包安装、相同的不动、不同版本只提示；重复导入也补装', async t => {
  const { openZipFile } = await import('../tavern-plugin/lib/domain/zip-file.js')
  const fresh = '55555555-5555-4555-8555-555555555555', changed = '66666666-6666-4666-8666-666666666666'
  const installed = new Map([[changed, 'other-version']]), applied = []
  const assetLibrary = () => ({
    async inspectImportFile({ file }) {
      const zip = await openZipFile(file)
      try {
        const manifest = JSON.parse((await zip.readBuffer(zip.entries.get('manifest.json'), 65536)).toString())
        assert.ok(zip.entries.has('media/a.png'), 'the pack is re-rooted: its own files at the top')
        const choices = !installed.has(manifest.id) ? ['install', 'keep-both', 'cancel'] : installed.get(manifest.id) === manifest.contentHash ? ['noop', 'cancel'] : ['update', 'keep-both', 'cancel']
        return { inspectionId: manifest.id, packId: manifest.id, contentHash: manifest.contentHash, expectedRevision: null, choices, scriptRisk: [] }
      } finally { await zip.close() }
    },
    async applyImport({ inspectionId, decision }) {
      applied.push([inspectionId, decision])
      if (decision === 'install') installed.set(inspectionId, 'v1')
      return { status: decision }
    },
  })
  const { root, files } = await library(t, { assetLibrary })
  const card = join(root, '鱼.dshcard')
  const pack = (id, name) => [[`assets/${name}/manifest.json`, JSON.stringify({ id, contentHash: 'v1' })], [`assets/${name}/media/a.png`, 'png']]
  await writeFile(card, writeZipEntries([
    { path: 'dsh.json', content: JSON.stringify({ format: 'dshcard', formatVersion: 1, packs: [{ id: fresh, path: 'assets/new/', title: '新包' }, { id: changed, path: 'assets/old/', title: '旧包' }] }) },
    { path: 'card.json', content: JSON.stringify({ spec: 'chara_card_v3', data: { name: '鱼' } }) },
    ...[...pack(fresh, 'new'), ...pack(changed, 'old')].map(([path, content]) => ({ path, content })),
  ]))
  const first = await files.importCardArchiveFile(card, '鱼.dshcard')
  assert.deepEqual(applied, [[fresh, 'install'], [changed, 'cancel']])
  assert.match(first.libraryNotices.join(''), /旧包.*不同的版本/)
  applied.length = 0
  const again = await files.importCardArchiveFile(card, '鱼.dshcard')
  assert.equal(again.duplicate, true)
  assert.deepEqual(applied, [[fresh, 'noop'], [changed, 'cancel']], 'the same file again checks its packs')
})


test('manual replacement keeps the selected path and identity across JSON and PNG, with a usable backup', async t => {
  const { files, fileResources } = await library(t)
  const original = await files.importCard({kind:'text',name:'old.json',text:JSON.stringify({name:'Old',description:'before'})})
  const id = (await fileResources.readCard(original.path)).meta.id
  const updated = await files.replaceCard(original.path,{payload:{kind:'text',name:'different.json',text:JSON.stringify({name:'New',description:'after'})}})
  assert.equal(updated.path,original.path)
  assert.equal((await fileResources.readCard(original.path)).meta.id,id)
  assert.deepEqual(await fileResources.list('card'),[original.path])
  const backup = await openZipFile(updated.backupPath)
  try { assert.equal((await readCardArchive(backup)).card.data.name,'Old') } finally { await backup.close() }
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8V8AAAAASUVORK5CYII=','base64')
  const text=JSON.stringify({name:'PNG replacement'})
  await files.replaceCard(original.path,{payload:{kind:'png',name:'another.png',text,b64:Buffer.from(text).toString('base64'),fileB64:pngWithCard(image,text).toString('base64')}})
  assert.ok(await fileResources.readCardImage(original.path))
  await assert.rejects(files.replaceCard(original.path,{payload:{kind:'text',name:'bad.json',text:'{broken'}}))
  assert.equal((await fileResources.readCard(original.path)).raw.name,'PNG replacement')
})

test('dshcard replacement preserves disabled plugins and rolls back a post-write failure', async t => {
  let fail=false
  const {root,files,fileResources,castAssets}=await library(t,{importPreset:async()=>{if(fail)throw Error('injected preset failure');return {path:'presets/default.json'}},presetLibrary:{catalog:async()=>({presets:[]})}})
  const archive=join(root,'update.dshcard')
  async function write(version,defaults) {
    await writeFile(archive,writeZipEntries([
      {path:'card.json',content:JSON.stringify({spec:'chara_card_v3',data:{name:'Version '+version}})},
      {path:'dsh.json',content:JSON.stringify({format:'dshcard',formatVersion:1,plugins:[{name:'update-game',path:'plugins/game/'}],...(defaults?{defaults:{preset:{path:'presets/default.json'}}}:{})})},
      {path:'plugins/game/package.json',content:JSON.stringify({name:'update-game',version:version+'.0.0'})},
      {path:'plugins/game/index.mjs',content:'export function apply() {}'},
      ...(defaults?[{path:'presets/default.json',content:JSON.stringify({name:'Default',prompts:[]})}]:[])
    ]))
  }
  await write(1)
  const old=await files.importCardArchiveFile(archive,'one.dshcard')
  const oldId=(await fileResources.readCard(old.path)).meta.id
  const plugin=(await castAssets.read(old.path)).plugins[0]
  await castAssets.setPlugins(old.path,[{...plugin,enabled:false}])
  await write(2)
  await files.replaceCard(old.path,{file:archive,name:'two.dshcard'})
  assert.equal((await fileResources.readCard(old.path)).raw.data.name,'Version 2')
  assert.equal((await castAssets.read(old.path)).plugins[0].enabled,false)
  assert.equal((await fileResources.readCard(old.path)).meta.id,oldId)
  fail=true; await write(3,true)
  await assert.rejects(files.replaceCard(old.path,{file:archive,name:'three.dshcard'}),/已恢复原卡/)
  assert.equal((await fileResources.readCard(old.path)).raw.data.name,'Version 2')
  assert.equal((await castAssets.read(old.path)).plugins[0].enabled,false)
  assert.deepEqual(await fileResources.list('card'),[old.path])
})


test('browser updates a selected card through the sidebar and real import RPC', { skip: !process.env.TAVERN_BROWSER_CHANNEL, timeout:60000 }, async t => {
  const {createServer}=await import('node:http')
  const {createRequire}=await import('node:module')
  const {dirname}=await import('node:path')
  const {chromium}=await import('playwright')
  const {createCardHandlers}=await import('../tavern-plugin/lib/rpc/cards.js')
  const {root,files,fileResources}=await library(t)
  const old=await files.importCard({kind:'text',name:'selected.json',text:JSON.stringify({name:'Old'})})
  const handlers=createCardHandlers({...files,str:String,uploads:{take:async()=>({file:join(root,'upload'),remove:async()=>{}})}})
  const sidebar=await readFile(new URL('../tavern-plugin/src/client/features/sidebar.js',import.meta.url),'utf8')
  const main=await readFile(new URL('../tavern-plugin/src/client/main.js',import.meta.url),'utf8')
  const states=sidebar.slice(sidebar.indexOf('const [updatingCard,'),sidebar.indexOf('const updateInput ='))+'const updateInput = React.useRef(null);'
  const action=sidebar.slice(sidebar.indexOf('async function replaceSelectedCard()'),sidebar.indexOf('async function importCard(file)'))
  const start=sidebar.indexOf("h('input',{ref:updateInput")
  const controls=sidebar.slice(start,sidebar.indexOf('h("div", { className: "dsh-tavern-side-title',start)).trim().replace(/,$/,'')
  const updateButton=sidebar.slice(sidebar.indexOf("organization.toolbar(h('button'"),sidebar.indexOf("organization.visible.length ?")).trim().replace(/,$/,'')
  const importer=main.slice(main.indexOf('async function importTavernCardFile('),main.indexOf('/** What a card file'))
  const parser=main.slice(main.indexOf('function parseCardFile('),main.indexOf('const MOBILE_IMPORT_SORTS'))
  const require=createRequire(import.meta.url);let bundle='const modules={};'
  for(const [name,file] of [['react','react.production.js'],['scheduler','scheduler.production.js'],['react-dom','react-dom.production.js'],['react-dom/client','react-dom-client.production.js']]) bundle+='modules['+JSON.stringify(name)+']=(()=>{const module={exports:{}};const exports=module.exports;const require=n=>modules[n];'+await readFile(join(dirname(require.resolve(name)),'cjs',file),'utf8')+';return module.exports;})();'
  const script=bundle+`const React=modules.react,h=React.createElement;
  const beginTavernCardImportProgress=()=>({update(){},close(){}}),importTavernPasswordCard=run=>run();
  async function call(method,args){const r=await fetch('/rpc/'+method,{method:'POST',body:JSON.stringify(args)}).then(r=>r.json());if(!r.ok)throw Error(r.error);return r;}
  ${importer}
${parser}
  function App(){const [busy,setBusy]=React.useState(false);const cards=[{path:'selected.json'.replace(/^/,'cards/'),name:'Old'}],openingPicker=null;const refresh=async()=>{},notifyDataChanged=()=>{};
  const cardBatch={paths:cards.map(card=>card.path)},organization={toolbar:button=>button};
  ${states}
${action}
  return h('aside',null,${updateButton},${controls});}
  modules['react-dom/client'].createRoot(document.getElementById('app')).render(h(App));`
  const css=await readFile(new URL('../tavern-plugin/lib/client-assets/tavern.css',import.meta.url),'utf8')
  const server=createServer(async(req,res)=>{try{
    if(req.url==='/')return res.writeHead(200,{'content-type':'text/html; charset=utf-8'}).end('<meta charset="utf-8"><style>'+css+'</style><div id="app"></div><script src="/app.js"></script>')
    if(req.url==='/app.js')return res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'}).end(script)
    const chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks)
    if(req.url==='/api/dsh-tavern/card-upload'){await writeFile(join(root,'upload'),bytes);return res.end(JSON.stringify({ok:true,uploadId:'fixture'}))}
    const result=await handlers[req.url.split('/').at(-1)](JSON.parse(bytes.toString()));res.end(JSON.stringify({ok:true,...result}))
  }catch(e){res.end(JSON.stringify({ok:false,error:e.message}))}})
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)))
  const browser=await chromium.launch({channel:process.env.TAVERN_BROWSER_CHANNEL,headless:true});t.after(()=>browser.close())
  const page=await browser.newPage({viewport:{width:1000,height:760}});page.setDefaultTimeout(10000)
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('http://127.0.0.1:'+server.address().port)
  await page.getByRole('button',{name:'更新',exact:true}).click().catch(e=>{throw new Error(errors.join('; ') || e.message)})
  await page.locator('input[type=file]').setInputFiles({name:'new.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({name:'Updated JSON'}))})
  await page.getByRole('button',{name:'更新并替换'}).click()
  await page.getByRole('status').filter({hasText:'更新完成'}).waitFor()
  assert.equal((await fileResources.readCard(old.path)).raw.name,'Updated JSON')
  const bytes=writeZipEntries([{path:'card.json',content:JSON.stringify({spec:'chara_card_v3',data:{name:'Updated archive'}})}])
  await page.locator('input[type=file]').setInputFiles({name:'different.charx',mimeType:'application/zip',buffer:bytes})
  await page.getByRole('button',{name:'更新并替换'}).click()
  await page.getByRole('status').filter({hasText:'更新完成'}).waitFor()
  assert.equal((await fileResources.readCard(old.path)).raw.data.name,'Updated archive')
  assert.deepEqual(await fileResources.list('card'),[old.path]);assert.deepEqual(errors,[])
  await page.screenshot({path:join(process.cwd(),'output/card-update-browser.png'),fullPage:true})
})
