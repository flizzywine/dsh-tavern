// 随酒馆发行、但身份是「酒馆插件」的内置插件：装进 <data>/plugins，插件页才列得出来。
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

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
