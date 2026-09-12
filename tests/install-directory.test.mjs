import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const source = readFileSync(new URL('../install.sh', import.meta.url), 'utf8')
const selection = source.slice(source.indexOf('  # CLI directory selection:'), source.indexOf('  DSH_TAVERN_CLI_HOME=${DSH_ROOT}'))
test('CLI directory selection accepts explicit paths, refuses collisions and permits retry', { skip: process.platform === 'win32' }, t => {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-location-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const target = path.join(root, '中文 space')
  const run = () => spawnSync('sh', ['-ec', selection], { env: { ...process.env, DSH_TAVERN_CLI_HOME: target }, encoding: 'utf8' })
  mkdirSync(path.join(target, 'runtime'), { recursive: true })
  writeFileSync(path.join(target, 'runtime', 'keep'), 'user data')
  assert.notEqual(run().status, 0)
  assert.equal(readFileSync(path.join(target, 'runtime', 'keep'), 'utf8'), 'user data')
  rmSync(path.join(target, 'runtime'), { recursive: true })
  assert.equal(run().status, 0)
  mkdirSync(path.join(target, 'runtime'))
  assert.equal(run().status, 0)
  assert.equal(readFileSync(path.join(target, '.dsh-tavern-install-root'), 'utf8').trim(), 'cli-v1')
})

test('Desktop 宿主版本不兼容时在覆盖旧安装前停止', { skip: process.platform === 'win32' }, t => {
  const root = mkdtempSync(path.join(tmpdir(), 'tavern-version-preflight-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sentinel = path.join(root, 'installed.txt')
  writeFileSync(sentinel, 'old installation')
  const start = source.indexOf('# Validate the downloaded release against the host')
  const end = source.indexOf('if [ "${INSTALL_HOST}" = "cli" ] &&', start)
  assert.ok(start > 0 && end > start)
  assert.ok(end < source.indexOf('cp -R "${SOURCE_DIR}/."'))
  const preflight = source.slice(start, end)
  for (const version of ['0.1.5-rc.1', 'unknown', '0.1.2-rc.1']) {
    const script = 'dsh() { echo "$TEST_VERSION"; }\n' + preflight + '\nprintf replaced > "$SENTINEL"\n'
    const result = spawnSync('sh', ['-ec', script], { encoding: 'utf8', env: {
      ...process.env, INSTALL_HOST: 'desktop', SOURCE_DIR: path.resolve(new URL('..', import.meta.url).pathname),
      TEST_VERSION: version, SENTINEL: sentinel,
    } })
    if (version === '0.1.2-rc.1') {
      assert.equal(result.status, 0, result.stderr)
      assert.equal(readFileSync(sentinel, 'utf8'), 'replaced')
    } else {
      assert.notEqual(result.status, 0)
      assert.equal(readFileSync(sentinel, 'utf8'), 'old installation')
    }
  }
})

test('PowerShell 在复制安装文件前检查宿主版本并检查命令退出码', () => {
  const windows = readFileSync(new URL('../install.ps1', import.meta.url), 'utf8')
  const check = windows.indexOf('& node $CompatibilityScript --check')
  assert.ok(check > 0 && check < windows.indexOf('Get-ChildItem -LiteralPath $SourceDir.FullName -Force | Copy-Item'))
  assert.match(windows.slice(check), /--check[^\n]+\n\s+Assert-LastCommand/)
})
