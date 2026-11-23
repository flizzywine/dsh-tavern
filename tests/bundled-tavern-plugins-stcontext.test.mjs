import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { installBundledTavernPlugins, SOURCE_FILE } from '../bin/bundled-tavern-plugins.mjs'
import { bundledPluginRuntimeFiles } from '../tavern-plugin/lib/domain/bundled-plugin-release.js'

const name = 'dsh-tavern-STcontext'
const releaseRepo = 'koabop/dsh-tavern-STcontext'
const disabledFile = '.tavern-disabled'
const wasm = 'lib/vendor/quickjs.wasm'

function write(directory, relative, value) {
  const file = path.join(directory, relative)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, value)
}

function runtime(directory, version, api = 7) {
  for (const file of bundledPluginRuntimeFiles(name)) write(directory, file, file + ' at ' + version)
  write(directory, 'package.json', JSON.stringify({
    name, version, type: 'module', exports: { '.': './index.mjs', './client': './client.js' },
    dsh: { compatibility: { tavernApiVersion: api } },
  }))
  const hashes = {}
  for (const file of ['quickjs.mjs', 'quickjs.wasm', 'parser.mjs', 'LICENSES.txt']) {
    const bytes = Buffer.from(file + ' at ' + version)
    write(directory, 'lib/vendor/' + file, bytes)
    hashes[file] = createHash('sha256').update(bytes).digest('hex')
  }
  write(directory, 'lib/vendor/manifest.json', JSON.stringify({ hashes }))
}

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-stcontext-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const source = path.join(root, 'tavern-plugin', 'packages', name)
  const dataRoot = path.join(root, 'data')
  const plugins = path.join(dataRoot, 'plugins')
  const profileDir = path.join(root, 'profile')
  runtime(source, '0.8.2')
  return {
    source, dataRoot, plugins, target: path.join(plugins, name), profileDir,
    sync: extra => installBundledTavernPlugins({ sourceRoot: root, dataRoot, profileDir, logger: {}, ...extra })
      .find(result => result.packageName === name),
  }
}

test('STcontext 首装停用，重复启动与宿主升版保留用户的启用、停用和数据', t => {
  const { source, dataRoot, target, sync } = fixture(t)
  assert.equal(sync().action, 'installed')
  assert.equal(existsSync(path.join(target, disabledFile)), true)
  assert.equal(JSON.parse(readFileSync(path.join(target, SOURCE_FILE))).kind, 'builtin')
  assert.equal(sync().action, 'skipped')
  assert.equal(existsSync(path.join(target, disabledFile)), true)

  rmSync(path.join(target, disabledFile))
  write(dataRoot, 'plugin-data/' + name + '.json', '{"preset":"existing"}')
  assert.equal(sync().action, 'skipped')
  runtime(source, '0.8.3')
  assert.equal(sync().action, 'upgraded')
  assert.equal(existsSync(path.join(target, disabledFile)), false)
  write(target, disabledFile, '{"disabledAt":"previously"}')
  runtime(source, '0.8.4')
  assert.equal(sync().action, 'upgraded')
  assert.equal(readFileSync(path.join(target, disabledFile), 'utf8'), '{"disabledAt":"previously"}')
  assert.equal(readFileSync(path.join(dataRoot, 'plugin-data', name + '.json'), 'utf8'), '{"preset":"existing"}')
})

for (const [origin, folder, marker, wasDisabled] of [
  ['手动', name, null, false],
  ['GitHub', name, { kind: 'github', repo: releaseRepo }, false],
  ['ZIP', name, { kind: 'zip', file: 'old.zip' }, true],
  ['Git 检出', name, null, false],
  ['人物卡', name, null, false],
  ['自定义目录', 'my-STcontext', { kind: 'zip' }, false],
  ['已停用的自定义目录', 'other-name', null, true],
]) {
  test('STcontext 保留已有' + origin + '安装', t => {
    const { plugins, target, sync } = fixture(t)
    const existing = path.join(plugins, folder)
    write(existing, 'package.json', JSON.stringify({ name, version: '0.7.0' }))
    write(existing, 'index.mjs', 'user content')
    if (marker) write(existing, SOURCE_FILE, JSON.stringify(marker))
    if (origin === 'Git 检出') write(existing, '.git', 'gitdir: private')
    if (origin === '人物卡') write(existing, '.dsh-card.json', '{}')
    if (wasDisabled) write(existing, disabledFile, 'disabled')
    assert.equal(sync().action, 'skipped')
    assert.equal(readFileSync(path.join(existing, 'index.mjs'), 'utf8'), 'user content')
    assert.equal(existsSync(path.join(existing, disabledFile)), wasDisabled)
    assert.equal(existsSync(path.join(existing, SOURCE_FILE)), Boolean(marker))
    if (marker) assert.deepEqual(JSON.parse(readFileSync(path.join(existing, SOURCE_FILE))), marker)
    assert.equal(existsSync(target), folder === name)
  })
}

test('STcontext 让位给 profile 已登记的同名插件', t => {
  const { profileDir, target, sync } = fixture(t)
  assert.equal(sync({ profileDependencies: { [name]: 'link:./my-STcontext' } }).action, 'skipped')
  write(profileDir, 'package.json', JSON.stringify({ dependencies: { [name]: 'link:./my-STcontext' } }))
  assert.equal(sync().action, 'skipped')
  rmSync(path.join(profileDir, 'package.json'))
  write(profileDir, 'node_modules/' + name + '/package.json', JSON.stringify({ name }))
  assert.equal(sync().action, 'skipped')
  assert.equal(existsSync(target), false)
})

test('STcontext 同步保留较新的兼容内置版，发现损坏或 API 不兼容时回到固定版', t => {
  const { target, sync } = fixture(t)
  sync()
  const record = JSON.parse(readFileSync(path.join(target, SOURCE_FILE)))
  rmSync(path.join(target, disabledFile))
  runtime(target, '0.9.0')
  assert.equal(sync().action, 'skipped') // 用户回退酒馆，原内置版仍然可用。
  write(target, SOURCE_FILE, JSON.stringify({ ...record, releaseRepo, version: '0.9.0' }))
  assert.equal(sync().action, 'skipped') // 插件页单独更新的版本也继续生效。
  write(target, wasm, 'damaged')
  assert.equal(sync().action, 'upgraded')
  assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'))).version, '0.8.2')
  assert.equal(existsSync(path.join(target, disabledFile)), false)

  runtime(target, '0.9.0', 999)
  assert.equal(sync().action, 'upgraded')
  assert.equal(JSON.parse(readFileSync(path.join(target, 'package.json'))).version, '0.8.2')
  write(target, wasm, 'damaged at pinned version')
  assert.equal(sync().action, 'upgraded')
  assert.equal(readFileSync(path.join(target, wasm), 'utf8'), 'quickjs.wasm at 0.8.2')
})

test('发行包损坏时保留可用的 STcontext 和停用状态，修复后可重试', t => {
  const { source, target, sync } = fixture(t)
  assert.equal(sync().action, 'installed')
  runtime(source, '0.8.3')
  write(source, wasm, 'damaged in distribution')
  const result = sync()
  assert.equal(result.action, 'unavailable')
  assert.match(result.reason, /SHA-256/)
  assert.equal(readFileSync(path.join(target, wasm), 'utf8'), 'quickjs.wasm at 0.8.2')
  assert.equal(existsSync(path.join(target, disabledFile)), true)
  runtime(source, '0.8.3')
  assert.equal(sync().action, 'upgraded')
})
