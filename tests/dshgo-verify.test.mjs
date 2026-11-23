import { test as nodeTest } from 'node:test'
// dsh-go runs on Android/Termux (POSIX paths, sh and links), which Windows cannot exercise.
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TAVERN_BUNDLES } from '../tavern-plugin/packages/dsh-tavern-dshgo/lib/status.js'

const HOSTS = ['dsh-agent', 'dsh-tools', 'dsh-subagent', 'dsh-skill-filesystem', 'dsh-typert-protocol']

function full(t, { bundles = TAVERN_BUNDLES, dataLink = true, modules = TAVERN_BUNDLES } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'tavern-verify-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const appRoot = join(home, 'app')
  for (const name of ['dsh', ...HOSTS]) {
    mkdirSync(join(appRoot, 'node_modules', '@deepseek-ai', name), { recursive: true })
    writeFileSync(join(appRoot, 'node_modules', '@deepseek-ai', name, 'package.json'), '{"name":"x"}')
  }
  const dir = join(home, 'profiles', 'web')
  mkdirSync(join(dir, 'patches'), { recursive: true })
  for (const name of modules) {
    mkdirSync(join(dir, 'node_modules', name), { recursive: true })
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), '{"name":"x"}')
  }
  for (const name of ['dsh', ...HOSTS]) {
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

test('真 checkBundles 不会被 undefined 的路径带崩', async (t) => {
  const { home, appRoot } = full(t)
  // 走真实的 checkBundles，只把 spawn 换成不存在的可执行文件：拿不到结果也不能抛。
  const { checkBundles } = await import('../tavern-plugin/packages/dsh-tavern-dshgo/lib/preflight.js')
  const result = checkBundles({ dshHome: home, appRoot, execPath: '/nonexistent/node' })
  assert.equal(result.state, 'unknown')
})
