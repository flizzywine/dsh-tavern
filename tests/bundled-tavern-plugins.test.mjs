// 随酒馆发行、但身份是「酒馆插件」的内置插件：装进 <data>/plugins，插件页才列得出来。
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { SOURCE_FILE } from '../bin/bundled-tavern-plugins.mjs'
import { syncBundledTavernPlugins } from '../bin/service-lifecycle.mjs'
import { createUserPluginInstaller } from '../tavern-plugin/lib/domain/user-plugin-install.js'
import { DISABLED_FILE, syncUserPlugins } from '../tavern-plugin/lib/domain/user-plugins.js'

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

for (const folder of ['dsh-tavern-fate-dice', 'dsh-tavern-plot-compass']) {
  test(`${folder} 默认加载，迁移旧版自动停用标记并保留手动停用`, t => checkBundledLoadDefault(t, folder))
}
