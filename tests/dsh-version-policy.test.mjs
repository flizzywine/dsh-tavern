import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { adaptedDshVersion, minDshVersion, assertCompatibleDshVersion, desktopReleasesUrl, dshaReleasesUrl, assertCompatibleNodeVersion, hostNodeVersion } from '../bin/dsh-compatibility.mjs'
import { classifyDshVersion, compareDshVersions } from '../tavern-plugin/lib/domain/host-compatibility.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const unix = await readFile(new URL('../install.sh', import.meta.url), 'utf8')

test('宿主按支持范围放行，范围外拦截；CLI 独立运行时仍精确匹配', () => {
  for (const host of ['desktop', 'android']) {
    for (const version of [minDshVersion, adaptedDshVersion, '0.2.1-rc.3', '0.2.2']) assert.doesNotThrow(() => assertCompatibleDshVersion(version, host, '24.9.0'), version)
    for (const version of ['0.1.5-rc.2', '0.3.0-rc.1', '99.0.0']) {
      assert.throws(() => assertCompatibleDshVersion(version, host), error => {
        assert.match(error.message, version.startsWith('0.1.') ? /已停止安装，现有酒馆、存档和宿主都没有改动[^]*要用这个版本[^]*改装稳定版/ : /不在支持范围内；已停止安装/)
        assert.ok(error.message.includes('0.2.0-rc.2 ≤ 版本 < 0.3.0'))
        assert.ok(error.message.includes(host === 'desktop' ? desktopReleasesUrl : dshaReleasesUrl), error.message)
        return true
      })
    }
  }
  assert.doesNotThrow(() => assertCompatibleDshVersion(adaptedDshVersion, 'cli'))
  for (const version of ['', '0.2.0', '99.0.0']) assert.throws(() => assertCompatibleDshVersion(version, 'cli'), /DSH_TAVERN_REINSTALL_RUNTIME/)
})

test('范围下限含预发布、上限按版本线；黑名单与读不出版本拦截', () => {
  const policy = { minDshVersion: '0.2.0-rc.2', belowDshVersion: '0.3.0', blockedDshVersions: ['0.2.1-rc.4'] }
  const rows = { '0.2.0-rc.1': 'blocked', '0.2.0-rc.2': 'allowed', '0.2.0': 'allowed', '0.2.1-rc.10': 'allowed', '0.2.1-rc.4': 'blocked',
    '0.2.99': 'allowed', '0.3.0-rc.1': 'blocked', '0.3.0': 'blocked', '': 'blocked', 'dsh': 'blocked' }
  for (const [version, status] of Object.entries(rows)) assert.equal(classifyDshVersion(version, policy).status, status, version)
  assert.match(classifyDshVersion('0.2.1-rc.4', policy).reason, /已知与酒馆不兼容/)
  assert.ok(compareDshVersions('0.2.1-rc.10', '0.2.1-rc.9') > 0)
  assert.ok(compareDshVersions('0.2.1-rc.1', '0.2.1') < 0)
})

test('安装脚本以 --check 执行检查：范围内退出码 0，范围外非 0', () => {
  const script = fileURLToPath(new URL('../bin/dsh-compatibility.mjs', import.meta.url))
  const ok = spawnSync(process.execPath, [script, '--check', 'android', 'dsh 0.2.0-rc.2'], { encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /在支持范围内/)
  assert.notEqual(spawnSync(process.execPath, [script, '--check', 'desktop', 'dsh 0.3.0'], { encoding: 'utf8' }).status, 0)
})

test('Unix 工具准备只处理 pnpm，不提前复用或更换 DSH', { skip: process.platform === 'win32' }, () => {
  const start = unix.indexOf('# Read the downloaded release')
  const end = unix.indexOf('if [ "${INSTALL_HOST}" = "cli" ] && [ -f', start)
  assert.ok(start >= 0 && end > start)
  const block = unix.slice(start, end)
  // Run the real shell branch while replacing all installation/filesystem effects.
  const mocks = `
command() {
  case "$2" in
    dsh) test "$HAS_DSH" = 1 ;;
    pnpm) test "$HAS_PNPM" = 1 ;;
    *) return 1 ;;
  esac
}
run_install() { shift 2; "$@"; }
assert_installation_active() { :; }
dsh() { node "\${SOURCE_DIR}/bin/dsh-compatibility.mjs" --version; }
pnpm() {
  if [ "$HAS_PNPM" = 1 ]; then printf '%s\n' "$MOCK_PNPM_VERSION"; else return 127; fi
}
mkdir() { :; }
npm() { printf 'INSTALL:%s\\n' "$*"; HAS_DSH=1; HAS_PNPM=1; }
fail() { printf 'FAIL:%s\\n' "$1"; exit 1; }
`
  for (const row of [
    { host: 'cli', dsh: '0', pnpm: '0', packages: ['pnpm@11.25.0'] },
    { host: 'cli', dsh: '0', pnpm: '1', packages: [] },
    { host: 'cli', dsh: '1', pnpm: '0', packages: ['pnpm@11.25.0'] },
    { host: 'cli', dsh: '1', pnpm: '1', pnpmVersion: '12.3.4', packages: ['pnpm@11.25.0'] },
    { host: 'cli', dsh: '1', pnpm: '1', packages: [] },
    { host: 'desktop', dsh: '1', pnpm: '1', packages: [] }
  ]) {
    const result = spawnSync('sh', ['-ec', mocks + block], { encoding: 'utf8', env: {
      ...process.env, SOURCE_DIR: root, RUNTIME_ROOT: '/unused-mocked-runtime',
      INSTALL_HOST: row.host, HAS_DSH: row.dsh, HAS_PNPM: row.pnpm,
      PNPM_VERSION: '11.25.0', MOCK_PNPM_VERSION: row.pnpmVersion || '11.25.0'
    } })
    assert.equal(result.status, 0, result.stderr + result.stdout)
    const installed = result.stdout.split('\n').filter(line => line.startsWith('INSTALL:'))
    assert.deepEqual(installed, row.packages.length ? ['INSTALL:install --global --prefix /unused-mocked-runtime ' + row.packages.join(' ')] : [])
  }
})

test('宿主没有补丁要改的字号代码时跳过（返回 null），不让整个安装回滚', async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { patchThemeFontLimit } = await import('../bin/theme-font-limit.mjs')
  const directory = await mkdtemp(`${tmpdir()}/tavern-theme-untested-`)
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(`${directory}/package.json`, JSON.stringify({ name: '@deepseek-ai/dsh-client-ui-theme', version: '0.2.0' }))
  assert.equal(patchThemeFontLimit(directory), null)
})


test('Node 门禁覆盖 0.2.2 预发布与 24.9 边界，保留旧 DSH / 独立 CLI 的 Node 22', () => {
  for (const dsh of ['0.2.2-alpha.3', '0.2.2-rc.1', '0.2.2', '0.2.3']) {
    for (const node of ['22.22.2', '24.8.9']) {
      assert.throws(() => assertCompatibleDshVersion(dsh, 'desktop', node), /需要 Node.js 24\.9\.0[^]*当前宿主 Node.js/)
    }
    for (const node of ['24.9.0', '24.21.0', '25.0.0']) {
      assert.doesNotThrow(() => assertCompatibleDshVersion(dsh, 'desktop', node))
    }
  }
  assert.doesNotThrow(() => assertCompatibleDshVersion(adaptedDshVersion, 'cli', '22.19.0'))
  assert.doesNotThrow(() => assertCompatibleDshVersion('0.2.1-rc.5', 'android', '22.22.2'))
  assert.throws(() => assertCompatibleNodeVersion(adaptedDshVersion, '22.18.0'), /22\.19\.0/)
  assert.throws(() => assertCompatibleNodeVersion('0.2.2-rc.1', ''), /当前宿主 Node.js 未知/)
})

test('Node 探测使用桌面端指定的运行时，其余宿主使用 PATH 中的 node', () => {
  const env = { DSH_DESKTOP_NODE_EXECUTABLE: '/desktop/node', DSH_DESKTOP_APP_EXECUTABLE: '/desktop/app' }
  const run = (expected, version) => (command, args, options) => {
    assert.equal(command, expected)
    assert.deepEqual(args, ['--version'])
    if (expected !== 'node') assert.equal(options.env.ELECTRON_RUN_AS_NODE, '1')
    return { status: 0, stdout: version }
  }
  assert.equal(hostNodeVersion('desktop', { env, run: run('/desktop/node', 'v24.21.0\n') }), '24.21.0')
  for (const host of ['cli', 'android']) {
    assert.equal(hostNodeVersion(host, { env, run: run('node', 'v22.22.2\n') }), '22.22.2')
  }
  assert.throws(() => hostNodeVersion('desktop', { env, run: () => ({ status: 1, stderr: 'missing runtime' }) }), /无法读取宿主 Node.js/)
})


test('--check 根据指定桌面 Node 退出，不被启动检查的 Node 版本干扰', { skip: process.platform === 'win32' }, async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const directory = await mkdtemp(`${tmpdir()}/tavern-node-check-`)
  t.after(() => rm(directory, { recursive: true, force: true }))
  const executable = `${directory}/desktop node`
  const script = fileURLToPath(new URL('../bin/dsh-compatibility.mjs', import.meta.url))
  for (const [nodeVersion, status] of [['22.22.2', 1], ['24.8.9', 1], ['24.9.0', 0], ['24.21.0', 0]]) {
    await writeFile(executable, `#!/bin/sh\nprintf 'v${nodeVersion}\\n'\n`, { mode: 0o755 })
    const result = spawnSync(process.execPath, [script, '--check', 'desktop', '0.2.2-rc.1'], {
      env: { ...process.env, DSH_DESKTOP_NODE_EXECUTABLE: executable }, encoding: 'utf8'
    })
    assert.equal(result.status, status, result.stderr)
    if (status) {
      assert.match(result.stderr, /需要 Node.js 24\.9\.0/)
      assert.ok(result.stderr.includes(nodeVersion))
      assert.equal(result.stdout, '')
    } else assert.match(result.stdout, /在支持范围内/)
  }
})
