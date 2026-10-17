import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { updateApplication } from '../bin/application-update.mjs'
import { createApplicationUpdater } from '../tavern-plugin/lib/application-updater.js'
import installationState from '../bin/installation-state.cjs'
import { createUpdateState } from '../bin/update-state.mjs'

const identity = { currentVersion: '2.4.0', currentCommit: 'a'.repeat(40) }
const receiptModule = new URL('../bin/installation-receipt.mjs', import.meta.url).href
async function fixture(t, { beforeCleanup } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-update-lifecycle-'))
  t.after(async () => {
    await beforeCleanup?.()
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })
  const sourceRoot = path.join(root, 'apps/dsh-tavern')
  const profile = path.join(root, 'profiles/tavern')
  const dataRoot = path.join(root, 'profile-data/tavern/data')
  await Promise.all([sourceRoot, profile, dataRoot].map(directory => mkdir(directory, { recursive: true })))
  for (const [file, value] of [
    ['package.json', JSON.stringify({ version: identity.currentVersion })], ['pnpm-lock.yaml', 'fixture'],
    ['.dsh-tavern-local.json', JSON.stringify({ host: 'desktop', dshHome: root })],
  ]) await writeFile(path.join(sourceRoot, file), value)
  for (const [file, value] of [['package.json', JSON.stringify({ dshTavern: { host: 'desktop', source: sourceRoot } })], ['cordis.patch.yml', '[]'], ['pnpm-workspace.yaml', 'packages: []']]) await writeFile(path.join(profile, file), value)
  const statusFile = path.join(dataRoot, 'update-status.json')
  const updater = extra => createApplicationUpdater({ dataRoot, sourceRoot, dshHome: root, runtimeHost: 'desktop', platform: 'linux',
    readLocalIdentity: async () => identity, fetchManifest: async () => ({ version: identity.currentVersion }),
    fetchLatestCommit: async () => identity.currentCommit, fetchCdnMetadata: async () => { throw new Error('offline') }, ...extra })
  return { root, sourceRoot, dataRoot, statusFile, updater, options: { host: 'desktop', sourceRoot, dshHome: root, statusFile, delay: 0, log() {} } }
}
async function until(operation) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) { if (await operation()) return; await new Promise(resolve => setTimeout(resolve, 15)) }
  throw new Error('fixture did not reach expected state')
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

// The fixture installer uses the real receipt writer after its simulated profile
// validation. The production updater must both stop its process tree and verify
// the resulting receipt; exit zero alone is deliberately insufficient.

test('real hung updater cancels, remains exclusive through cleanup and permits another attempt afterward', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  const marker = path.join(f.root, 'writer.log')
  await writeFile(path.join(f.sourceRoot, 'install.sh'), `#!/bin/sh\ntrap '' TERM\nwhile :; do printf writing >> ${quote(marker)}; sleep 0.02; done\n`)
  const active = updateApplication({ ...f.options, timeoutMs: 5000 })
  const result = active.catch(error => error)
  await until(async () => (await f.updater().status()).cancellable)
  assert.equal((await f.updater().status()).phase, 'running')
  await assert.rejects(updateApplication(f.options), /已有安装|已经开始/)
  assert.equal((await f.updater().cancel()).phase, 'cancelling')
  await assert.rejects(f.updater().start(), /更新正在进行/)
  const error = await result
  assert.equal(error.code, 'INSTALLATION_ABORTED'); assert.equal(error.unsafeToRetry, false)
  const before = await readFile(marker, 'utf8').catch(() => '')
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(await readFile(marker, 'utf8').catch(() => ''), before)
  assert.equal(installationState.readInstallation(f.root), null)
  assert.equal((await f.updater().check()).phase, 'repair-required')
  assert.equal(JSON.parse(await readFile(f.statusFile)).repairRequired, true)
})

test('independent updater instances share one reservation and attempt id crosses launch', async t => {
  const f = await fixture(t)
  let spawned = 0
  let launchedArguments
  const options = { fetchLatestCommit: async () => 'b'.repeat(40), compareCommits: async () => 'ahead',
    spawnProcess(_command, args) { spawned++; launchedArguments = args; return { unref() {} } } }
  const result = await Promise.allSettled([f.updater(options).start(), f.updater(options).start()])
  assert.equal(spawned, 1)
  assert.equal(result.filter(result => result.status === 'fulfilled').length, 1)
  const owner = installationState.readInstallation(f.root)
  assert.equal(launchedArguments[launchedArguments.indexOf('--attempt-id') + 1], owner.attemptId)
})

test('a delayed check cannot restore repair after a newer manual installation', async t => {
  const f = await fixture(t)
  await writeFile(f.statusFile, JSON.stringify({ phase: 'failed', repairRequired: true, attemptId: 'old', failedAt: 10 }))
  let release
  const wait = new Promise(resolve => { release = resolve })
  let requested = false
  const checking = f.updater({ fetchManifest: async () => { requested = true; await wait; return { version: '2.4.0' } } }).check()
  await until(() => requested)
  const manual = installationState.acquireInstallation({ dshHome: f.root, attemptId: 'manual' })
  const state = createUpdateState(f.statusFile, f.root)
  await state.write({ phase: 'completed', attemptId: 'manual' }, { attemptId: 'manual' })
  manual.release()
  release()
  assert.equal((await checking).phase, 'completed')
})

test('hung config validation stops its writer before profile transaction rollback', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  const { beginProfileConfigurationUpdate } = await import('../bin/profile-configuration.mjs')
  const { runInstallDsh } = await import('../bin/launcher-environment.mjs')
  const profileDir = path.join(f.root, 'profiles/tavern')
  const manifestPath = path.join(profileDir, 'package.json')
  const original = await readFile(manifestPath, 'utf8')
  const transaction = await beginProfileConfigurationUpdate({ profileDir, manifest: { replacing: true }, patchText: 'new configuration' })
  const configCommand = path.join(f.root, 'dsh-fixture')
  await writeFile(configCommand, `#!/bin/sh\ntrap '' TERM\nwhile :; do printf corrupt > ${quote(manifestPath)}; sleep 0.02; done\n`, { mode: 0o755 })
  await assert.rejects(runInstallDsh(configCommand, ['--profile', 'tavern', '--dump-config'], { host: 'desktop', timeoutMs: 150 }), error => {
    assert.equal(error.code, 'INSTALLATION_TIMEOUT'); assert.equal(error.unsafeToRetry, false); return true
  })
  await transaction.rollback()
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(await readFile(manifestPath, 'utf8'), original)
})

test('definite launcher spawn failure releases reservation without claiming a running installer', async t => {
  const f = await fixture(t)
  await assert.rejects(f.updater({ fetchLatestCommit: async () => 'b'.repeat(40), compareCommits: async () => 'ahead',
    spawnProcess() { throw Object.assign(new Error('executable missing'), { code: 'ENOENT' }) },
  }).start(), /executable missing/)
  assert.equal(installationState.readInstallation(f.root), null)
  assert.equal(JSON.parse(await readFile(f.statusFile)).phase, 'failed')
})

test('CLI service starts only after the bootstrap process tree is quiescent', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  const program = `import {recordInstallationReceipt} from ${JSON.stringify(receiptModule)};await recordInstallationReceipt({sourceRoot:${JSON.stringify(f.sourceRoot)},dshHome:process.env.DSH_HOME,host:'cli',attemptId:process.env.DSH_TAVERN_INSTALL_ATTEMPT})`
  await writeFile(path.join(f.sourceRoot, 'install.sh'), `#!/bin/sh\ntest "$DSH_TAVERN_DEFER_SERVICE_START" = 1 || exit 11\n${quote(process.execPath)} --input-type=module -e ${quote(program)}\n`)
  let started = false
  await updateApplication({ ...f.options, host: 'cli', async startService() {
    const owner = installationState.readInstallation(f.root)
    const { readdir } = await import('node:fs/promises')
    const processFiles = await readdir(path.join(owner.lockDir, 'processes'))
    assert.ok(processFiles.includes('stopping'))
    assert.equal(processFiles.some(name => /^\d+\.json$/.test(name)), false)
    assert.equal(owner.supervised, false)
    started = true
  } })
  assert.equal(started, true)
  assert.equal(JSON.parse(await readFile(f.statusFile)).phase, 'completed')
})

test('Windows persistent service launched after cleanup survives successful updater completion', { skip: process.platform !== 'win32' }, async t => {
  let pid
  // One cleanup callback establishes order across Node versions. Even after
  // process exit, Windows may briefly retain the working-directory handle.
  const f = await fixture(t, { async beforeCleanup() {
    if (!pid) return
    try { process.kill(pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error }
    await until(() => { try { process.kill(pid, 0); return false } catch (error) { if (error.code === 'ESRCH') return true; throw error } })
  } })
  const { startUpdatedService } = await import('../bin/application-update.mjs')
  const receiptScript = path.join(f.sourceRoot, 'receipt.mjs')
  await writeFile(receiptScript, `import {recordInstallationReceipt} from ${JSON.stringify(receiptModule)};await recordInstallationReceipt({sourceRoot:${JSON.stringify(f.sourceRoot)},dshHome:process.env.DSH_HOME,host:'cli',attemptId:process.env.DSH_TAVERN_INSTALL_ATTEMPT})`)
  await writeFile(path.join(f.sourceRoot, 'install.ps1'), `if ($env:DSH_TAVERN_DEFER_SERVICE_START -ne '1') { exit 11 }; & '${process.execPath.replaceAll("'", "''")}' '${receiptScript.replaceAll("'", "''")}'; exit $LASTEXITCODE`)
  await mkdir(path.join(f.sourceRoot, 'bin'))
  const pidFile = path.join(f.root, 'service.pid')
  await writeFile(path.join(f.sourceRoot, 'bin/dsh-tavern.mjs'), `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(p.pid));p.unref()`)
  await updateApplication({ ...f.options, host: 'cli', startService: startUpdatedService })
  pid = Number(await readFile(pidFile, 'utf8'))
  assert.ok(pid > 0)
  process.kill(pid, 0)
  assert.equal(JSON.parse(await readFile(f.statusFile)).phase, 'completed')
})

test('initial status persistence failure releases the never-launched reservation', async t => {
  const f = await fixture(t)
  const { mkdirSync } = await import('node:fs')
  await assert.rejects(f.updater({ fetchLatestCommit: async () => 'b'.repeat(40), compareCommits: async () => 'ahead',
    now() {
      // Inject a real filesystem failure exactly after reservation, before the
      // first running snapshot. No updater process has been launched yet.
      if (installationState.readInstallation(f.root)?.state === 'reserved') mkdirSync(f.statusFile)
      return Date.now()
    },
    spawnProcess() { assert.fail('persistence failure must prevent launch') },
  }).start(), error => error.code === 'EISDIR')
  assert.equal(installationState.readInstallation(f.root), null)
})
