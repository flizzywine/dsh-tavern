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
import { syncUserPlugins, readPatchedUserPlugins, reconcileUserPluginsAtStartup, loaderReload, runningUserPlugins } from '../tavern-plugin/lib/domain/user-plugins.js'

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
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.mjs' }))
    await writeFile(path.join(dir, 'index.mjs'), `export const name = '${name}'; export function apply(ctx) { ctx.provide('bindingVersion', '${letter}') }`)
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
      if (patch.disabled === true) assert.equal(patch.name, undefined, 'dispose with the old Loader source name')
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

test('只迁移旧入口，正常入口在插件尚未启动时也不重新登记', async t => {
  const f = await fixture(t)
  await f.bind('a')
  await f.sync()
  const loaded = await readPatchedUserPlugins(f)
  const entry = [...loaded.values()][0]
  const reloads = []
  const reload = async (_id, next) => reloads.push(next)
  await reconcileUserPluginsAtStartup({ result: await f.sync(), loaded, reload })
  assert.deepEqual(reloads, [])

  const current = await readFile(entry, 'utf8')
  await writeFile(entry, 'export function apply() {}\n')
  await reconcileUserPluginsAtStartup({ result: await f.sync(), loaded, reload })
  assert.deepEqual(reloads, [path.join(path.dirname(entry), '.tavern-entry.identity.mjs')])
  assert.equal(await readFile(entry, 'utf8'), current)
})
