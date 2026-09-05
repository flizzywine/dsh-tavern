import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'
import { installPluginDependencies, resolveDshBootModule, resolveHostDependencies } from '../bin/plugin-dependencies.mjs'

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'tavern-host-deps-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const pluginDirectory = path.join(root, 'tavern plugin')
  mkdirSync(pluginDirectory)
  const original = 'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n'
  writeFileSync(path.join(pluginDirectory, 'pnpm-workspace.yaml'), original)
  const bootstrap = path.join(root, 'DSH Desktop/resources/app.asar.unpacked/lib/desktop-cli.js')
  mkdirSync(path.dirname(bootstrap), { recursive: true })
  writeFileSync(bootstrap, '')
  const packages = {}
  for (const [name, exportName] of [['dsh-tools', 'defineTool'], ['dsh-subagent', 'snapshotSubagentDescriptor'], ['dsh-typert-protocol', 'TypertRemoteService']]) {
    const directory = path.resolve(path.dirname(bootstrap), '../node_modules/@deepseek-ai', name)
    mkdirSync(directory, { recursive: true })
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${name}`, version: '0.1.2-alpha.1', type: 'module', exports: './index.js' }))
    writeFileSync(path.join(directory, 'index.js'), `export function ${exportName}() { return 'host-alpha1' }\n`)
    packages[`@deepseek-ai/${name}`] = directory
  }
  const bootDirectory = path.resolve(path.dirname(bootstrap), '../node_modules/@deepseek-ai/dsh-app-boot')
  mkdirSync(bootDirectory)
  writeFileSync(path.join(bootDirectory, 'package.json'), '{"name":"@deepseek-ai/dsh-app-boot","version":"0.1.2-rc.1","type":"module","exports":"./index.js"}')
  writeFileSync(path.join(bootDirectory, 'index.js'), 'export function boot() {}\n')
  writeFileSync(path.join(pluginDirectory, 'package.json'), JSON.stringify({ name: 'host-deps-fixture', private: true, dependencies: Object.fromEntries(Object.keys(packages).map(name => [name, '>=0.1.0-rc.7'])) }))
  return { root, pluginDirectory, original, bootstrap, packages }
}

test('Desktop alpha.1 本地依赖存在而 npm 未发布：安装直接复用，不请求 alpha.1 或 alpha.2', t => {
  const f = fixture(t)
  let installs = 0
  installPluginDependencies({ ...f, dshVersion: '0.1.2-alpha.1', dsh: 'dsh', host: 'desktop',
    env: { DSH_DESKTOP_DSH_BOOTSTRAP: f.bootstrap },
    run(command, args, options) {
      installs++
      assert.equal(command, 'pnpm')
      assert.deepEqual(args, ['install', '--lockfile=false'])
      assert.equal(options.cwd, f.pluginDirectory)
      const { overrides } = parse(readFileSync(path.join(f.pluginDirectory, 'pnpm-workspace.yaml'), 'utf8'))
      for (const [name, directory] of Object.entries(f.packages)) {
        assert.equal(overrides[name], `link:${realpathSync(directory).replaceAll('\\', '/')}`, `不能去 npm 下载不存在的 ${name}@0.1.2-alpha.1`)
      }
    },
  })
  assert.equal(installs, 1)
  assert.equal(readFileSync(path.join(f.pluginDirectory, 'pnpm-workspace.yaml'), 'utf8'), f.original)
})

test('Desktop 更新不预删仍可能被运行中宿主占用的插件依赖目录', t => {
  const f = fixture(t)
  const modules = path.join(f.pluginDirectory, 'node_modules')
  const sentinel = path.join(modules, 'desktop-in-use.txt')
  mkdirSync(modules)
  writeFileSync(sentinel, 'in use')

  installPluginDependencies({ ...f, dsh: 'dsh', host: 'desktop',
    env: { DSH_DESKTOP_DSH_BOOTSTRAP: f.bootstrap },
    run() {
      assert.equal(readFileSync(sentinel, 'utf8'), 'in use', 'pnpm 应接管原地更新，安装器不得先删除运行中 Desktop 可能占用的目录')
    },
  })
})

test('真实 pnpm 离线安装本地链接，并由插件解析到宿主原包及其传递依赖', t => {
  const f = fixture(t)
  const staleTools = path.join(f.pluginDirectory, 'node_modules/@deepseek-ai/dsh-tools')
  mkdirSync(staleTools, { recursive: true })
  writeFileSync(path.join(staleTools, 'package.json'), '{"name":"@deepseek-ai/dsh-tools","version":"0.0.0","type":"module","exports":"./index.js"}')
  writeFileSync(path.join(staleTools, 'index.js'), 'export function defineTool() { return "stale" }')
  const helper = path.resolve(path.dirname(f.bootstrap), '../node_modules/host-helper')
  mkdirSync(helper)
  writeFileSync(path.join(helper, 'package.json'), '{"name":"host-helper","type":"module","exports":"./index.js"}')
  writeFileSync(path.join(helper, 'index.js'), 'export default "host-transitive"')
  writeFileSync(path.join(f.packages['@deepseek-ai/dsh-tools'], 'index.js'), 'import value from "host-helper"; export function defineTool() { return value }')
  const originalPackages = Object.values(f.packages).map(directory => readFileSync(path.join(directory, 'package.json'), 'utf8'))
  installPluginDependencies({ ...f, host: 'desktop', env: { ...process.env, DSH_DESKTOP_DSH_BOOTSTRAP: f.bootstrap },
    run(command, args, options) {
      // Neither registry access nor a cached alpha.1 package can make this pass.
      const result = spawnSync(command, [...args, '--offline', '--store-dir', './empty-store'], {
        ...options, encoding: 'utf8', shell: process.platform === 'win32', timeout: 30000,
      })
      assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)
    },
  })
  const require = createRequire(path.join(f.pluginDirectory, 'probe.cjs'))
  for (const [name, directory] of Object.entries(f.packages)) assert.equal(realpathSync(require.resolve(name)), realpathSync(path.join(directory, 'index.js')))
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', 'import { defineTool } from "@deepseek-ai/dsh-tools"; console.log(defineTool())'], { cwd: f.pluginDirectory, encoding: 'utf8' })
  assert.equal(probe.status, 0, probe.stderr)
  assert.equal(probe.stdout.trim(), 'host-transitive')
  assert.deepEqual(Object.values(f.packages).map(directory => readFileSync(path.join(directory, 'package.json'), 'utf8')), originalPackages)
})

for (const failure of ['missing', 'export', 'transitive']) {
  test(`宿主依赖 ${failure} 异常时明确报错，不删除旧依赖、不调用 pnpm`, t => {
    const f = fixture(t)
    const directory = f.packages['@deepseek-ai/dsh-subagent']
    if (failure === 'missing') rmSync(directory, { recursive: true })
    else writeFileSync(path.join(directory, 'index.js'), failure === 'export' ? 'export const other = true' : 'import "missing-host-transitive"')
    mkdirSync(path.join(f.pluginDirectory, 'node_modules'))
    const sentinel = path.join(f.pluginDirectory, 'node_modules', 'keep.txt')
    writeFileSync(sentinel, 'keep')
    assert.throws(() => installPluginDependencies({ ...f, host: 'desktop', env: { DSH_DESKTOP_DSH_BOOTSTRAP: f.bootstrap },
      run() { assert.fail('不得调用 pnpm') },
    }), failure === 'missing' ? /缺少必需依赖 @deepseek-ai\/dsh-subagent/ : /dsh-subagent.*无法加载所需接口 snapshotSubagentDescriptor/)
    assert.equal(readFileSync(sentinel, 'utf8'), 'keep')
    assert.equal(readFileSync(path.join(f.pluginDirectory, 'pnpm-workspace.yaml'), 'utf8'), f.original)
  })
}

test('CLI npm/pnpm 包目录及符号链接按当前 dsh 定位，不受 Desktop 环境变量影响', t => {
  const f = fixture(t)
  const cliRoot = path.join(f.root, 'cli/node_modules/@deepseek-ai/dsh')
  mkdirSync(path.join(cliRoot, 'lib'), { recursive: true })
  writeFileSync(path.join(cliRoot, 'package.json'), '{"name":"@deepseek-ai/dsh","bin":{"dsh":"lib/bin.js"}}')
  writeFileSync(path.join(cliRoot, 'lib/bin.js'), '')
  renameSync(path.resolve(path.dirname(f.bootstrap), '../node_modules'), path.join(cliRoot, 'node_modules'))
  const wrapper = path.join(f.root, 'cli/dsh.cmd')
  writeFileSync(wrapper, '@echo off')
  for (const dsh of [wrapper, path.join(cliRoot, 'lib/bin.js')]) {
    const deps = resolveHostDependencies({ dsh, env: { DSH_DESKTOP_DSH_BOOTSTRAP: '/wrong/desktop.js' } })
    assert.ok(deps.every(dep => dep.directory.startsWith(realpathSync(cliRoot))))
    assert.equal(realpathSync(resolveDshBootModule({ dsh })), realpathSync(path.join(cliRoot, 'node_modules/@deepseek-ai/dsh-app-boot/index.js')))
  }
  if (process.platform !== 'win32') {
    const bin = path.join(f.root, 'bin')
    mkdirSync(bin)
    symlinkSync(path.join(cliRoot, 'lib/bin.js'), path.join(bin, 'dsh'))
    const deps = resolveHostDependencies({ dsh: 'dsh', env: { PATH: bin }, host: 'android' })
    assert.ok(deps.every(dep => dep.directory.startsWith(realpathSync(cliRoot))))
  }
})

test('Desktop 无 bootstrap 环境变量时按 app 可执行文件定位，不使用另一套 CLI', t => {
  const f = fixture(t)
  const executable = path.join(f.root, 'DSH Desktop', 'DSH Desktop.exe')
  const deps = resolveHostDependencies({ host: 'desktop', dsh: '/wrong/cli', platform: 'win32', env: { DSH_DESKTOP_APP_EXECUTABLE: executable } })
  assert.equal(deps.length, 3)
  assert.equal(realpathSync(resolveDshBootModule({ host: 'desktop', env: { DSH_DESKTOP_DSH_BOOTSTRAP: f.bootstrap } })), realpathSync(path.resolve(path.dirname(f.bootstrap), '../node_modules/@deepseek-ai/dsh-app-boot/index.js')))
  const macRoot = path.join(f.root, 'Desktop.app/Contents/Resources')
  mkdirSync(macRoot, { recursive: true })
  renameSync(path.resolve(path.dirname(f.bootstrap), '..'), path.join(macRoot, 'app.asar.unpacked'))
  const macDeps = resolveHostDependencies({ host: 'desktop', platform: 'darwin', env: { DSH_DESKTOP_APP_EXECUTABLE: path.join(f.root, 'Desktop.app/Contents/MacOS/DSH Desktop') } })
  assert.ok(macDeps.every(dep => dep.directory.includes('Desktop.app')))
  assert.ok(resolveDshBootModule({ host: 'desktop', platform: 'darwin', env: { DSH_DESKTOP_APP_EXECUTABLE: path.join(f.root, 'Desktop.app/Contents/MacOS/DSH Desktop') } }).includes('Desktop.app'))
})

test('本地包版本不等于宿主或 alpha.2 也不拦截；依赖安装失败仍恢复源码配置', t => {
  const f = fixture(t)
  const pkg = path.join(f.packages['@deepseek-ai/dsh-tools'], 'package.json')
  const manifest = JSON.parse(readFileSync(pkg, 'utf8'))
  manifest.version = '0.1.1-rc.2'
  writeFileSync(pkg, JSON.stringify(manifest))
  assert.throws(() => installPluginDependencies({ ...f, dshVersion: '0.1.2-alpha.1', host: 'desktop', env: { DSH_DESKTOP_DSH_BOOTSTRAP: f.bootstrap },
    run() { throw new Error('模拟普通依赖安装失败') },
  }), /模拟普通依赖安装失败/)
  assert.equal(readFileSync(path.join(f.pluginDirectory, 'pnpm-workspace.yaml'), 'utf8'), f.original)
})
