import { createCardPlugins } from '../tavern-plugin/lib/domain/card-plugins.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { castManifestPath } from '../tavern-plugin/lib/domain/cast-assets.js'
import { Context } from '@deepseek-ai/cordis'
import { pathToFileURL } from 'node:url'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { syncUserPlugins, readPatchedUserPlugins, reconcileUserPluginsAtStartup, reloadUpdatedCardPlugins, loaderReload, runningUserPlugins } from '../tavern-plugin/lib/domain/user-plugins.js'
import { nativeSettingsProfile } from './fixtures/native-settings-profile.mjs'

const cardPath = 'cards/card-id-a.json'
const otherCardPath = 'cards/card-id-b.json'
const name = 'dsh-tavern-mod-dice'
const folder = letter => `card-${name}-${letter.repeat(12)}`

async function fixture(t) {
  const dshHome = await mkdtemp(path.join(tmpdir(), 'card-binding-'))
  t.after(() => rm(dshHome, { recursive: true, force: true }))
  const dataRoot = path.join(dshHome, 'profile-data', 'tavern', 'data')
  const profile = path.join(dshHome, 'profiles', 'tavern')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), '{}')
  for (const letter of ['a', 'b']) {
    const dir = path.join(dataRoot, 'plugins', folder(letter))
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0',
      exports:{'.':'./index.mjs','./client':'./client.js'},dsh:{client:{platform:'web'}} }))
    await writeFile(path.join(dir, 'index.mjs'), `import {version} from './version.mjs'; export const name = '${name}'; export function apply(ctx) { ctx.provide('bindingVersion', version) }`)
    await writeFile(path.join(dir, 'version.mjs'), `export const version = '${letter}'`)
    await writeFile(path.join(dir, 'client.js'), `window.__bindingVersion = '${letter}';`)
    await writeFile(path.join(dir, '.dsh-card.json'), JSON.stringify({ cards: [cardPath], sha256: letter.repeat(64) }))
  }
  const bind = async (letter, enabled = true, targetCard = cardPath) => {
    const file = castManifestPath(dataRoot, targetCard)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ version: 1, name: '夏日小镇', characters: [], plugins: [{ folder: 'dice', name, sha256: letter.repeat(64), enabled }] }))
  }
  const sync = options => syncUserPlugins({ dataRoot, dshHome, logger: { warn() {} }, cardPaths: async () => [cardPath, otherCardPath], ...options })
  return { dataRoot, dshHome, bind, sync, patch: path.join(profile, 'cordis.patch.yml') }
}


test('真实 Cordis 身份：启动纠正旧 patch，绑定切换重启前拒绝，重启后加载新版', async t => {
  const f = await fixture(t)
  await f.bind('a')
  await f.sync()
  const loaded = await readPatchedUserPlugins(f)
  await f.bind('b')
  const service = createCardPlugins({ dataRoot:f.dataRoot, pluginsDir:path.join(f.dataRoot, 'plugins'), cardPaths:async () => [cardPath, otherCardPath] })
  const root = new Context()
  t.after(() => root.fiber.dispose())
  const api = createTavernPluginApi({ ctx:root, runningUserPlugins, cardScope:() => service.scope(),
    cardPathOf:async () => cardPath,
    listCards:async () => [{path:cardPath, name:'夏日小镇'}], readCardRaw:async () => ({name:'夏日小镇'}) })
  const caller = Object.assign(Object.create(api.service), {ctx:{fiber:{name}}})
  let active, options = {name:pathToFileURL([...loaded.values()][0]).href}
  const start = async () => { active = root.plugin(await import(options.name)); await active.await() }
  await start()
  assert.equal(root.get('bindingVersion'), 'a', 'stale patch really started version a')
  const loader = {
    locate:() => 'tavern',
    resolve:() => ({update:async patch => {
      options = {...options, ...patch}
      if (patch.disabled === true) { await active.dispose(); active = null }
      else if (patch.disabled === null) await start()
    }})
  }
  const reload = loaderReload(loader, {})
  await reconcileUserPluginsAtStartup({result:await f.sync(), loaded, reload})
  assert.equal(root.get('bindingVersion'), 'b', 'startup reconciles the actual Cordis plugin, not only YAML')
  assert.deepEqual((await caller.listCards()).map(c => c.id), [cardPath])
  assert.equal((await caller.readCardRaw({card:cardPath})).name, '夏日小镇')
  await f.bind('a')
  const next = await f.sync()
  assert.equal(root.get('bindingVersion'), 'b', 'runtime sync must not hot swap')
  assert.deepEqual(await caller.listCards(), [])
  await assert.rejects(caller.readCardRaw({card:cardPath}), {code:'TAVERN_PLUGIN_SCOPE'})
  await reconcileUserPluginsAtStartup({result:next, loaded, reload})
  assert.equal(root.get('bindingVersion'), 'a')
  assert.deepEqual((await caller.listCards()).map(c => c.id), [cardPath])
  for (const target of ['.dsh-card.json', '']) {
    await rm(path.join(f.dataRoot, 'plugins', folder('a'), target), {recursive:true})
    assert.deepEqual((await f.sync()).plugins, [])
    assert.equal(root.get('bindingVersion'), 'a', 'old instance remains but loses all card access')
    assert.deepEqual(await caller.listCards(), [])
    await assert.rejects(caller.readCardRaw({card:cardPath}), {code:'TAVERN_PLUGIN_SCOPE'})
  }
})

test('真实 DSH 加载器在同一进程重载已提交的卡内插件和它的依赖', async t => {
  const f = await fixture(t)
  await f.bind('a')
  const initial = await f.sync()
  const [{id, entry}] = initial.plugins
  const loaded = await readPatchedUserPlugins(f)
  const {ctx, ownerId} = await nativeSettingsProfile(t, {settings:false,
    ownerSource:'export function apply() {}', extraRows:[{id:'client-modules', name:'@deepseek-ai/dsh-client-modules'}, {id, name:pathToFileURL(entry).href}]})
  const owner = [...ctx.loader.entries()].find(row => row.options.id === ownerId).fiber
  const oldFiber = [...ctx.loader.entries()].find(row => row.options.id === id).fiber
  assert.equal(ctx.get('bindingVersion'), 'a')
  const clientModules = ctx.get('clientModules')
  const clientEntry = () => clientModules.graph().entries.find(row => row.id === name)
  const originalClient = clientEntry()
  assert.ok(originalClient)
  const reload = loaderReload(ctx.loader, owner)
  await f.bind('b')
  await f.bind('a', true, otherCardPath)
  assert.deepEqual(await reloadUpdatedCardPlugins({result:await f.sync(), names:[name], loaded, reload}),
    {reloaded:[], restartRequired:[name]})
  assert.equal(ctx.get('bindingVersion'), 'a')
  await f.bind('a', false, otherCardPath)
  const committed = await f.sync({beforePatch:async result => {
    assert.deepEqual(await reloadUpdatedCardPlugins({result, names:[name], loaded, reload}),
      {reloaded:[name], restartRequired:[]})
  }})
  assert.equal(ctx.get('bindingVersion'), 'b')
  await ctx.loader.await()
  assert.notEqual(clientEntry().rev, originalClient.rev, 'The same process publishes the new browser bundle')
  assert.match(await readFile(clientModules.clientPath(name),'utf8'), /__bindingVersion = 'b'/)
  assert.equal(oldFiber.uid, null)
  assert.equal(loaded.get(id), committed.plugins[0].entry)
  assert.deepEqual(await reloadUpdatedCardPlugins({result:committed, names:[name], loaded,
    reload:() => assert.fail('Already loaded; no duplicate restart')}), {reloaded:[name], restartRequired:[]})
})
