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
