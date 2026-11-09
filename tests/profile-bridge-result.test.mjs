import test from 'node:test'
import assert from 'node:assert/strict'
import fs, { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLastResult, resolvePaths, statusPayload } from '../tavern-plugin/packages/dsh-tavern/lib/state.mjs'
import { confirmNextUpdate, installPublishGate, nextUpdateRestartMarker, recordPendingQuitStatus, scheduleSwitch } from '../tavern-plugin/packages/dsh-tavern/lib/helper.mjs'
import { consumeProfileContinuation, recordProfileContinuation } from '../tavern-plugin/packages/dsh-tavern/lib/startup-profile.mjs'
import { runSwitchJob } from '../tavern-plugin/packages/dsh-tavern/lib/worker.mjs'

test('NEXT accepts restart confirmation only for the prepared update in this session', t => {
  const stateDir = mkdtempSync(join(tmpdir(), 'pb-update-'))
  t.after(() => rmSync(stateDir, { recursive: true, force: true }))
  const paths = { ...resolvePaths({ DSH_HOME: stateDir }), host: 'next', stateDir }
  const stamp = 'update-one'
  const gate = installPublishGate(stateDir)
  const marker = nextUpdateRestartMarker(stateDir, stamp)
  mkdirSync(join(stateDir, 'install-pending', 'runtime'), { recursive: true })
  writeFileSync(join(stateDir, 'last-result.json'), JSON.stringify({ status: 'pending', mode: 'install', stamp }))
  writeFileSync(join(stateDir, 'install-pending', 'request.json'), JSON.stringify({
    mode: 'install', host: 'next', stamp, liveDir: paths.activeDir, appDir: join(stateDir, 'app'),
    pids: [process.pid, process.ppid],
  }))
  assert.equal(statusPayload(paths).nextUpdatePreparation, 'preparing')
  assert.throws(() => confirmNextUpdate(paths, stamp), { code: 'update-not-ready' })
  writeFileSync(gate + '.ready', '')
  assert.equal(statusPayload(paths).nextUpdatePreparation, 'ready')
  assert.throws(() => confirmNextUpdate(paths, 'stale'), { code: 'update-not-ready' })
  assert.throws(() => confirmNextUpdate({ ...paths, activeDir: join(stateDir, 'different') }, stamp), { code: 'update-not-ready' })
  assert.equal(existsSync(marker), false)
  assert.deepEqual(confirmNextUpdate(paths, stamp), { confirmed: true })
  assert.equal(existsSync(gate), false, 'only the worker can publish after NEXT exits')
  assert.deepEqual(confirmNextUpdate(paths, stamp), { confirmed: true })
  assert.equal(statusPayload(paths).nextUpdatePreparation, 'restarting')
})

test('status reads the latest durable result, not previous log errors', t => {
  const root = mkdtempSync(join(tmpdir(), 'pb-result-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'last-result.json')
  assert.equal(readLastResult(root), undefined)
  for (const text of ['{', 'null', '{}', '{"status":"unknown"}']) {
    writeFileSync(file, text)
    assert.equal(readLastResult(root), undefined)
  }
  writeFileSync(file, JSON.stringify({ status: 'failed', stamp: 'one', message: 'EBUSY', recoveryRequired: true }))
  const paths = { ...resolvePaths({ DSH_HOME: root }), stateDir: root }
  assert.equal(statusPayload(paths).lastResult.message, 'EBUSY')
  assert.equal(statusPayload(paths).lastResult.recoveryRequired, true)
  writeFileSync(join(root, 'last-run.log'), 'ERROR: previous failure')
  writeFileSync(file, JSON.stringify({ status: 'succeeded', stamp: 'two' }))
  assert.equal(statusPayload(paths).lastResult.status, 'succeeded')
  assert.equal(statusPayload(paths).lastResult.stamp, 'two')
})


test('abandoned pending reports uncertainty without rewriting durable evidence or guessing rollback', t => {
  const root = mkdtempSync(join(tmpdir(), 'pb-abandoned-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'last-result.json')
  const pending = JSON.stringify({ status: 'pending', stamp: 'one' })
  writeFileSync(file, pending)
  assert.equal(readLastResult(root).status, 'pending', 'worker may not have registered yet')
  mkdirSync(join(root, 'pending'))
  writeFileSync(join(root, 'pending', 'worker.json'), JSON.stringify({ pid: 10000 }))
  assert.equal(readLastResult(root, { alive: () => true }).status, 'pending')
  const result = readLastResult(root, { alive: () => false })
  assert.equal(result.status, 'failed')
  assert.equal(result.recoveryRequired, true)
  assert.match(result.message, /结果不确定/)
  assert.equal(readFileSync(file, 'utf8'), pending, 'status is read-only')
  rmSync(join(root, 'pending', 'worker.json'))
  assert.equal(readLastResult(root, { now: () => Date.now() + 181000 }).recoveryRequired, true)
})

test('pending switch records manual quit fallback and reuses the same session worker on retry', t => {
  const root = mkdtempSync(join(tmpdir(), 'pb-quit-fallback-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const stateDir = join(root, 'profile-bridge')
  const liveDir = join(root, 'profiles', 'desktop')
  const targetDir = join(root, 'profiles', 'tavern')
  mkdirSync(join(stateDir, 'pending'), { recursive: true })
  writeFileSync(join(stateDir, 'last-result.json'), JSON.stringify({ status: 'pending', mode: 'link', stamp: 'one' }))
  const job = join(stateDir, 'pending', 'request.json')
  const original = { mode: 'link', host: 'desktop', stamp: 'one', stateDir, liveDir, targetDir, pids: [101, 202] }
  const retry = { ...original, stamp: 'two' }
  const startedAt = Date.now()
  const options = { alive: pid => pid === 303, now: () => startedAt }
  writeFileSync(job, JSON.stringify(original))
  writeFileSync(join(stateDir, 'pending', 'worker.json'), JSON.stringify({ pid: 303, startedAt }))
  recordPendingQuitStatus(stateDir, 'one', false)
  assert.equal(readLastResult(stateDir, options).closesApp, false)
  const reused = scheduleSwitch(retry, options)
  assert.deepEqual(reused, {
    pid: 303, logPath: join(stateDir, 'last-run.log'), reclaimed: false, reused: true, stamp: 'one',
  })

  assert.throws(() => scheduleSwitch(retry, { ...options, now: () => startedAt + 119000 }), { code: 'busy' })
  assert.throws(() => scheduleSwitch({ ...retry, host: 'next' }, options), { code: 'busy' })
  writeFileSync(job, JSON.stringify({ ...original, stamp: 'different' }))
  assert.throws(() => scheduleSwitch(retry, options), { code: 'busy' })
  writeFileSync(job, JSON.stringify(original))
  writeFileSync(join(stateDir, 'bridge-update.json'), JSON.stringify({ schemaVersion: 1, phase: 'preparing' }))
  assert.throws(() => scheduleSwitch(retry, options), { code: 'recovery-required' })
})

test('explicit switch records a one-shot continuation so reopening without env marker does not bounce back', async t => {
  const home = mkdtempSync(join(tmpdir(), 'pb-continue-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const stateDir = join(home, 'profile-bridge')
  const lock = join(stateDir, 'pending')
  mkdirSync(lock, { recursive: true })
  const job = join(lock, 'request.json')
  writeFileSync(job, JSON.stringify({
    mode: 'unlink', stamp: 'switch-1', home, stateDir, pids: [11, 22],
  }))
  const code = await runSwitchJob(job, {
    wait: async () => {},
    perform: async () => ({ changed: true }),
    relaunch: () => {},
  })
  assert.equal(code, 0)
  assert.equal(consumeProfileContinuation(home, 'desktop'), true)
  assert.equal(consumeProfileContinuation(home, 'desktop'), false, 'continuation is consumed once')
  recordProfileContinuation(home, 'desktop', { now: () => 1000 })
  assert.equal(consumeProfileContinuation(home, 'desktop', { now: () => 1000 + 3 * 60 * 1000 }), false, 'expired continuation is ignored')
})


test('a quit callback cannot overwrite a terminal result published while the callback runs', t => {
  const stateDir = mkdtempSync(join(tmpdir(), 'pb-quit-race-'))
  t.after(() => rmSync(stateDir, { recursive: true, force: true }))
  const resultFile = join(stateDir, 'last-result.json')
  const quitFile = join(stateDir, 'pending-quit.json')
  const terminal = { status: 'failed', mode: 'unlink', stamp: 'one', message: 'waiting for Desktop timed out' }
  mkdirSync(join(stateDir, 'pending'))
  writeFileSync(join(stateDir, 'pending', 'request.json'), JSON.stringify({ mode: 'unlink', stamp: 'one' }))
  writeFileSync(resultFile, JSON.stringify({ status: 'pending', mode: 'unlink', stamp: 'one' }))

  const write = fs.writeFileSync
  const rename = fs.renameSync
  let published = false
  const publish = () => { published = true; write(resultFile, JSON.stringify(terminal)) }
  const onWrite = t.mock.method(fs, 'writeFileSync', (path, ...args) => {
    if (path === resultFile) publish()
    return write(path, ...args)
  })
  const onRename = t.mock.method(fs, 'renameSync', (source, target) => {
    if (target === quitFile) publish()
    return rename(source, target)
  })
  syncBuiltinESMExports()
  try {
    recordPendingQuitStatus(stateDir, 'one', false)
  } finally {
    onWrite.mock.restore()
    onRename.mock.restore()
    syncBuiltinESMExports()
  }

  assert.equal(published, true)
  assert.deepEqual(JSON.parse(readFileSync(resultFile, 'utf8')), terminal)
  const result = readLastResult(stateDir)
  assert.equal(result.status, 'failed')
  assert.equal(result.message, terminal.message)
  assert.equal(result.closesApp, undefined)
})

test('a claimed continuation cannot be consumed again even when cleanup fails', t => {
  const home = mkdtempSync(join(tmpdir(), 'pb-continue-claim-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  recordProfileContinuation(home, 'desktop')
  const remove = fs.rmSync
  const onRemove = t.mock.method(fs, 'rmSync', (path, ...args) => {
    if (path.includes('continue-profile.json')) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' })
    return remove(path, ...args)
  })
  syncBuiltinESMExports()
  try {
    assert.equal(consumeProfileContinuation(home, 'desktop'), true)
    assert.equal(consumeProfileContinuation(home, 'desktop'), false)
  } finally {
    onRemove.mock.restore()
    syncBuiltinESMExports()
  }
})
