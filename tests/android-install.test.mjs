import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createEntryHandler, createEntryManager, resolveEntryConfig } from '../android/dsh-tavern-entry/index.js'
import { configureAndroidProfiles } from '../android/configure-profiles.mjs'

const root = new URL('../', import.meta.url)

const entryClient = await readFile(new URL('../android/dsh-tavern-entry/client.js', import.meta.url), 'utf8')

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

test('Android 入口只使用当前 Tavern 进程通过鉴权的完整地址并安全重定向', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-android-access-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const dshHome = path.join(home, '.dsh')
  const appDir = path.join(home, 'apps', 'dsh-tavern')
  const logs = path.join(dshHome, 'logs')
  await mkdir(path.join(appDir, 'bin'), { recursive: true })
  await mkdir(logs, { recursive: true })
  await writeFile(path.join(appDir, 'bin', 'dsh-tavern.mjs'), '', 'utf8')
  const old = 'dsh web: http://127.0.0.1:3088/?token=old\n'
  const current = 'dsh web: http://127.0.0.1:3088/?token=current\n'
  await writeFile(path.join(logs, 'tavern.log'), old + current, 'utf8')
  await writeFile(path.join(logs, 'tavern.pid.json'), JSON.stringify({ pid: 123, port: 3088, logOffset: Buffer.byteLength(old) }), 'utf8')
  const calls = []
  const manager = createEntryManager({
    env: { DSH_HOME: dshHome, DSH_TAVERN_ANDROID_APP_DIR: appDir },
    home,
    portProbe: async () => true,
    request: async (url, options) => {
      calls.push({ url, options })
      return { status: url.includes('token=current') ? 303 : 401, body: { cancel() {} } }
    },
  })

  assert.equal(await manager.accessUrl(), 'http://127.0.0.1:3088/?token=current')
  assert.deepEqual(calls.map(call => call.url), ['http://127.0.0.1:3088/?token=current'])
  assert.equal(calls[0].options.redirect, 'manual')

  const response = { status: 0, headers: {}, body: undefined,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(body) { this.body = body },
  }
  await createEntryHandler(manager)({
    method: 'GET', url: '/api/dsh-tavern-android/open', headers: { origin: 'http://127.0.0.1:3080' },
  }, response)
  assert.equal(response.status, 302)
  assert.equal(response.headers.Location, 'http://127.0.0.1:3088/?token=current')
  assert.equal(response.headers['Cache-Control'], 'no-store')
})

test('Android 入口复用当前 WebView 的 DSHA 鉴权 Cookie', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-android-cookie-access-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const dshHome = path.join(home, '.dsh')
  const appDir = path.join(home, 'apps', 'dsh-tavern')
  const logs = path.join(dshHome, 'logs')
  await mkdir(path.join(appDir, 'bin'), { recursive: true })
  await mkdir(logs, { recursive: true })
  await writeFile(path.join(appDir, 'bin', 'dsh-tavern.mjs'), '', 'utf8')
  await writeFile(path.join(logs, 'tavern.log'), 'dsh web: http://127.0.0.1:3088\n', 'utf8')
  await writeFile(path.join(logs, 'tavern.pid.json'), JSON.stringify({ pid: 123, port: 3088, logOffset: 0 }), 'utf8')
  const manager = createEntryManager({
    env: { DSH_HOME: dshHome, DSH_TAVERN_ANDROID_APP_DIR: appDir },
    home,
    portProbe: async () => true,
    request: async () => new Response('forbidden', { status: 403 }),
  })

  assert.equal(await manager.accessUrl(), 'http://127.0.0.1:3088/')
})

test('Android 入口在 Tavern 离线时仍可启动更新或修复', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-android-manager-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const appDir = path.join(home, 'apps', 'dsh-tavern')
  const launcher = path.join(appDir, 'bin', 'dsh-tavern.mjs')
  await mkdir(path.dirname(launcher), { recursive: true })
  await writeFile(launcher, '#!/usr/bin/env node\n', 'utf8')
  const currentCommit = 'a'.repeat(40)
  const latestCommit = 'b'.repeat(40)
  await writeFile(path.join(appDir, 'package.json'), JSON.stringify({ version: '1.1.0' }))
  await writeFile(path.join(appDir, '.dsh-tavern-release.json'), JSON.stringify({ commit: currentCommit }))
  t.mock.method(globalThis, 'fetch', async (url) => {
    const value = String(url).endsWith('/package.json') ? { version: '1.1.0' }
      : String(url).endsWith('/commits/0.2.1%E7%89%88%E6%9C%AC') ? { sha: latestCommit }
      : String(url).endsWith(`/compare/${currentCommit}...${latestCommit}`) ? { status: 'ahead', base_commit: { sha: currentCommit } }
      : assert.fail(`unexpected request: ${url}`)
    return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
  })
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
    update: { phase: 'idle', host: 'android', currentVersion: '1.1.0', currentCommit },
  })
  const started = await manager.update()
  assert.equal(started.installed, true)
  assert.equal(started.online, false)
  // The installation lock owns the attempt identity and start time.
  const { attemptId, startedAt, ...update } = started.update
  assert.match(attemptId, /^[0-9a-f-]{36}$/)
  assert.ok(Number.isFinite(startedAt))
  assert.deepEqual({ ...update, stage: update.stage, progressAt: update.progressAt }, { phase: 'running', host: 'android', currentVersion: '1.1.0', currentCommit,
    latestVersion: '1.1.0', latestCommit, checkSource: 'github', cancellable: false, pid: 0, stage: undefined, progressAt: undefined, stalled: false })
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

for (const initialVersion of ['cached', '10.34.5', 'missing', 'install-failed', 'standalone', 'restored', 'restored-failed', 'invalid-install', 'swap-failed']) {
test(`Android 安装固定 pnpm 并先安装依赖再停止旧服务：${initialVersion}`, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-android-install-order-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const dshHome = path.join(directory, 'dsh-home')
  const mockBin = path.join(directory, 'mock-bin')
  const events = path.join(directory, 'events')
  const dependenciesReady = path.join(directory, 'dependencies-ready')
  const versionFile = path.join(directory, 'pnpm-version')
  await writeFile(versionFile, '11.25.0')
  const pnpmRoot = path.join(dshHome, 'runtime', 'tavern-pnpm', '11.25.0')
  const managedPnpm = path.join(pnpmRoot, 'bin', 'pnpm')
  const fixturePnpm = path.join(directory, 'managed-pnpm')
  for (const profile of ['tavern', 'web']) {
    const profileDir = path.join(dshHome, 'profiles', profile)
    await mkdir(profileDir, { recursive: true })
    await writeFile(path.join(profileDir, 'package.json'), '{}\n', 'utf8')
  }
  await mkdir(mockBin, { recursive: true })
  await writeFile(fixturePnpm, `#!/usr/bin/env bash
set -euo pipefail
if [ "\$1" = "--version" ]; then
  version=$(cat "${versionFile}")
  [ "\$version" != missing ] || exit 127
  printf '%s\\n' "\$version"
  exit 0
fi
[ "\$1" = "--config.update-notifier=false" ] || exit 93
shift
if [ "\$1" = "--dir" ] && [ "\$2" = "${new URL('..', import.meta.url).pathname.replace(/\/$/, '')}" ]; then
  printf 'dependencies\\n' >> "${events}"
  : > "${dependenciesReady}"
fi
`, { mode: 0o755 })
  if (initialVersion !== 'missing') await writeFile(path.join(mockBin, 'pnpm'), '#!/usr/bin/env bash\nprintf "10.34.5\\n"\n', { mode: 0o755 })
  if (initialVersion === 'cached') {
    await mkdir(path.dirname(managedPnpm), { recursive: true })
    await writeFile(managedPnpm, await readFile(fixturePnpm), { mode: 0o755 })
  }
  if (initialVersion.startsWith('restored') || ['invalid-install', 'swap-failed'].includes(initialVersion)) {
    await mkdir(path.dirname(managedPnpm), { recursive: true })
    await writeFile(managedPnpm, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    await writeFile(path.join(pnpmRoot, 'bin/pn'), 'restored ordinary file')
  }
  await writeFile(path.join(mockBin, 'npm'), `#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\\n' "\$*" >> "${events}"
[ "${initialVersion}" != install-failed ] && [ "${initialVersion}" != restored-failed ] || exit 1
[ "\$1 \$2 \$3 \$5" = "install --global --prefix pnpm@11.25.0" ] || exit 92
prefix="\$4"
[ ! -f "\$prefix/bin/pn" ] || { echo EEXIST >&2; exit 1; }
mkdir -p "\$prefix/bin"
cp "${fixturePnpm}" "\$prefix/bin/pnpm"
if [ "${initialVersion}" = invalid-install ]; then printf 'missing' > "${versionFile}"; fi
`, { mode: 0o755 })
  if (initialVersion === 'swap-failed') await writeFile(path.join(mockBin, 'mv'), `#!/usr/bin/env bash
if [[ "\$2" == *.install.* ]] && [[ "\$2" != *.previous ]] && [ "\$3" = "${pnpmRoot}" ]; then exit 1; fi
exec /bin/mv "\$@"
`, { mode: 0o755 })
  await writeFile(path.join(mockBin, 'dsh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
  await writeFile(path.join(mockBin, 'node'), `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  -) exit 0 ;;
  --expose-internals) exit 0 ;;
  */bin/dsh-tavern.mjs)
    [ "$(command -v pnpm)" = "${managedPnpm}" ] || exit 94
    [ "\${pnpm_config_update_notifier:-}" = false ] || exit 95
    action="\${2:-}"
    if [ "\${action}" = stop ] && [ ! -f "${dependenciesReady}" ]; then
      printf 'stop-before-dependencies\\n' >> "${events}"
      exit 91
    fi
    printf '%s\\n' "\${action}" >> "${events}"
    exit 0
    ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 })

  const result = spawnSync('bash', [new URL('../android/install.sh', import.meta.url).pathname], {
    env: { ...process.env, DSH_HOME: dshHome, DSH_TAVERN_ANDROID_STANDALONE: initialVersion === 'standalone' ? '1' : '0', PATH: `${mockBin}${path.delimiter}${process.env.PATH}` },
    encoding: 'utf8',
  })
  const recorded = (await readFile(events, 'utf8')).replace(/11\.25\.0\.install\.[^ \n]+/g, '11.25.0').trim().split('\n')
  if (['install-failed', 'restored-failed', 'invalid-install', 'swap-failed'].includes(initialVersion)) {
    if (['restored-failed', 'invalid-install', 'swap-failed'].includes(initialVersion)) assert.equal(await readFile(path.join(pnpmRoot, 'bin/pn'), 'utf8'), 'restored ordinary file')
    assert.notEqual(result.status, 0)
    const siblings = await readdir(path.dirname(pnpmRoot)).catch(() => [])
    assert.equal(siblings.some(name => name.includes('.install.')), false, 'temporary prefixes must be cleaned')
    assert.deepEqual(recorded, [`npm install --global --prefix ${pnpmRoot} pnpm@11.25.0`])
    return
  }
  assert.equal(result.status, 0, result.stderr)
  const expected = initialVersion === 'cached' ? [] : [`npm install --global --prefix ${pnpmRoot} pnpm@11.25.0`]
  if (initialVersion === 'standalone') {
    assert.deepEqual(recorded, [...expected, 'dependencies', 'install'])
    assert.match(result.stdout, /返回 DSH Tavern 应用并重新启动/)
    return
  }
  assert.deepEqual(recorded.slice(0, expected.length + 3), [...expected, 'dependencies', 'stop', 'install'])
})
}

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
  const documentImages = ['docs/images/readme/overview.png', 'tavern-plugin/packages/dsh-image-gen/docs/assets/demo.png']
  for (const file of documentImages) {
    await mkdir(path.dirname(path.join(source, file)), { recursive: true })
    await writeFile(path.join(source, file), 'documentation image')
  }
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

  const installedSource = path.join(dshHome, 'apps', 'dsh-tavern')
  for (const file of documentImages) await assert.rejects(access(path.join(installedSource, file)))
  // Emulate an installation from before sparse updates, then exercise its migration.
  const fullCheckout = spawnSync('git', ['-C', installedSource, 'sparse-checkout', 'disable'], { encoding: 'utf8' })
  assert.equal(fullCheckout.status, 0, fullCheckout.stderr)
  for (const file of documentImages) await access(path.join(installedSource, file))
  await writeFile(path.join(source, 'version.txt'), 'next\n', 'utf8')
  for (const args of [['add', '.'], ['commit', '-m', 'next']]) {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  const second = spawnSync('bash', [new URL('../android/setup.sh', import.meta.url).pathname], { env: environment, encoding: 'utf8' })
  assert.equal(second.status, 0, second.stderr)
  for (const file of documentImages) await assert.rejects(access(path.join(installedSource, file)))
  assert.equal(await readFile(path.join(dshHome, 'setup-runs'), 'utf8'), 'installed\ninstalled\n')
  assert.equal(await readFile(path.join(dshHome, 'apps', 'dsh-tavern', 'version.txt'), 'utf8'), 'next\n')

  await writeFile(path.join(dshHome, 'apps', 'dsh-tavern', 'version.txt'), 'user change\n', 'utf8')
  const protectedUpdate = spawnSync('bash', [new URL('../android/setup.sh', import.meta.url).pathname], { env: environment, encoding: 'utf8' })
  assert.notEqual(protectedUpdate.status, 0)
  assert.match(protectedUpdate.stderr, /存在未提交修改/)
  assert.equal(await readFile(path.join(dshHome, 'apps', 'dsh-tavern', 'version.txt'), 'utf8'), 'user change\n')

  await writeFile(path.join(dshHome, 'apps', 'dsh-tavern', 'version.txt'), 'next\n', 'utf8')
  const installed = path.join(dshHome, 'apps', 'dsh-tavern')
  for (const args of [['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test']]) {
    const result = spawnSync('git', args, { cwd: installed, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  await writeFile(path.join(installed, 'dsh-tavern-runtime.json'), '{"generated":true}\n', 'utf8')
  for (const args of [['add', 'dsh-tavern-runtime.json'], ['commit', '-m', 'chore: publish runtime manifest [skip ci]']]) {
    const result = spawnSync('git', args, { cwd: installed, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  await writeFile(path.join(source, 'version.txt'), 'remote-after-manifest\n', 'utf8')
  for (const args of [['add', '.'], ['commit', '-m', 'remote update']]) {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  const recovered = spawnSync('bash', [new URL('../android/setup.sh', import.meta.url).pathname], { env: environment, encoding: 'utf8' })
  assert.equal(recovered.status, 0, recovered.stderr)
  assert.match(recovered.stdout, /运行清单分叉/)
  assert.equal(await readFile(path.join(installed, 'version.txt'), 'utf8'), 'remote-after-manifest\n')

  await writeFile(path.join(installed, 'local.txt'), 'user commit\n', 'utf8')
  for (const args of [['add', 'local.txt'], ['commit', '-m', 'user commit']]) {
    const result = spawnSync('git', args, { cwd: installed, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  await writeFile(path.join(source, 'version.txt'), 'another remote update\n', 'utf8')
  for (const args of [['add', '.'], ['commit', '-m', 'another remote update']]) {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }
  const protectedCommit = spawnSync('bash', [new URL('../android/setup.sh', import.meta.url).pathname], { env: environment, encoding: 'utf8' })
  assert.notEqual(protectedCommit.status, 0)
  assert.match(protectedCommit.stderr, /本地提交或已经分叉/)
  assert.equal(await readFile(path.join(installed, 'local.txt'), 'utf8'), 'user commit\n')
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
    for (const file of ['docs/images/readme/demo.png', 'tavern-plugin/packages/dsh-image-gen/docs/assets/demo.png']) {
      await mkdir(path.dirname(path.join(source, file)), { recursive: true })
      await writeFile(path.join(source, file), 'documentation image')
    }
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
  await assert.rejects(access(path.join(appDir, 'docs')))
  await assert.rejects(access(path.join(appDir, 'tavern-plugin/packages/dsh-image-gen/docs')))
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

test('DSHA 升级留下的空依赖目录可安全重装，真实用户文件仍受保护', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-android-upgrade-residue-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = path.join(directory, 'source')
  await mkdir(path.join(source, 'android'), { recursive: true })
  await mkdir(path.join(source, 'bin'), { recursive: true })
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'dsh-profile-tavern' }), 'utf8')
  await writeFile(path.join(source, 'bin', 'dsh-tavern.mjs'), '', 'utf8')
  await writeFile(path.join(source, 'android', 'install.sh'), '#!/usr/bin/env bash\n', 'utf8')
  for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'test@example.com'], ['config', 'user.name', 'Test'], ['add', '.'], ['commit', '-m', 'initial']]) {
    const result = spawnSync('git', args, { cwd: source, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  }

  const setupPath = new URL('../android/setup.sh', import.meta.url).pathname
  const dshHome = path.join(directory, 'dsh-home')
  const appDir = path.join(dshHome, 'apps', 'dsh-tavern')
  await mkdir(path.join(appDir, 'node_modules', '.bin'), { recursive: true })
  await mkdir(path.join(appDir, 'tavern-plugin', 'node_modules', '.bin'), { recursive: true })
  await symlink('../missing-package/bin.js', path.join(appDir, 'node_modules', '.bin', 'generated-link'))
  const environment = { ...process.env, DSH_HOME: dshHome, DSH_TAVERN_REPOSITORY: source }

  const recovered = spawnSync('bash', [setupPath], { env: environment, encoding: 'utf8' })
  assert.equal(recovered.status, 0, recovered.stderr)
  assert.match(recovered.stdout, /DSHA 升级残留/)
  await access(path.join(appDir, 'package.json'))

  await rm(appDir, { recursive: true, force: true })
  await mkdir(appDir, { recursive: true })
  await writeFile(path.join(appDir, 'user-notes.txt'), 'keep me\n', 'utf8')
  const protectedInstall = spawnSync('bash', [setupPath], { env: environment, encoding: 'utf8' })
  assert.notEqual(protectedInstall.status, 0)
  assert.match(protectedInstall.stderr, /不是受支持的 Git 或压缩包安装/)
  assert.equal(await readFile(path.join(appDir, 'user-notes.txt'), 'utf8'), 'keep me\n')
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

test('Android Profile 配置保留已有内容并幂等加入所需插件', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-android-profiles-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const tavern = path.join(directory, 'profiles', 'tavern')
  const web = path.join(directory, 'profiles', 'web')
  await mkdir(tavern, { recursive: true })
  await mkdir(web, { recursive: true })
  const initial = {
    private: true,
    dependencies: { existing: '1.0.0', 'dsh-client-ui-mobile-adapt': 'link:/old/mobile-adapt' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'existing', 'dsh-client-ui-mobile-adapt'] } },
  }
  await writeFile(path.join(tavern, 'package.json'), JSON.stringify(initial), 'utf8')
  await writeFile(path.join(web, 'package.json'), JSON.stringify(initial), 'utf8')

  configureAndroidProfiles({ repoRoot: new URL('..', import.meta.url).pathname, tavernProfile: tavern, webProfile: web })
  configureAndroidProfiles({ repoRoot: new URL('..', import.meta.url).pathname, tavernProfile: tavern, webProfile: web })

  const tavernPkg = JSON.parse(await readFile(path.join(tavern, 'package.json'), 'utf8'))
  const webPkg = JSON.parse(await readFile(path.join(web, 'package.json'), 'utf8'))
  assert.equal(tavernPkg.dependencies.existing, '1.0.0')
  assert.equal(tavernPkg.dependencies['dsh-client-ui-mobile-adapt'], undefined)
  assert.equal(webPkg.dependencies['dsh-client-ui-mobile-adapt'], undefined)
  assert.equal(tavernPkg.dsh.profile.bundles.includes('dsh-client-ui-mobile-adapt'), false)
  assert.equal(webPkg.dsh.profile.bundles.includes('dsh-client-ui-mobile-adapt'), false)
  assert.equal(webPkg.dsh.profile.bundles.filter((name) => name === 'dsh-tavern-entry').length, 1)
  assert.match(webPkg.dependencies['dsh-tavern-entry'], /^link:\//)
  const linkedEntry = JSON.parse(await readFile(path.join(web, 'node_modules', 'dsh-tavern-entry', 'package.json'), 'utf8'))
  assert.equal(linkedEntry.name, 'dsh-tavern-entry')
})

test('Android 入口链接跨越宿主 rootfs 与 proot 路径后仍可解析', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-android-rootfs-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const originalRootfs = path.join(directory, 'rootfs-before')
  const movedRootfs = path.join(directory, 'rootfs-after')
  const dshRoot = path.join(originalRootfs, 'root', '.dsh')
  const repo = path.join(dshRoot, 'apps', 'dsh-tavern')
  const tavern = path.join(dshRoot, 'profiles', 'tavern')
  const web = path.join(dshRoot, 'profiles', 'web')
  await mkdir(path.join(repo, 'android', 'dsh-tavern-entry'), { recursive: true })
  await mkdir(tavern, { recursive: true })
  await mkdir(web, { recursive: true })
  await writeFile(path.join(repo, 'android', 'dsh-tavern-entry', 'package.json'), JSON.stringify({ name: 'dsh-tavern-entry' }), 'utf8')
  await writeFile(path.join(tavern, 'package.json'), '{}\n', 'utf8')
  await writeFile(path.join(web, 'package.json'), '{}\n', 'utf8')

  configureAndroidProfiles({ repoRoot: repo, tavernProfile: tavern, webProfile: web })
  const link = path.join(web, 'node_modules', 'dsh-tavern-entry')
  assert.equal(path.isAbsolute(await readlink(link)), false)

  await rename(originalRootfs, movedRootfs)
  const linkedEntry = JSON.parse(await readFile(path.join(movedRootfs, 'root', '.dsh', 'profiles', 'web', 'node_modules', 'dsh-tavern-entry', 'package.json'), 'utf8'))
  assert.equal(linkedEntry.name, 'dsh-tavern-entry')
})

test('Android 入口不复用本次启动之前的旧鉴权地址', async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), 'dsh-android-log-offset-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const logs = path.join(home, '.dsh', 'logs')
  await mkdir(logs, { recursive: true })
  const old = 'dsh web: http://127.0.0.1:3088/?token=old\n'
  await writeFile(path.join(logs, 'tavern.log'), old + 'starting new service\n')
  await writeFile(path.join(logs, 'tavern.pid.json'), JSON.stringify({ port: 3088, logOffset: Buffer.byteLength(old) }))
  const calls = []
  const manager = createEntryManager({ home, env: {}, portProbe: async () => true, request: async url => { calls.push(url); return { status: 200 } } })
  assert.equal(await manager.accessUrl(), 'http://127.0.0.1:3088/')
  assert.deepEqual(calls, ['http://127.0.0.1:3088/'])
})
