import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pinnedDesktopDsh, resolveDshInvocation } from '../bin/launcher-environment.mjs'

// The one-click Setup validated its bundled DSH, then profile registration
// looked up `dsh` by name and reached the user's own, newer DSH.
test('Windows Desktop installs run the bundled DSH bootstrap, never a `dsh` found by name', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'desktop-dsh-pin-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = path.join(root, 'DSH Desktop.exe'), bootstrap = path.join(root, 'desktop-cli.js')
  await writeFile(executable, ''); await writeFile(bootstrap, '')
  const env = { DSH_DESKTOP_APP_EXECUTABLE: executable, DSH_DESKTOP_DSH_BOOTSTRAP: bootstrap }

  assert.deepEqual(pinnedDesktopDsh('desktop', env, 'win32'), { executable, bootstrap })
  assert.deepEqual(resolveDshInvocation(bootstrap, ['--version'], 'desktop', process.execPath, env, 'win32'),
    { command: executable, args: ['--expose-internals', bootstrap, '--version'], env: { ELECTRON_RUN_AS_NODE: '1' } })

  // Both desktop platforms pin the host; CLI and incomplete environments do not.
  assert.equal(pinnedDesktopDsh('cli', env, 'win32'), null)
  assert.deepEqual(pinnedDesktopDsh('desktop', env, 'darwin'), { executable, bootstrap })
  assert.equal(pinnedDesktopDsh('desktop', { ...env, DSH_DESKTOP_DSH_BOOTSTRAP: path.join(root, 'missing.js') }, 'win32'), null)
  assert.deepEqual(resolveDshInvocation('dsh', ['--version'], 'desktop', process.execPath, env, 'win32'), { command: 'dsh', args: ['--version'] })
})
