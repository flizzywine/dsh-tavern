import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createEntryManager, resolveEntryConfig } from '../android/dsh-tavern-entry/index.js'
import { configureAndroidProfiles } from '../android/configure-profiles.mjs'

const root = new URL('../', import.meta.url)
const installer = await readFile(new URL('../android/install.sh', import.meta.url), 'utf8')
const setup = await readFile(new URL('../android/setup.sh', import.meta.url), 'utf8')
const updater = await readFile(new URL('../android/update.sh', import.meta.url), 'utf8')
const entryClient = await readFile(new URL('../android/dsh-tavern-entry/client.js', import.meta.url), 'utf8')
const entryManifest = JSON.parse(await readFile(new URL('../android/dsh-tavern-entry/package.json', import.meta.url), 'utf8'))
const mobileManifest = JSON.parse(await readFile(new URL('../android/dsh-client-ui-mobile-adapt/package.json', import.meta.url), 'utf8'))

test('两个 Android 插件的包入口与实际源码一致', async () => {
  for (const [directory, manifest] of [
    ['android/dsh-tavern-entry', entryManifest],
    ['android/dsh-client-ui-mobile-adapt', mobileManifest],
  ]) {
    const main = path.resolve(new URL(directory + '/', root).pathname, manifest.main)
    await access(main)
  }
  assert.equal(entryManifest.exports['.'], './index.js')
  assert.equal(entryManifest.exports['./client'], './client.js')
  assert.equal(mobileManifest.exports['.'].default, './index.js')
  assert.equal(mobileManifest.exports['./client'].default, './client.js')
})

test('自动拉起插件默认使用 3088，并优先读取 Tavern Profile 的真实源码目录', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-android-entry-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const profile = path.join(home, '.dsh', 'profiles', 'tavern')
  await mkdir(profile, { recursive: true })
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ dshTavern: { source: '/opt/dsh-tavern' } }), 'utf8')

  assert.deepEqual(resolveEntryConfig({}, home), {
    dshHome: path.join(home, '.dsh'),
    appDir: '/opt/dsh-tavern',
    port: 3088,
  })
  assert.equal(resolveEntryConfig({ DSH_TAVERN_ANDROID_PORT: '3099' }, home).port, 3099)
  assert.throws(() => resolveEntryConfig({ DSH_TAVERN_ANDROID_PORT: '0' }, home), /有效端口/)
  assert.match(entryClient, /127\.0\.0\.1:3088/)
  assert.doesNotMatch(entryClient, /127\.0\.0\.1:3081/)
})

test('Android 入口在 Tavern 离线时仍可启动更新或修复', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-android-manager-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const appDir = path.join(home, 'apps', 'dsh-tavern')
  const launcher = path.join(appDir, 'bin', 'dsh-tavern.mjs')
  await mkdir(path.dirname(launcher), { recursive: true })
  await writeFile(launcher, '#!/usr/bin/env node\n', 'utf8')
  const calls = []
  const child = { once(event, listener) { if (event === 'spawn') queueMicrotask(listener); return this }, unref() {} }
  const manager = createEntryManager({
    env: { DSH_HOME: home, DSH_TAVERN_ANDROID_APP_DIR: appDir },
    home,
    now: () => 456,
    portProbe: async () => false,
    spawnProcess(command, args, options) { calls.push({ command, args, options }); return child },
  })

  assert.deepEqual(await manager.status(), {
    installed: true,
    online: false,
    update: { phase: 'idle', host: 'android' },
  })
  assert.deepEqual(await manager.update(), {
    installed: true,
    online: false,
    update: { phase: 'running', host: 'android', startedAt: 456 },
  })
  assert.deepEqual(calls[0].args.slice(0, 4), [launcher, 'update', '--host', 'android'])
})

test('Android 入口未安装 Tavern 时明确拒绝伪更新', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-android-manager-empty-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const manager = createEntryManager({
    env: { DSH_HOME: home, DSH_TAVERN_ANDROID_APP_DIR: path.join(home, 'missing') },
    home,
    portProbe: async () => false,
  })

  await assert.rejects(() => manager.update(), /尚未安装 DSH Tavern/)
})

test('Android 安装脚本增量配置两个 Profile，失败不会伪装成成功', () => {
  assert.match(installer, /^#!\/usr\/bin\/env bash\nset -euo pipefail/m)
  assert.match(installer, /DSH_TAVERN_PORT="\$\{TAVERN_PORT\}"/)
  assert.match(installer, /configure-profiles\.mjs/)
  assert.match(installer, /dsh-tavern-entry/)
  assert.match(installer, /dsh-client-ui-mobile-adapt/)
  assert.match(installer, /install --host android/)
  assert.match(installer, /DSH_TAVERN_RUNTIME_HOST="android"/)
  assert.doesNotMatch(installer, /dsh-cost-meter/)
  assert.doesNotMatch(installer, /rm -rf|\|\| true/)
  assert.doesNotMatch(installer, /tavern-plugin\/lib\/client\.js/)
})

test('Android setup 是唯一公开入口，自动完成首次克隆或安全更新', () => {
  assert.match(setup, /^#!\/usr\/bin\/env bash\nset -euo pipefail/m)
  assert.match(setup, /DSH_TAVERN_ANDROID_APP_DIR/)
  assert.match(setup, /https:\/\/github\.com\/flizzywine\/dsh-tavern\.git/)
  assert.match(setup, /git clone/)
  assert.match(setup, /git -C "\$\{APP_DIR\}" fetch origin main/)
  assert.match(setup, /git -C "\$\{APP_DIR\}" merge --ff-only origin\/main/)
  assert.match(setup, /android\/install\.sh/)
  assert.doesNotMatch(setup, /reset --hard|git clean|git checkout/)
})

test('Android setup 通过同一命令完成首次安装和后续更新', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-android-setup-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source')
  const dshHome = path.join(directory, 'dsh-home')
  await mkdir(path.join(source, 'android'), { recursive: true })
  await writeFile(path.join(source, 'android', 'install.sh'), '#!/usr/bin/env bash\nset -euo pipefail\nprintf "installed\\n" >> "${DSH_HOME}/setup-runs"\n', 'utf8')
  for (const args of [
    ['init', '-b', 'main'],
    ['config', 'user.email', 'test@example.com'],
    ['config', 'user.name', 'Test'],
    ['add', '.'],
    ['commit', '-m', 'initial'],
  ]) {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }

  const environment = { ...process.env, DSH_HOME: dshHome, DSH_TAVERN_REPOSITORY: source }
  const first = spawnSync('bash', [new URL('../android/setup.sh', import.meta.url).pathname], { env: environment, encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /全部完成/)

  await writeFile(path.join(source, 'version.txt'), 'next\n', 'utf8')
  for (const args of [['add', '.'], ['commit', '-m', 'next']]) {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  const second = spawnSync('bash', [new URL('../android/setup.sh', import.meta.url).pathname], { env: environment, encoding: 'utf8' })
  assert.equal(second.status, 0, second.stderr)
  assert.equal(await readFile(path.join(dshHome, 'setup-runs'), 'utf8'), 'installed\ninstalled\n')
  assert.equal(await readFile(path.join(dshHome, 'apps', 'dsh-tavern', 'version.txt'), 'utf8'), 'next\n')

  await writeFile(path.join(dshHome, 'apps', 'dsh-tavern', 'version.txt'), 'user change\n', 'utf8')
  const protectedUpdate = spawnSync('bash', [new URL('../android/setup.sh', import.meta.url).pathname], { env: environment, encoding: 'utf8' })
  assert.notEqual(protectedUpdate.status, 0)
  assert.match(protectedUpdate.stderr, /存在未提交修改/)
  assert.equal(await readFile(path.join(dshHome, 'apps', 'dsh-tavern', 'version.txt'), 'utf8'), 'user change\n')
})

test('Android 更新复用 setup，不维护第二套安装逻辑', () => {
  assert.match(updater, /^#!\/usr\/bin\/env bash\nset -euo pipefail/m)
  assert.match(updater, /DSH_TAVERN_SOURCE_ROOT/)
  assert.match(updater, /android\/setup\.sh/)
  assert.doesNotMatch(updater, /git -C|android\/install\.sh/)
  assert.doesNotMatch(updater, /reset --hard|git clean|git checkout/)
})

test('DSHA 酒馆入口同时提供打开与更新修复操作', () => {
  assert.match(entryClient, /更新\/修复/)
  assert.match(entryClient, /\/api\/dsh-tavern-android\/update/)
  assert.match(entryClient, /\/api\/dsh-tavern-android\/status/)
  assert.match(entryClient, /state\.update\.error/)
})

test('Android Profile 配置保留已有内容并幂等加入所需插件', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-android-profiles-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const tavern = path.join(directory, 'profiles', 'tavern')
  const web = path.join(directory, 'profiles', 'web')
  await mkdir(tavern, { recursive: true })
  await mkdir(web, { recursive: true })
  const initial = {
    private: true,
    dependencies: { existing: '1.0.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'existing'] } },
  }
  await writeFile(path.join(tavern, 'package.json'), JSON.stringify(initial), 'utf8')
  await writeFile(path.join(web, 'package.json'), JSON.stringify(initial), 'utf8')

  configureAndroidProfiles({ repoRoot: new URL('..', import.meta.url).pathname, tavernProfile: tavern, webProfile: web })
  configureAndroidProfiles({ repoRoot: new URL('..', import.meta.url).pathname, tavernProfile: tavern, webProfile: web })

  const tavernPkg = JSON.parse(await readFile(path.join(tavern, 'package.json'), 'utf8'))
  const webPkg = JSON.parse(await readFile(path.join(web, 'package.json'), 'utf8'))
  assert.equal(tavernPkg.dependencies.existing, '1.0.0')
  assert.equal(tavernPkg.dsh.profile.bundles.filter((name) => name === 'dsh-client-ui-mobile-adapt').length, 1)
  assert.equal(webPkg.dsh.profile.bundles.filter((name) => name === 'dsh-tavern-entry').length, 1)
  assert.match(webPkg.dependencies['dsh-tavern-entry'], /^link:\//)
})
