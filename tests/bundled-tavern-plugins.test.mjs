// 随酒馆发行、但身份是「酒馆插件」的内置插件：装进 <data>/plugins，插件页才列得出来。
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { SOURCE_FILE } from '../bin/bundled-tavern-plugins.mjs'
import { syncBundledTavernPlugins } from '../bin/service-lifecycle.mjs'
import { createUserPluginInstaller } from '../tavern-plugin/lib/domain/user-plugin-install.js'
import { DISABLED_FILE, RESTART_FILE, syncUserPlugins } from '../tavern-plugin/lib/domain/user-plugins.js'
import { TAVERN_PLUGIN_API_VERSION } from '../tavern-plugin/lib/domain/plugin-manifest.js'
import { writeZipEntries } from '../tavern-plugin/lib/domain/zip-entries.js'
import { readAchievementLibrary } from '../tavern-plugin/packages/dsh-tavern/lib/achievements.mjs'
import { name as achievementPluginName } from '../tavern-plugin/packages/dsh-tavern-adventure-medal/lib/index.js'

const FOLDER = 'dsh-tavern-plot-compass'
const quiet = { warn() {}, log() {} }

function makeSource(t, { version = '1.0.0', folder = FOLDER, name = folder } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-plugin-src-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'tavern-plugin', 'packages', folder)
  mkdirSync(path.join(dir, 'lib'), { recursive: true })
  mkdirSync(path.join(dir, 'src', 'client'), { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name, version, type: 'module', main: 'lib/index.js',
    exports: { '.': './lib/index.js', './client': './client.js' },
    dsh: { compatibility: { tavernApiVersion: 8 } },
  }))
  writeFileSync(path.join(dir, 'cordis.patch.yml'), '- insert: []\n')
  writeFileSync(path.join(dir, 'lib', 'index.js'), 'export const bundled = ' + JSON.stringify(version) + '\n')
  writeFileSync(path.join(dir, 'client.js'), '// client ' + version + '\n')
  writeFileSync(path.join(dir, 'build.mjs'), '// build input\n')
  writeFileSync(path.join(dir, 'src', 'client', 'main.js'), '// source\n')
  return { root, dir }
}

test('服务启动同步函数会更新数据目录下的内置插件并在无改动时安静跳过', t => {
  const source = makeSource(t, { version: '1.0.0' })
  const dshHome = mkdtempSync(path.join(tmpdir(), 'tavern-service-home-'))
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const profileDir = path.join(dshHome, 'profiles', 'tavern')
  mkdirSync(profileDir, { recursive: true })

  const logs = []
  const logger = { log: message => logs.push(message), warn: message => logs.push(message) }
  const first = syncBundledTavernPlugins({ sourceRoot: source.root, dshHome, profileDir, logger })
  assert.equal(first[0].action, 'installed')
  assert.ok(logs.some(line => line.includes(`已内置插件 ${FOLDER} 1.0.0`)))

  logs.length = 0
  const second = syncBundledTavernPlugins({ sourceRoot: source.root, dshHome, profileDir, logger })
  assert.equal(second[0].action, 'skipped')
  assert.equal(logs.length, 0)

  writeFileSync(path.join(source.dir, 'client.js'), '// rebuilt client\n')
  const third = syncBundledTavernPlugins({ sourceRoot: source.root, dshHome, profileDir, logger })
  assert.equal(third[0].action, 'upgraded')
  assert.ok(logs.some(line => line.includes(`已同步内置插件 ${FOLDER}：已同步最新副本（1.0.0）`)))
  assert.equal(
    readFileSync(path.join(dshHome, 'profile-data', 'tavern', 'data', 'plugins', FOLDER, 'client.js'), 'utf8'),
    '// rebuilt client\n',
  )
})

test('startService 在拉起 DSH 进程前调用 syncBundledTavernPlugins', () => {
  const lifecycle = readFileSync(new URL('../bin/service-lifecycle.mjs', import.meta.url), 'utf8')
  const start = lifecycle.slice(lifecycle.indexOf('export async function startService('))
  const syncIndex = start.indexOf('syncBundledTavernPlugins()')
  const spawnIndex = start.indexOf('child = spawn(')
  assert.ok(syncIndex > 0, 'startService 应调用 syncBundledTavernPlugins()')
  assert.ok(spawnIndex > syncIndex, 'syncBundledTavernPlugins() 应在拉起进程前执行')
})

async function checkBundledLoadDefault(t, folder) {
  const source = makeSource(t, { folder })
  const dshHome = mkdtempSync(path.join(tmpdir(), 'tavern-service-home-'))
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const dataRoot = path.join(dshHome, 'profile-data', 'tavern', 'data')
  const profileDir = path.join(dshHome, 'profiles', 'tavern')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(path.join(profileDir, 'package.json'), '{}')

  const syncBundled = () => syncBundledTavernPlugins({ sourceRoot: source.root, dshHome, dataRoot, profileDir, logger: quiet })
    .find(item => item.packageName === folder)
  const sync = () => syncUserPlugins({ dataRoot, dshHome, logger: quiet })
  const installer = createUserPluginInstaller({ dataRoot, sync })
  const patch = path.join(profileDir, 'cordis.patch.yml')
  const patchHasPlugin = () => readFileSync(patch, 'utf8').includes(`tavern-user-plugin-${folder}`)
  const installed = syncBundled()
  assert.equal(installed.action, 'installed')
  assert.equal((await installer.list())[0].enabled, true)
  await sync()
  assert.equal(patchHasPlugin(), true)

  // Simulate the old installer's automatic marker without a change to the package digest.
  const sourceFile = path.join(installed.target, SOURCE_FILE)
  const recorded = JSON.parse(readFileSync(sourceFile, 'utf8'))
  const legacySource = JSON.stringify({ ...recorded, defaultDisabled: true })
  writeFileSync(sourceFile, legacySource)
  writeFileSync(path.join(installed.target, DISABLED_FILE), '')
  assert.equal((await installer.list())[0].state, 'disabled')
  assert.equal(syncBundled().action, 'upgraded')
  assert.equal((await installer.list())[0].enabled, true)
  assert.equal(syncBundled().action, 'skipped')

  // A manual disable must survive migration and later updates.
  await installer.disable(folder)
  writeFileSync(sourceFile, legacySource)
  assert.equal(syncBundled().action, 'upgraded')
  assert.equal((await installer.list())[0].state, 'disabled')
  assert.deepEqual((await sync()).plugins, [])
  assert.equal(patchHasPlugin(), false)

  writeFileSync(path.join(source.dir, 'client.js'), '// updated client\n')
  assert.equal(syncBundled().action, 'upgraded')
  assert.equal((await installer.list())[0].state, 'disabled')
}

for (const folder of ['dsh-tavern-fate-dice', 'dsh-tavern-plot-compass', 'dsh-tavern-story-director']) {
  test(`${folder} 默认加载，迁移旧版自动停用标记并保留手动停用`, t => checkBundledLoadDefault(t, folder))
}

test('发行副本默认启用，同名成就 ZIP 就地升级并保留记录和停用状态', async t => {
  const sourceRoot = new URL('..', import.meta.url)
  const dshHome = mkdtempSync(path.join(tmpdir(), 'tavern-achievement-bundle-'))
  t.after(() => rmSync(dshHome, { recursive: true, force: true }))
  const dataRoot = path.join(dshHome, 'profile-data', 'tavern', 'data')
  const profileDir = path.join(dshHome, 'profiles', 'tavern')
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(path.join(profileDir, 'package.json'), '{}')
  const sync = () => syncUserPlugins({ dataRoot, dshHome, logger: quiet })
  const installer = createUserPluginInstaller({ dataRoot, sync })
  const bundled = () => syncBundledTavernPlugins({ sourceRoot: fileURLToPath(sourceRoot), dshHome, dataRoot, profileDir, logger: quiet })
    .find(item => item.packageName === achievementPluginName)
  const listed = async () => (await installer.list()).find(item => item.name === achievementPluginName)
  const registered = async () => (await sync()).plugins.filter(plugin => plugin.name === achievementPluginName)
  const fresh = bundled()
  assert.equal(fresh.action, 'installed')
  assert.equal((await listed()).source.kind, 'builtin')
  assert.equal((await listed()).enabled, true)
  assert.deepEqual((await registered()).map(plugin => plugin.main), ['./lib/index.js'])

  // Replace the fixture with a previously installed ZIP in the same plugin slot.
  rmSync(fresh.target, { recursive: true })
  const manifest = JSON.parse(readFileSync(new URL('tavern-plugin/packages/dsh-tavern-adventure-medal/package.json', sourceRoot), 'utf8'))
  const archive = writeZipEntries([
    { path: 'package.json', content: JSON.stringify({ ...manifest, version: '2.8.4', exports: { ...manifest.exports, '.': './index.mjs' } }) },
    { path: 'index.mjs', content: 'export function apply() {}' },
    { path: 'client.js', content: '// old client' },
  ])
  assert.equal((await installer.installFromZip(archive, 'older-achievements.zip')).folder, achievementPluginName)
  assert.equal((await listed()).source.kind, 'zip')
  await installer.disable(achievementPluginName)
  const recordDir = path.join(dataRoot, 'plugin-data')
  const recordFile = path.join(recordDir, achievementPluginName + '.json')
  const record = JSON.stringify({ version: 1, achievements: [
    { id: 'gold', rounds: 500, title: '史诗', earned: true, unlockedAt: 1000, contextChars: 1263067 },
  ] })
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(recordFile, record)

  const migrated = bundled()
  assert.equal(migrated.action, 'upgraded')
  assert.equal(migrated.target, fresh.target)
  assert.equal(migrated.installedVersion, '2.8.4')
  assert.equal((await listed()).source.kind, 'builtin')
  assert.equal((await listed()).enabled, false)
  assert.deepEqual(await registered(), [])
  assert.equal(readFileSync(recordFile, 'utf8'), record)
  assert.equal((await readAchievementLibrary(dshHome))[0].contextChars, 1263067)
  await assert.rejects(installer.remove(achievementPluginName), /内置插件/)
  await installer.enable(achievementPluginName)
  assert.deepEqual((await registered()).map(plugin => plugin.main), ['./lib/index.js'])
  assert.equal(bundled().action, 'skipped')
})

test('命运之骰只安装校验通过的 Release，酒馆同步保留较新的兼容版本', async t => {
  const folder = 'dsh-tavern-fate-dice'
  const repo = 'bigmalove/' + folder
  const dataRoot = mkdtempSync(path.join(tmpdir(), 'tavern-release-data-'))
  t.after(() => rmSync(dataRoot, { recursive: true, force: true }))
  const sync = source => syncBundledTavernPlugins({ sourceRoot: source.root, dataRoot, profileDir: path.join(dataRoot, 'profile'), logger: quiet })
    .find(item => item.packageName === folder)
  const oldSource = makeSource(t, { version: '1.4.2', folder })
  const { target: installed } = sync(oldSource)
  const manifest = () => JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
  const record = () => JSON.parse(readFileSync(path.join(installed, SOURCE_FILE), 'utf8'))
  const zipFor = (version, minimumApi) => writeZipEntries([
    { path: 'package.json', content: JSON.stringify({ ...manifest(), version, dsh: { compatibility: { tavernApiVersion: minimumApi } } }) },
    { path: 'lib/index.js', content: 'export const independent = true' },
    { path: 'client.js', content: '// independent release' },
  ])
  const api = 'https://api.github.com/repos/' + repo + '/releases/latest'
  const releaseZip = 'https://github.com/' + repo + '/releases/download/v1.5.0/fate-dice-1.5.0.zip'
  const sha256 = zip => 'sha256:' + createHash('sha256').update(zip).digest('hex')
  let archive = zipFor('1.5.0', TAVERN_PLUGIN_API_VERSION + 1)
  let digest = sha256(archive)
  let downloaded = archive
  const calls = []
  const installer = createUserPluginInstaller({ dataRoot, fetchImpl: async url => {
    calls.push(url)
    if (url === api) return Response.json({ tag_name: 'v1.5.0', assets: [{ name: 'fate-dice-1.5.0.zip', size: archive.length, digest }] })
    assert.equal(url, releaseZip)
    return new Response(downloaded)
  } })
  assert.equal((await installer.list())[0].source.releaseRepo, repo)

  const [blocked] = await installer.checkUpdates()
  assert.equal(blocked.status, 'blocked')
  assert.match(blocked.reason, /请先更新酒馆/)
  assert.equal(manifest().version, '1.4.2')
  await assert.rejects(installer.update(folder, 'v1.5.0:' + digest), /请先更新酒馆/)

  archive = zipFor('1.5.0', TAVERN_PLUGIN_API_VERSION)
  digest = sha256(archive)
  downloaded = archive
  const [available] = await installer.checkUpdates({ fresh: true })
  assert.equal(available.status, 'available')
  assert.equal(available.latest, 'v1.5.0')
  assert.deepEqual(await installer.checkUpdates(), [available])
  assert.deepEqual(calls, [api, releaseZip, api, releaseZip], '重复检查复用同一发布包的校验结果')
  await assert.rejects(installer.update(folder, 'stale-target'), /重新检查更新/)
  const corrupted = Buffer.from(archive)
  corrupted[0] ^= 1
  downloaded = corrupted
  await assert.rejects(installer.update(folder, available.target), /SHA-256 校验失败/)
  assert.equal(manifest().version, '1.4.2')

  downloaded = archive
  await installer.disable(folder)
  const updated = await installer.update(folder, available.target)
  assert.equal(updated.replaced, true)
  assert.equal(manifest().version, '1.5.0')
  assert.equal(record().kind, 'builtin')
  assert.equal(record().releaseRepo, repo)
  assert.equal(JSON.parse(readFileSync(path.join(installed, RESTART_FILE), 'utf8')).previousVersion, '1.4.2')
  assert.equal((await installer.list())[0].state, 'disabled')
  await assert.rejects(installer.remove(folder), /内置插件/)
  assert.equal(sync(oldSource).action, 'skipped')
  assert.equal(manifest().version, '1.5.0')
  assert.equal(sync(makeSource(t, { version: '1.5.1', folder })).action, 'upgraded')
  assert.equal(manifest().version, '1.5.1')
  assert.equal((await installer.list())[0].state, 'disabled')
})
