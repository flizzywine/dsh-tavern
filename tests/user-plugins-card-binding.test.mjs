import { createCardPlugins } from '../tavern-plugin/lib/domain/card-plugins.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { castManifestPath } from '../tavern-plugin/lib/domain/cast-assets.js'
import { Context } from '@deepseek-ai/cordis'
import { pathToFileURL } from 'node:url'
import { createTavernPluginApi } from '../tavern-plugin/lib/plugin-api.js'
import { syncUserPlugins, readPatchedUserPlugins, reconcileUserPluginsAtStartup, loaderReload, registerRunningUserPlugin, runningUserPlugins } from '../tavern-plugin/lib/domain/user-plugins.js'

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

test('权威绑定选择并存版本、切换和缺失；无绑定及停用绑定保持原行为', async t => {
  const f = await fixture(t)
  let result = await f.sync()
  assert.deepEqual(result.plugins.map(p => p.folder), [folder('a')])
  assert.equal(result.problems[0].reason, '插件名与其他插件重复')
  await f.bind('b')
  result = await f.sync()
  assert.deepEqual(result.plugins.map(p => p.folder), [folder('b')])
  assert.equal(result.problems[0].folder, folder('a'))
  await f.bind('a')
  assert.deepEqual((await f.sync()).plugins.map(p => p.folder), [folder('a')])
  await f.bind('c')
  assert.deepEqual((await f.sync()).plugins, [])
  assert.equal((await readPatchedUserPlugins(f)).size, 0)
  await f.bind('b', false)
  result = await f.sync()
  assert.deepEqual(result.plugins.map(p => p.folder), [folder('a')])
  assert.equal(result.problems[0].reason, '插件名与其他插件重复')
})

test('更新 journal 打开时不改 patch；confirm/recover 的生产接线在成功后同步绑定', async t => {
  const f = await fixture(t)
  await f.sync()
  const before = await readFile(f.patch)
  const cardPluginJournal = path.join(f.dataRoot, 'update.journal.json')
  await writeFile(cardPluginJournal, '{}')
  const cardPluginUpdatePending = () => existsSync(cardPluginJournal)
  await f.bind('b')
  assert.deepEqual(await f.sync({ pending: cardPluginUpdatePending }), { pending: true, plugins: [], problems: [] })
  assert.deepEqual(await readFile(f.patch), before)
  await rm(cardPluginJournal)


})


test('权威卡 A 启用 a、B 停用 b：旧 marker 不授权，scope 随绑定切换', async t => {
  const f = await fixture(t)
  const pluginsDir = path.join(f.dataRoot, 'plugins')
  await writeFile(path.join(pluginsDir, folder('a'), '.dsh-card.json'), JSON.stringify({cards:[otherCardPath], sha256:'a'.repeat(64)}))
  await writeFile(path.join(pluginsDir, folder('b'), '.dsh-card.json'), JSON.stringify({cards:[otherCardPath], sha256:'b'.repeat(64)}))
  const service = createCardPlugins({dataRoot:f.dataRoot, pluginsDir, cardPaths:async () => [cardPath, otherCardPath]})
  await f.bind('b', false, otherCardPath)
  for (const letter of ['a', 'b', 'a']) {
    await f.bind(letter)
    t.after(registerRunningUserPlugin(name, {folder:folder(letter), sha256:letter.repeat(64), origin:'card', cardIds:[cardPath], runtimeName:name}))
    assert.deepEqual((await f.sync()).plugins.map(p => p.folder), [folder(letter)])
    assert.deepEqual([...(await service.scope())], [[name, {cards:[cardPath], folder:folder(letter)}]])
  }
  assert.deepEqual((await f.sync({cardPaths:async () => []})).plugins.map(p => p.folder), [folder('a')])
})

test('绑定目录或 marker 缺失不退回同名旧目录，并记录诊断', async t => {
  const f = await fixture(t)
  const pluginsDir = path.join(f.dataRoot, 'plugins')
  const service = createCardPlugins({dataRoot:f.dataRoot, pluginsDir, cardPaths:async () => [cardPath]})
  await f.bind('a')
  await rm(path.join(pluginsDir, folder('a'), '.dsh-card.json'))
  let result = await f.sync()
  assert.deepEqual(result.plugins, [])
  assert.ok(result.problems.some(p => p.folder === name && p.reason.includes('没有可用对应目录')))
  assert.deepEqual((await service.scope()).get(name), {cards:[], folder:null})
  await rm(path.join(pluginsDir, folder('a')), {recursive:true})
  result = await f.sync()
  assert.deepEqual(result.plugins, [])
  assert.ok(result.problems.some(p => p.folder === name))
  assert.deepEqual((await service.scope()).get(name), {cards:[], folder:null})
})

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

async function bootUpgrade(t, renamed) {
  const f = await fixture(t)
  await f.bind('a')
  const runtimeName = renamed ? 'upgrade-runtime-dice' : name
  await writeFile(path.join(f.dataRoot, 'plugins', folder('a'), 'index.mjs'),
    `export const name = '${runtimeName}'; export function apply(ctx) { ctx.provide('bindingVersion', 'legacy-a'); ctx.provide('bindingContext', ctx) }`)

  const old = await import('./user-plugins-legacy.fixture.mjs')
  const oldResult = await old.syncUserPlugins({ ...f, logger:{warn() {}} })
  const loaded = await old.readPatchedUserPlugins(f)
  const entry = [...loaded.values()][0]
  assert.equal(oldResult.plugins[0].folder, folder('a'))
  assert.equal(await readFile(entry, 'utf8'), await readFile(new URL('./user-plugins-upgrade-old-guard.fixture.mjs', import.meta.url), 'utf8'))

  // Candidate's first process-local boot uses the existing profile, not a candidate-generated guard.
  // The user-plugin sibling applies before Tavern's startup sync; no Desktop ordering claim is made.
  const root = new Context()
  t.after(() => root.fiber.dispose())
  let active
  const start = async target => {
    active = root.plugin(await import(pathToFileURL(target).href))
    await active.await()
  }
  await start(entry)
  assert.equal(root.get('bindingVersion'), 'legacy-a')
  assert.equal(root.get('bindingContext').fiber.name, runtimeName)
  const result = await f.sync()
  let reloads = 0
  await reconcileUserPluginsAtStartup({ result, loaded, reload:async (_id, target) => {
    reloads += 1
    await active.dispose()
    await start(target)
  } })
  const service = createCardPlugins({ dataRoot:f.dataRoot, pluginsDir:path.join(f.dataRoot, 'plugins'), cardPaths:async () => [cardPath, otherCardPath] })
  const scopes = await service.scope()
  const api = createTavernPluginApi({ ctx:root, runningUserPlugins, cardScope:() => service.scope(),
    listCards:async () => [{path:cardPath, name:'夏日小镇'}, {path:otherCardPath, name:'隔离测试卡'}],
    readCardRaw:async card => ({name:'隔离测试卡', path:card}) })
  // Use the context captured by the actual child apply, not an invented fiber name.
  const caller = Object.assign(Object.create(api.service), {ctx:root.get('bindingContext')})
  const visible = (await caller.listCards()).map(card => card.id)
  const raw = await caller.readCardRaw({card:otherCardPath}).then(value => ({allowed:true, value}), error => ({allowed:false, code:error.code}))
  const evidence = { runtimeName, actualVersion:root.get('bindingVersion'),
    oldGuardGenerated:true, sameEntry:entry === result.plugins[0].entry,
    guardRewritten:(await readFile(entry, 'utf8')).includes('registerRunningUserPlugin'),
    reloads, runningIdentity:runningUserPlugins.get(name) ?? null, scopes:[...scopes], visible, raw }
  t.diagnostic(JSON.stringify(evidence))
  return { ...evidence, scopes }
}

// Separate temporary profiles and Cordis roots ensure one red assertion cannot skip another path.
test('进程内升级 A：同路径旧 guard 必须完成运行身份协调', async t => {
  const result = await bootUpgrade(t, false)
  assert.ok(result.runningIdentity, 'same-path old guard must acquire a running identity during startup')
})

test('进程内升级 B：不同 runtimeName 必须保留卡 scope', async t => {
  const result = await bootUpgrade(t, true)
  assert.ok(result.scopes.has(result.runtimeName), 'actual Cordis runtime name must retain its card scope')
})

test('进程内升级 C：无 scope 不得把卡内插件当全局插件', async t => {
  const result = await bootUpgrade(t, true)
  assert.deepEqual({ otherCardVisible:result.visible.includes(otherCardPath), raw:result.raw },
    { otherCardVisible:false, raw:{allowed:false, code:'TAVERN_PLUGIN_SCOPE'} })
})
