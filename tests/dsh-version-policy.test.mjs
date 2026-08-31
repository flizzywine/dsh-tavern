import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { adaptedDshVersion, dshCompatibilityNotice } from '../bin/dsh-compatibility.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const unix = await readFile(new URL('../install.sh', import.meta.url), 'utf8')
const windows = await readFile(new URL('../install.ps1', import.meta.url), 'utf8')

test('README、安装提示和独立版本查询使用同一适配版本', async () => {
  const config = JSON.parse(await readFile(new URL('../config/dsh-compatibility.json', import.meta.url), 'utf8'))
  assert.equal(adaptedDshVersion, config.adaptedDshVersion)
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.ok(readme.includes(dshCompatibilityNotice().replace(adaptedDshVersion, '`' + adaptedDshVersion + '`')))
  assert.ok(readme.includes('$(node bin/dsh-compatibility.mjs --version)'))
  const result = spawnSync(process.execPath, ['bin/dsh-compatibility.mjs', '--version'], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), adaptedDshVersion)
})

test('匹配版本与其他新旧版本均只提示，不抛错或要求切换版本', () => {
  for (const version of [adaptedDshVersion, '0.1.1-rc.2', '99.0.0']) {
    const notice = dshCompatibilityNotice(version)
    assert.match(notice, /允许使用其他版本/)
    assert.match(notice, /可能导致本插件异常，请自行斟酌/)
    if (version !== adaptedDshVersion) {
      assert.ok(notice.includes('当前 DSH ' + version))
      assert.match(notice, /保留当前版本，继续安装/)
    } else assert.doesNotMatch(notice, /版本不同/)
  }
})

test('两平台都在下载源码后读取版本，补装采用精确版本', () => {
  assert.ok(unix.indexOf('ADAPTED_DSH_VERSION=$(node') > unix.indexOf('[ -f "${SOURCE_DIR}/package.json" ]'))
  assert.ok(windows.indexOf('$AdaptedDshVersion = (& node') > windows.indexOf("Join-Path $SourceDir.FullName 'package.json'"))
  assert.match(unix, /@deepseek-ai\/dsh@\$\{ADAPTED_DSH_VERSION\}/)
  assert.match(windows, /@deepseek-ai\/dsh@\$AdaptedDshVersion/)
  assert.doesNotMatch(unix + windows, /@deepseek-ai\/dsh["']/)
})

test('Unix 实际补装分支：只装缺失工具，已有 DSH 与 Desktop 不重装', { skip: process.platform === 'win32' }, () => {
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
mkdir() { :; }
npm() { printf 'INSTALL:%s\\n' "$*"; HAS_DSH=1; HAS_PNPM=1; }
fail() { printf 'FAIL:%s\\n' "$1"; exit 1; }
`
  for (const row of [
    { host: 'cli', dsh: '0', pnpm: '0', packages: ['pnpm', '@deepseek-ai/dsh@' + adaptedDshVersion] },
    { host: 'cli', dsh: '0', pnpm: '1', packages: ['@deepseek-ai/dsh@' + adaptedDshVersion] },
    { host: 'cli', dsh: '1', pnpm: '0', packages: ['pnpm'] },
    { host: 'cli', dsh: '1', pnpm: '1', packages: [] },
    { host: 'desktop', dsh: '1', pnpm: '1', packages: [] }
  ]) {
    const result = spawnSync('sh', ['-ec', mocks + block], { encoding: 'utf8', env: {
      ...process.env, SOURCE_DIR: root, RUNTIME_ROOT: '/unused-mocked-runtime',
      INSTALL_HOST: row.host, HAS_DSH: row.dsh, HAS_PNPM: row.pnpm
    } })
    assert.equal(result.status, 0, result.stderr + result.stdout)
    const installed = result.stdout.split('\n').filter(line => line.startsWith('INSTALL:'))
    assert.deepEqual(installed, row.packages.length ? ['INSTALL:install --global --prefix /unused-mocked-runtime ' + row.packages.join(' ')] : [])
  }
})
