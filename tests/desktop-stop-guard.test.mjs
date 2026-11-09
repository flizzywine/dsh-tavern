import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { assertDesktopStopped } from '../bin/import-user-home.mjs'

const root = name => path.resolve('/installs', name)
const gui = installRoot => `"${path.join(installRoot, 'runtime', 'DeepSeek Harness.exe')}" --remote-debugging-port=9334`
const staleUpgradeGui = `"${path.join(path.resolve('/tmp'), 'tavern-cdn-upgrade-x', 'DeepSeek Harness', 'DeepSeek Harness.exe')}"`
// Rows as the process probe prints them: pid, parent pid, command line.
const table = (...rows) => () => rows.map(([id, parent, command]) => `${id} ${parent} ${command}`).join('\r\n')
const check = (installRoot, rows, pid = 1) => () => assertDesktopStopped([path.join(installRoot, 'data', 'harness')], { requireGuiClosed: true, guiRoot: installRoot, pid, exec: table(...rows) })

test('an installer running as its own Harness executable in Node mode does not block itself', () => {
  const installRoot = root('test-3')
  const installer = [30, 20, `${gui(installRoot)} --expose-internals ${path.join(installRoot, 'install.mjs')}`]
  assert.doesNotThrow(check(installRoot, [[20, 2, 'node.exe launcher.mjs'], installer], 30))
  assert.throws(check(installRoot, [[20, 2, 'node.exe launcher.mjs'], installer], 99), /请完整退出 DeepSeek Harness/)
})

test('a NEXT update distinguishes an independent original Profile from an alias to Tavern', () => {
  const installRoot = root('next profile'); const home = path.join(installRoot, 'data', 'harness')
  const original = path.join(home, 'profiles', 'desktop')
  const tavern = path.join(home, 'profiles', 'tavern')
  const app = path.join(home, 'apps', 'dsh-tavern')
  const other = path.join(root('other home'), 'profiles', 'desktop')
  const runtime = path.join(installRoot, 'runtime', 'resources', 'app.asar', 'dsh')
  const exe = path.join(installRoot, 'runtime', 'DeepSeek Harness.exe')
  const host = project => `"${exe}" --expose-internals "${path.join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js')}" "${runtime}" "${project}"`
  const official = [30, 20, gui(installRoot)]
  const renderer = [33, 30, `"${exe}" --type=renderer`]
  const check = (rows, resolveProject = value => value) => assertDesktopStopped([home], { requireGuiClosed: true, pid: 99,
    exec: table(...rows), resolveProject, nextUpdate: { profile: tavern, app, original } })

  assert.deepEqual(check([official, renderer, [32, 30, host(original)]]), { originalDesktopActive: true })
  assert.deepEqual(check([official, renderer, [32, 30, host(other)]]), { originalDesktopActive: false })
  assert.throws(() => check([official, [32, 30, host(other)]], value => value === other ? tavern : value), { code: 'DSH_DESKTOP_RUNNING' })
  assert.throws(() => check([official]), { code: 'DSH_DESKTOP_RUNNING' })
  assert.throws(() => check([[40, 20, `"${path.join(installRoot, 'DSH NEXT.exe')}"`]]), { code: 'DSH_DESKTOP_RUNNING' })
})
