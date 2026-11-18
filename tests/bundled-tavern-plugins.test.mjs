// 随酒馆发行、但身份是「酒馆插件」的内置插件：装进 <data>/plugins，插件页才列得出来。
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  BUNDLED_TAVERN_PLUGINS,
  SOURCE_FILE,
  installBundledTavernPlugins,
  readBundledTavernPlugin,
} from '../bin/bundled-tavern-plugins.mjs'
import { syncBundledTavernPlugins } from '../bin/service-lifecycle.mjs'

const FOLDER = 'dsh-tavern-plot-compass'
const quiet = { warn() {}, log() {} }

function makeSource(t, { version = '1.0.0', name = FOLDER } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-plugin-src-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'tavern-plugin', 'packages', FOLDER)
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

function makeData(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-plugin-data-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('首装：副本进 plugins/，代码齐备，构建输入不落地，来源标成内置', t => {
  const source = makeSource(t)
  const dataRoot = makeData(t)
  const [result] = installBundledTavernPlugins({ sourceRoot: source.root, dataRoot, logger: quiet })
  assert.equal(result.action, 'installed')
  assert.equal(result.version, '1.0.0')
  const target = path.join(dataRoot, 'plugins', FOLDER)
  assert.equal(result.target, target)
  for (const file of ['package.json', 'lib/index.js', 'client.js', 'cordis.patch.yml', SOURCE_FILE]) {
    assert.ok(existsSync(path.join(target, file)), '缺少 ' + file)
  }
  for (const file of ['build.mjs', 'src']) assert.equal(existsSync(path.join(target, file)), false, file + ' 不该进插件目录')
  const record = JSON.parse(readFileSync(path.join(target, SOURCE_FILE), 'utf8'))
  assert.equal(record.kind, 'builtin')
  assert.equal(record.bundled, true)
  assert.equal(record.version, '1.0.0')
})

test('profile 仍登记同名包时让位，不再放一份永远不会加载的副本', t => {
  const source = makeSource(t)
  const dataRoot = makeData(t)
  const profileDir = mkdtempSync(path.join(tmpdir(), 'tavern-plugin-profile-'))
  t.after(() => rmSync(profileDir, { recursive: true, force: true }))
  mkdirSync(path.join(profileDir, 'node_modules', FOLDER), { recursive: true })
  writeFileSync(path.join(profileDir, 'node_modules', FOLDER, 'package.json'), JSON.stringify({ name: FOLDER, version: '0.9.0' }))
  const [result] = installBundledTavernPlugins({ sourceRoot: source.root, dataRoot, profileDir, logger: quiet })
  assert.equal(result.action, 'skipped')
  assert.match(result.reason, /单一来源/)
  assert.equal(existsSync(path.join(dataRoot, 'plugins', FOLDER)), false)
})

test('从旧版本升上来：以这次算出的 profile 清单为准，磁盘上的旧链接不算数', t => {
  const source = makeSource(t)
  const dataRoot = makeData(t)
  const profileDir = mkdtempSync(path.join(tmpdir(), 'tavern-plugin-profile-'))
  t.after(() => rmSync(profileDir, { recursive: true, force: true }))
  // pnpm install 还没跑：node_modules 里仍留着上一次安装的链接。
  mkdirSync(path.join(profileDir, 'node_modules', FOLDER), { recursive: true })
  writeFileSync(path.join(profileDir, 'node_modules', FOLDER, 'package.json'), JSON.stringify({ name: FOLDER, version: '1.0.0' }))

  const dependency = installBundledTavernPlugins({ sourceRoot: source.root, dataRoot, profileDir, logger: quiet })[0]
  assert.equal(dependency.action, 'skipped', '没有清单时看磁盘：旧版本里它还是 profile 包')

  const [result] = installBundledTavernPlugins({ sourceRoot: source.root, dataRoot, profileDir, profileDependencies: {}, logger: quiet })
  assert.equal(result.action, 'installed', '新清单里已经没有同名包，这次就该装进 plugins/')

  const dataRoot2 = makeData(t)
  const [kept] = installBundledTavernPlugins({ sourceRoot: source.root, dataRoot: dataRoot2, profileDependencies: { [FOLDER]: 'link:./tavern-plugin/packages/' + FOLDER }, logger: quiet })
  assert.equal(kept.action, 'skipped')
  assert.match(kept.reason, /单一来源/)
})

test('同版本不动；内置更新时整份替换代码，来源标记跟着版本走', t => {
  const dataRoot = makeData(t)
  const first = makeSource(t, { version: '1.0.0' })
  assert.equal(installBundledTavernPlugins({ sourceRoot: first.root, dataRoot, logger: quiet })[0].action, 'installed')

  const same = makeSource(t, { version: '1.0.0' })
  const [unchanged] = installBundledTavernPlugins({ sourceRoot: same.root, dataRoot, logger: quiet })
  assert.equal(unchanged.action, 'skipped')
  assert.match(unchanged.reason, /与内置副本相同/)

  // 版本号不动但代码变了（酒馆日常更新就是这样）：靠内容摘要判定，替换副本。
  const edited = makeSource(t, { version: '1.0.0' })
  writeFileSync(path.join(edited.dir, 'lib', 'index.js'), 'export const bundled = "edited"\n')
  const [refreshed] = installBundledTavernPlugins({ sourceRoot: edited.root, dataRoot, logger: quiet })
  assert.equal(refreshed.action, 'upgraded')
  assert.match(readFileSync(path.join(dataRoot, 'plugins', FOLDER, 'lib', 'index.js'), 'utf8'), /edited/)

  const newer = makeSource(t, { version: '1.2.0' })
  const [upgraded] = installBundledTavernPlugins({ sourceRoot: newer.root, dataRoot, logger: quiet })
  assert.equal(upgraded.action, 'upgraded')
  assert.equal(upgraded.installedVersion, '1.0.0')
  const target = path.join(dataRoot, 'plugins', FOLDER)
  assert.match(readFileSync(path.join(target, 'lib', 'index.js'), 'utf8'), /1\.2\.0/)
  assert.equal(JSON.parse(readFileSync(path.join(target, SOURCE_FILE), 'utf8')).version, '1.2.0')
})

test('目标目录是符号链接、别的插件时一律保留现有内容', t => {
  const source = makeSource(t)
  const dataRoot = makeData(t)
  const plugins = path.join(dataRoot, 'plugins')
  mkdirSync(plugins, { recursive: true })

  const elsewhere = mkdtempSync(path.join(tmpdir(), 'tavern-plugin-link-'))
  t.after(() => rmSync(elsewhere, { recursive: true, force: true }))
  writeFileSync(path.join(elsewhere, 'package.json'), JSON.stringify({ name: FOLDER, version: '0.1.0' }))
  symlinkSync(elsewhere, path.join(plugins, FOLDER))
  let [result] = installBundledTavernPlugins({ sourceRoot: source.root, dataRoot, logger: quiet })
  assert.equal(result.action, 'skipped')
  assert.match(result.reason, /普通目录/)
  rmSync(path.join(plugins, FOLDER))

  mkdirSync(path.join(plugins, FOLDER))
  writeFileSync(path.join(plugins, FOLDER, 'package.json'), JSON.stringify({ name: 'someone-else', version: '0.1.0' }))
  ;[result] = installBundledTavernPlugins({ sourceRoot: source.root, dataRoot, logger: quiet })
  assert.equal(result.action, 'skipped')
  assert.match(result.reason, /同名插件/)
  assert.equal(JSON.parse(readFileSync(path.join(plugins, FOLDER, 'package.json'), 'utf8')).name, 'someone-else')
})

test('发行副本不完整时报 unavailable，不去猜', t => {
  const source = makeSource(t)
  rmSync(path.join(source.dir, 'client.js'))
  const dataRoot = makeData(t)
  const [definition] = BUNDLED_TAVERN_PLUGINS
  assert.match(readBundledTavernPlugin(source.root, definition).reason, /不完整/)
  const [result] = installBundledTavernPlugins({ sourceRoot: source.root, dataRoot, logger: quiet })
  assert.equal(result.action, 'unavailable')
  assert.equal(existsSync(path.join(dataRoot, 'plugins', FOLDER)), false)
})

test('整目录替换更新时保留用户的 .tavern-disabled 停用标记', t => {
  const dataRoot = makeData(t)
  const first = makeSource(t, { version: '1.0.0' })
  assert.equal(installBundledTavernPlugins({ sourceRoot: first.root, dataRoot, logger: quiet })[0].action, 'installed')

  const disabledMarker = path.join(dataRoot, 'plugins', FOLDER, '.tavern-disabled')
  writeFileSync(disabledMarker, 'disabled by user\n')

  const unchanged = installBundledTavernPlugins({ sourceRoot: first.root, dataRoot, logger: quiet })[0]
  assert.equal(unchanged.action, 'skipped')
  assert.equal(existsSync(disabledMarker), true)

  const edited = makeSource(t, { version: '1.1.0' })
  writeFileSync(path.join(edited.dir, 'client.js'), '// updated client\n')
  const upgraded = installBundledTavernPlugins({ sourceRoot: edited.root, dataRoot, logger: quiet })[0]
  assert.equal(upgraded.action, 'upgraded')
  assert.equal(existsSync(disabledMarker), true)
  assert.equal(readFileSync(disabledMarker, 'utf8'), 'disabled by user\n')
})

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
