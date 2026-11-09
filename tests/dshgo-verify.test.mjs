import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { formatChecks, runChecks } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/verify.js'
import { TAVERN_BUNDLES } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/status.js'

const HOSTS = ['dsh-agent', 'dsh-tools', 'dsh-subagent', 'dsh-skill-filesystem', 'dsh-typert-protocol']

function full(t, { bundles = TAVERN_BUNDLES, dataLink = true, modules = TAVERN_BUNDLES } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'tavern-verify-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const appRoot = join(home, 'app')
  mkdirSync(join(appRoot, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true })
  const dir = join(home, 'profiles', 'web')
  mkdirSync(join(dir, 'patches'), { recursive: true })
  for (const name of modules) {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true })
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), '{"name":"x"}')
  }
  for (const name of HOSTS) {
    mkdirSync(join(dir, 'node_modules', '@deepseek-ai', name), { recursive: true })
    writeFileSync(join(dir, 'node_modules', '@deepseek-ai', name, 'package.json'), '{"name":"x"}')
  }
  for (const file of ['dsh-better-sidebar@0.28.0.patch', 'dsh-web-mobile@3.1.0.patch']) writeFileSync(join(dir, 'patches', file), '')
  mkdirSync(join(home, 'dsh-go', 'tavern-data'), { recursive: true })
  mkdirSync(join(home, 'profile-data'), { recursive: true })
  if (dataLink) symlinkSync('../dsh-go/tavern-data', join(home, 'profile-data', 'tavern'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    dependencies: Object.fromEntries(TAVERN_BUNDLES.map(name => [name, 'link:/src/tavern-plugin'])),
    dsh: { profile: { bundles } },
  }, null, 2))
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), ['overrides:', ...HOSTS.map(name => `  @deepseek-ai/${name}: link:${appRoot}/node_modules/@deepseek-ai/${name}`), ''].join('\n'))
  return { home, appRoot }
}

const okCheck = { state: 'ok', fatal: [], ignored: [], error: null }

test('九项全过、但还没启用时，指向面板的启用按钮', (t) => {
  const { home, appRoot } = full(t, { bundles: [] })
  const result = runChecks({ home, appRoot, nodeVersion: 'v24.22.1', check: () => okCheck })
  assert.equal(result.veredict, 'pass')
  assert.equal(result.failed.length, 0)
  assert.match(result.next, /启用酒馆/)
})

test('已启用且全过时，下一步是重启引擎而不是再启用一次', (t) => {
  const { home, appRoot } = full(t)
  const result = runChecks({ home, appRoot, nodeVersion: 'v24.22.1', check: () => okCheck })
  assert.match(formatChecks(result), /九项全过/)
  assert.match(result.next, /重启/)
})

test('包没装齐时先说装包，且不冒充加载检查通过', (t) => {
  const { home, appRoot } = full(t, { modules: TAVERN_BUNDLES.slice(0, 3) })
  const result = runChecks({ home, appRoot, nodeVersion: 'v24.22.1', check: () => okCheck })
  assert.equal(result.veredict, 'fail')
  assert.match(result.next, /install-on-dshgo/)
  const line = formatChecks(result).split('\n').find(text => text.includes('宿主愿意加载'))
  assert.match(line, /没验成/)
})

test('存档是实体目录时单独指出来，下一步是挪目录', (t) => {
  const { home, appRoot } = full(t, { dataLink: false })
  mkdirSync(join(home, 'profile-data', 'tavern'), { recursive: true })
  const result = runChecks({ home, appRoot, nodeVersion: 'v24.22.1', check: () => okCheck })
  const item = result.checks.find(check => check.title.includes('存档'))
  assert.equal(item.pass, false)
  assert.match(item.fix, /挪到 dsh-go\/tavern-data/)
})

test('宿主会跳过酒馆的包时，把包名说出来', (t) => {
  const { home, appRoot } = full(t)
  const result = runChecks({
    home, appRoot, nodeVersion: 'v24.22.1',
    check: () => ({ state: 'fatal', fatal: [{ packageName: 'dsh-tavern-tts', reason: 'cannot resolve' }], ignored: [], error: null }),
  })
  const item = result.checks.find(check => check.title.includes('宿主愿意加载'))
  assert.equal(item.pass, false)
  assert.match(item.detail, /dsh-tavern-tts/)
})

test('Node 太旧时第 2 项不过', (t) => {
  const { home, appRoot } = full(t)
  const result = runChecks({ home, appRoot, nodeVersion: 'v22.1.0', check: () => okCheck })
  assert.equal(result.checks[1].pass, false)
})

test('formatChecks：九行加总结，序号连续', (t) => {
  const { home, appRoot } = full(t)
  const text = formatChecks(runChecks({ home, appRoot, nodeVersion: 'v24.22.1', check: () => okCheck }))
  const lines = text.split('\n').filter(line => line.startsWith('✅') || line.startsWith('❌'))
  assert.equal(lines.length, 9)
  assert.match(lines[0], /1\/9/)
  assert.match(lines[8], /9\/9/)
})

test('传给加载检查的是 dshHome：名字对不上会直接崩（真机踩过）', (t) => {
  const { home, appRoot } = full(t)
  let received = null
  runChecks({
    home, appRoot, nodeVersion: 'v24.22.1',
    check: (options) => { received = options; return okCheck },
  })
  assert.equal(received.dshHome, home)
  assert.equal(received.appRoot, appRoot)
  assert.equal(received.timeout, 4000)
})

test('真 checkBundles 不会被 undefined 的路径带崩', async (t) => {
  const { home, appRoot } = full(t)
  // 走真实的 checkBundles，只把 spawn 换成不存在的可执行文件：拿不到结果也不能抛。
  const { checkBundles } = await import('../tavern-plugin/packages/dsh-tavern-dshgo/lib/preflight.js')
  const result = checkBundles({ dshHome: home, appRoot, execPath: '/nonexistent/node' })
  assert.equal(result.state, 'unknown')
})
