import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, cp, readFile, writeFile, rm, access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

test('built client registers its module and owns one disposable library tab', async () => {
  let descriptor
  vm.runInNewContext(await readFile(new URL('../lib/client.cjs', import.meta.url), 'utf8'), {
    window: {__ModuleLoader__: {load(value) { descriptor = value }}},
  })
  assert.equal(descriptor.id, 'dsh-asset-library')
  const client = descriptor.factory(() => { throw new Error('Unexpected client dependency') })
  const tabs = [], effects = []
  client.apply({
    effect(fn) { effects.push(fn()) },
    get(name) { return name === 'betterSidebar' ? {registerTab(tab) { tabs.push(tab); return () => tabs.pop() }} : {render: props => props} },
  })
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, 'dsh-asset-library:library')
  const props = {}
  assert.equal(tabs[0].component(props), props)
  effects.forEach(stop => stop())
  assert.equal(tabs.length, 0)
})

test('source-stripped artifact imports and serves only v2 packs from an isolated home', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'asset-package-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(manifest.license, 'AGPL-3.0-only')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.exports['./client'], './lib/client.cjs')
  assert.equal(manifest.types, 'lib/index.d.ts')
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest))
  await cp(new URL('../lib/', import.meta.url), path.join(root, 'lib'), {recursive:true})
  await assert.rejects(access(path.join(root, 'src')), {code:'ENOENT'})
  const plugin = await import(pathToFileURL(path.join(root, 'lib/index.js')))
  const data = path.join(root, 'isolated-home/profile-data/test/asset-packs')
  assert.equal(plugin.createAssetLibrary, undefined)
  const service = plugin.createAssetPackService({assetRoot:data})
  assert.deepEqual(await service.listPacks(), [])
  assert.equal(service.apiVersion, 2)
  for (const name of ['listLibraries','registerTavernAdapter','getPlan','patchPlan','patchSources','readStage','storage']) assert.equal(service[name], undefined)
  await service.dispose()
  for (const name of ['client.js','service.js','routes.js','contracts.d.ts','borrowed-assets.js','card-pack.js','library-pack.js','model-library.js','domain/asset-sources.js','domain/card-asset-plan.js']) await assert.rejects(access(path.join(root, 'lib', name)), {code:'ENOENT'})
})
test('runtime source contains no Tavern imports, legacy media routes, resource-card scans or stage director policy', async () => {
  async function walk(directory) {
    for (const item of await readdir(directory, {withFileTypes:true})) {
      const target = new URL(item.name + (item.isDirectory() ? '/' : ''), directory)
      if (item.isDirectory()) await walk(target)
      else if (/\.[cm]?js$/.test(item.name)) {
        const text = await readFile(target, 'utf8')
        assert.doesNotMatch(text, /(?:from|require\()\s*['"][^'"]*(?:tavern-plugin|dsh-tavern|\.\.\/\.\.\/\.\.)/)
        assert.doesNotMatch(text, /\/api\/dsh-tavern\/|\/api\/dsh-asset-library\/v1\/|resources\/cards|selectDirectorCatalogue|resolveDirectionRules/)
      }
    }
  }
  await walk(new URL('../src/', import.meta.url))
})

test('P0 contracts import from a source-stripped standalone artifact without sibling packages', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'asset-contract-package-'))
  t.after(() => rm(root, {recursive:true, force:true}))
  await writeFile(path.join(root, 'package.json'), JSON.stringify({type:'module'}))
  await cp(new URL('../lib/', import.meta.url), path.join(root, 'lib'), {recursive:true})
  const contracts = await import(pathToFileURL(path.join(root, 'lib/asset-packs/index.js')))
  const manifest = {format:'dsh-asset-pack', schemaVersion:1, id:'11111111-1111-4111-8111-111111111111', name:'Isolated', contentHash:'0'.repeat(64), assets:[], figures:[], sprites:{}, bundles:{}, blobs:{}, files:[]}
  manifest.contentHash = await contracts.computeContentHash(manifest)
  await contracts.verifyPackDocuments({manifest, figures:{}, sprites:{}})
  await assert.rejects(access(path.join(root, 'node_modules')), {code:'ENOENT'})
})
