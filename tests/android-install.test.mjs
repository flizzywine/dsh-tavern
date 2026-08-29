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
    update: { phase: 'idle', host: 'android', currentVersion: 'unknown', currentCommit: '' },
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
  assert.match(installer, /pnpm config set package-import-method copy --location=user/)
  assert.match(installer, /pnpm config set side-effects-cache false --location=user/)
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

test('Android setup 是唯一公开入口，优先 Git 并提供压缩包回退', () => {
  assert.match(setup, /^#!\/usr\/bin\/env bash\nset -euo pipefail/m)
  assert.match(setup, /DSH_TAVERN_ANDROID_APP_DIR/)
  assert.match(setup, /https:\/\/github\.com\/flizzywine\/dsh-tavern\.git/)
  assert.match(setup, /git clone/)
  assert.match(setup, /git -C "\$\{APP_DIR\}" fetch origin main/)
  assert.match(setup, /git -C "\$\{APP_DIR\}" merge --ff-only origin\/main/)
  assert.match(setup, /https:\/\/codeload\.github\.com\/flizzywine\/dsh-tavern\/tar\.gz\/refs\/heads\/main/)
  assert.match(setup, /curl -fL/)
  assert.match(setup, /tar -xzf/)
  assert.match(setup, /\.dsh-tavern-tarball-source/)
  assert.match(setup, /rollback_source/)
  assert.match(setup, /android\/install\.sh/)
  assert.doesNotMatch(setup, /reset --hard|git clean|git checkout/)
  assert.doesNotMatch(setup, /rm -rf/)
})

test('Android setup 通过同一命令完成首次安装和后续更新', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-android-setup-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source')
  const dshHome = path.join(directory, 'dsh-home')
  await mkdir(path.join(source, 'android'), { recursive: true })
  await mkdir(path.join(source, 'bin'), { recursive: true })
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern' }), 'utf8')
  await writeFile(path.join(source, 'bin', 'dsh-tavern.mjs'), '', 'utf8')
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

test('Git 下载失败时通过 tarball 安装更新，保留旧数据并在安装失败时回滚', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-android-tarball-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const dshHome = path.join(directory, 'dsh-home')
  const archive = path.join(directory, 'dsh-tavern.tar.gz')
  const sourceParent = path.join(directory, 'archive-source')
  const source = path.join(sourceParent, 'dsh-tavern-main')

  async function writeArchive(version, installExit = 0) {
    await rm(sourceParent, { recursive: true, force: true })
    await mkdir(path.join(source, 'android'), { recursive: true })
    await mkdir(path.join(source, 'bin'), { recursive: true })
    await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern', version }), 'utf8')
    await writeFile(path.join(source, 'version.txt'), version + '\n', 'utf8')
    await writeFile(path.join(source, 'bin', 'dsh-tavern.mjs'), '', 'utf8')
    await writeFile(path.join(source, 'android', 'install.sh'), `#!/usr/bin/env bash\nprintf "${version}\\n" >> "\${DSH_HOME}/setup-runs"\nexit ${installExit}\n`, 'utf8')
    if (version === 'v1') await writeFile(path.join(source, 'removed-in-v2.txt'), 'old\n', 'utf8')
    const packed = spawnSync('tar', ['-czf', archive, '-C', sourceParent, 'dsh-tavern-main'], { encoding: 'utf8' })
    assert.equal(packed.status, 0, packed.stderr)
  }

  const environment = {
    ...process.env,
    DSH_HOME: dshHome,
    DSH_TAVERN_REPOSITORY: path.join(directory, 'missing-git-repository'),
    DSH_TAVERN_TARBALL_URL: `file://${archive}`,
  }
  const setupPath = new URL('../android/setup.sh', import.meta.url).pathname
  const appDir = path.join(dshHome, 'apps', 'dsh-tavern')

  await writeArchive('v1')
  const first = spawnSync('bash', [setupPath], { env: environment, encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /改用 GitHub 压缩包/)
  assert.equal(await readFile(path.join(appDir, 'version.txt'), 'utf8'), 'v1\n')
  await mkdir(path.join(appDir, 'data'), { recursive: true })
  await writeFile(path.join(appDir, 'data', 'legacy.txt'), '用户数据\n', 'utf8')

  await writeArchive('v2')
  const second = spawnSync('bash', [setupPath], { env: environment, encoding: 'utf8' })
  assert.equal(second.status, 0, second.stderr)
  assert.equal(await readFile(path.join(appDir, 'version.txt'), 'utf8'), 'v2\n')
  assert.equal(await readFile(path.join(appDir, 'data', 'legacy.txt'), 'utf8'), '用户数据\n')
  await assert.rejects(access(path.join(appDir, 'removed-in-v2.txt')))

  await writeArchive('broken', 7)
  const failed = spawnSync('bash', [setupPath], { env: environment, encoding: 'utf8' })
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /源码已恢复到更新前版本/)
  assert.equal(await readFile(path.join(appDir, 'version.txt'), 'utf8'), 'v2\n')
  assert.equal(await readFile(path.join(appDir, 'data', 'legacy.txt'), 'utf8'), '用户数据\n')
})

test('Git 仓库 fetch 失败时切换为 tarball 更新', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-android-fetch-fallback-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'git-source')
  const dshHome = path.join(directory, 'dsh-home')
  const archiveParent = path.join(directory, 'archive-source')
  const archiveSource = path.join(archiveParent, 'dsh-tavern-main')
  const archive = path.join(directory, 'dsh-tavern.tar.gz')
  const setupPath = new URL('../android/setup.sh', import.meta.url).pathname
  const appDir = path.join(dshHome, 'apps', 'dsh-tavern')

  for (const root of [source, archiveSource]) {
    await mkdir(path.join(root, 'android'), { recursive: true })
    await mkdir(path.join(root, 'bin'), { recursive: true })
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern' }), 'utf8')
    await writeFile(path.join(root, 'bin', 'dsh-tavern.mjs'), '', 'utf8')
    await writeFile(path.join(root, 'android', 'install.sh'), '#!/usr/bin/env bash\nprintf "installed\\n" >> "${DSH_HOME}/setup-runs"\n', 'utf8')
  }
  await writeFile(path.join(source, 'version.txt'), 'git-v1\n', 'utf8')
  await writeFile(path.join(archiveSource, 'version.txt'), 'tarball-v2\n', 'utf8')
  for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test'], ['add', '.'], ['commit', '-m', 'initial']]) {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  const packed = spawnSync('tar', ['-czf', archive, '-C', archiveParent, 'dsh-tavern-main'], { encoding: 'utf8' })
  assert.equal(packed.status, 0, packed.stderr)

  const baseEnvironment = { ...process.env, DSH_HOME: dshHome, DSH_TAVERN_REPOSITORY: source, DSH_TAVERN_TARBALL_URL: `file://${archive}` }
  const first = spawnSync('bash', [setupPath], { env: baseEnvironment, encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  assert.equal(await readFile(path.join(appDir, 'version.txt'), 'utf8'), 'git-v1\n')

  const mockBin = path.join(directory, 'mock-bin')
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  await mkdir(mockBin, { recursive: true })
  await writeFile(path.join(mockBin, 'git'), `#!/usr/bin/env bash\nif [ "\$1" = "-C" ] && [ "\$3" = "fetch" ]; then exit 1; fi\nexec "${realGit}" "\$@"\n`, { encoding: 'utf8', mode: 0o755 })
  const second = spawnSync('bash', [setupPath], { env: { ...baseEnvironment, PATH: `${mockBin}${path.delimiter}${process.env.PATH}` }, encoding: 'utf8' })
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /改用 GitHub 压缩包/)
  assert.equal(await readFile(path.join(appDir, 'version.txt'), 'utf8'), 'tarball-v2\n')
  await access(path.join(appDir, '.dsh-tavern-tarball-source'))
  await assert.rejects(access(path.join(appDir, '.git')))
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
