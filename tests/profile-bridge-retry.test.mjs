import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, realpathSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { switchProfile, renameWithRetry } from '../tavern-plugin/packages/dsh-tavern/lib/helper.mjs'
import { runSwitchJob } from '../tavern-plugin/packages/dsh-tavern/lib/worker.mjs'

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'pb-retry-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const profilesRoot = join(home, 'profiles')
  for (const name of ['desktop', 'tavern']) {
    mkdirSync(join(profilesRoot, name), { recursive: true })
    writeFileSync(join(profilesRoot, name, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [] } } }))
    writeFileSync(join(profilesRoot, name, 'save'), `${name} bytes`)
  }
  const stateDir = join(home, 'profile-bridge')
  mkdirSync(stateDir)
  return { mode: 'link', profilesRoot, liveDir: join(profilesRoot, 'desktop'), targetDir: join(profilesRoot, 'tavern'), stateDir, stamp: 'test', pids: [], relaunch: 'fake-desktop' }
}
const busy = () => Object.assign(new Error('sharing violation'), { code: 'EBUSY' })
function clock() {
  let time = 0
  return { platform: 'win32', timeout: 20, interval: 10, now: () => time, delay: async ms => { time += ms } }
}
function job(request) {
  const lock = join(request.stateDir, 'pending')
  mkdirSync(lock)
  const path = join(lock, 'request.json')
  writeFileSync(path, JSON.stringify(request))
  return path
}

test('Windows sharing retries are bounded; permanent and non-Windows errors are not retried', async () => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    let calls = 0
    await assert.rejects(renameWithRetry('a', 'b', { ...clock(), rename: () => { calls++; throw Object.assign(Error('locked'), { code }) } }), /目录仍被占用/)
    assert.equal(calls, 3)
  }
  for (const [platform, code] of [['win32', 'ENOENT'], ['linux', 'EBUSY']]) {
    let calls = 0
    await assert.rejects(renameWithRetry('a', 'b', { ...clock(), platform, rename: () => { calls++; throw Object.assign(Error('stop'), { code }) } }), /stop/)
    assert.equal(calls, 1)
  }
})

test('blocked first move preserves original bytes, target bytes and removes only staging link', async t => {
  const request = fixture(t)
  await assert.rejects(switchProfile(request, { retry: clock(), rename: () => { throw busy() } }), /目录仍被占用/)
  assert.equal(readFileSync(join(request.liveDir, 'save'), 'utf8'), 'desktop bytes')
  assert.equal(readFileSync(join(request.targetDir, 'save'), 'utf8'), 'tavern bytes')
  assert.deepEqual(readdirSync(request.profilesRoot).sort(), ['desktop', 'tavern'])
})

test('retry releases lock and round trip preserves both profiles; reverse publish failure rolls back junction', async t => {
  const request = fixture(t)
  let blocked = true
  await switchProfile(request, { retry: { ...clock(), onRetry: () => { blocked = false } }, rename: (a, b) => { if (blocked) throw busy(); renameSync(a, b) } })
  assert.equal(realpathSync(request.liveDir), realpathSync(request.targetDir))
  await assert.rejects(switchProfile({ ...request, mode: 'unlink', stamp: 'reverse' }, { retry: clock(), rename: (a, b) => { if (a.includes('.fresh-')) throw busy(); renameSync(a, b) } }), /目录仍被占用/)
  assert.equal(realpathSync(request.liveDir), realpathSync(request.targetDir))
  await switchProfile({ ...request, mode: 'unlink', stamp: 'again' })
  assert.equal(readFileSync(join(request.liveDir, 'save'), 'utf8'), 'desktop bytes')
  assert.equal(readFileSync(join(request.targetDir, 'save'), 'utf8'), 'tavern bytes')
})

test('worker persists success before relaunch and cleans owned leftovers only after root exit on lock failure', async t => {
  const request = { ...fixture(t), ownership: { roots: [], descendants: [] } }
  const order = []
  let blocked = true
  const result = await runSwitchJob(job(request), {
    waitOwned: async () => { order.push('exited') },
    cleanup: async () => { order.push('cleanup'); blocked = false },
    perform: (r, options) => switchProfile(r, { retry: { ...options.retry, ...clock() }, rename: (a, b) => { if (blocked) throw busy(); renameSync(a, b) } }),
    relaunch: () => { order.push('relaunch'); assert.equal(JSON.parse(readFileSync(join(request.stateDir, 'last-result.json'))).status, 'succeeded') },
  })
  assert.equal(result, 0)
  assert.deepEqual(order, ['exited', 'cleanup', 'relaunch'])
  assert.equal(existsSync(join(request.stateDir, 'pending')), false)
})

test('worker reports failed rollback with backup and never reopens missing entry', async t => {
  const request = fixture(t)
  let calls = 0
  const result = await runSwitchJob(job(request), {
    perform: r => switchProfile(r, { retry: clock(), rename: (a, b) => { if (++calls > 1) throw busy(); renameSync(a, b) } }),
    relaunch: () => assert.fail('must not reopen after failed recovery'),
  })
  assert.equal(result, 1)
  const status = JSON.parse(readFileSync(join(request.stateDir, 'last-result.json')))
  assert.equal(status.recoveryRequired, true)
  assert.match(status.message, /desktop.fresh-test/)
  assert.equal(existsSync(request.liveDir), false)
  assert.equal(readFileSync(join(request.profilesRoot, 'desktop.fresh-test', 'save'), 'utf8'), 'desktop bytes')
  assert.equal(readFileSync(join(request.targetDir, 'save'), 'utf8'), 'tavern bytes')
})

test('launcher finishes installation without waiting for or restarting Desktop', async t => {
  const request = { ...fixture(t), mode: 'install', ownership: { roots: [], descendants: [{ pid: 10 }] } }
  const order = []
  const result = await runSwitchJob(job(request), {
    waitOwned: async () => assert.fail('installation must not wait for Desktop'),
    perform: async () => {
      order.push('install')
      return { installed: true }
    },
    relaunch: () => assert.fail('installation must not relaunch Desktop'),
  })
  assert.equal(result, 0)
  assert.deepEqual(order, ['install'])
  const status = JSON.parse(readFileSync(join(request.stateDir, 'last-result.json')))
  assert.equal(status.mode, 'install')
  assert.equal(status.status, 'succeeded')
})

test('normal quit timeout never cleans descendants, changes directories, or relaunches', async t => {
  const request = fixture(t)
  assert.equal(await runSwitchJob(job(request), {
    wait: async () => { throw Error('quit timeout') },
    cleanup: () => assert.fail('not exited'),
    relaunch: () => assert.fail('not exited'),
  }), 1)
  assert.equal(JSON.parse(readFileSync(join(request.stateDir, 'last-result.json'))).message, 'quit timeout')
  assert.equal(readFileSync(join(request.liveDir, 'save'), 'utf8'), 'desktop bytes')
})

test('staging cleanup failure never masks failed rollback or permits relaunch', async t => {
  const request = fixture(t)
  let calls = 0
  const result = await runSwitchJob(job(request), {
    perform: r => switchProfile(r, {
      retry: clock(),
      rename: (a, b) => { if (++calls > 1) throw busy(); renameSync(a, b) },
      removeLink: () => { throw Object.assign(Error('staging locked'), { code: 'EPERM' }) },
    }),
    relaunch: () => assert.fail('must not reopen after failed recovery'),
  })
  assert.equal(result, 1)
  const status = JSON.parse(readFileSync(join(request.stateDir, 'last-result.json')))
  assert.equal(status.recoveryRequired, true)
  assert.match(status.message, /staging locked/)
  assert.equal(existsSync(request.liveDir), false)
})

test('scheduling rejects unresolved recovery instead of overwriting evidence', async t => {
  const { scheduleSwitch } = await import('../tavern-plugin/packages/dsh-tavern/lib/helper.mjs')
  const request = fixture(t)
  const evidence = JSON.stringify({ status: 'failed', recoveryRequired: true, message: 'backup must be checked' })
  writeFileSync(join(request.stateDir, 'last-result.json'), evidence)
  assert.throws(() => scheduleSwitch(request), error => error.code === 'recovery-required')
  assert.equal(readFileSync(join(request.stateDir, 'last-result.json'), 'utf8'), evidence)
  assert.equal(existsSync(join(request.stateDir, 'pending')), false)
})

test('real standalone worker process switches and restores without losing profile data', async t => {
  const { execFileSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const request = { ...fixture(t), relaunch: undefined }
  const worker = fileURLToPath(new URL('../tavern-plugin/packages/dsh-tavern/lib/worker.mjs', import.meta.url))
  for (const mode of ['link', 'unlink']) {
    execFileSync(process.execPath, [worker, job({ ...request, mode, stamp: mode })], { cwd: request.stateDir, timeout: 10000 })
    const status = JSON.parse(readFileSync(join(request.stateDir, 'last-result.json')))
    assert.equal(status.status, 'succeeded')
    assert.equal(status.mode, mode)
    assert.equal(existsSync(join(request.stateDir, 'pending')), false)
  }
  assert.equal(readFileSync(join(request.liveDir, 'save'), 'utf8'), 'desktop bytes')
  assert.equal(readFileSync(join(request.targetDir, 'save'), 'utf8'), 'tavern bytes')
})
