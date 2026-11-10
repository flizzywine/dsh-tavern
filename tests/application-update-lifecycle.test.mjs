import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { updateApplication } from '../bin/application-update.mjs'
import { createApplicationUpdater } from '../tavern-plugin/lib/application-updater.js'
import installationState from '../bin/installation-state.cjs'

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
    fetchLatestCommit: async () => identity.currentCommit,
    fetchGithubManifest: async () => { throw new Error('offline') },
    fetchCdnMetadata: async () => { throw new Error('offline') }, ...extra })
  return { root, sourceRoot, dataRoot, statusFile, updater, options: { host: 'desktop', sourceRoot, dshHome: root, statusFile, delay: 0, log() {} } }
}
async function until(operation) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) { if (await operation()) return; await new Promise(resolve => setTimeout(resolve, 15)) }
  throw new Error('fixture did not reach expected state')
}
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"

for (const cancel of [false, true]) {
  test(cancel ? 'desktop update can be cancelled while both desktop processes are running'
    : 'desktop update publishes only after the window and host both exit', { skip: process.platform === 'win32' }, async t => {
    const f = await fixture(t)
    const live = path.join(f.sourceRoot, 'plugin.js')
    const finish = path.join(f.root, 'finish')
    await writeFile(live, 'old')
    const program = `import {recordInstallationReceipt} from ${JSON.stringify(receiptModule)};await recordInstallationReceipt({sourceRoot:${JSON.stringify(f.sourceRoot)},dshHome:process.env.DSH_HOME,host:'desktop',attemptId:process.env.DSH_TAVERN_INSTALL_ATTEMPT})`
    await writeFile(path.join(f.sourceRoot, 'install.sh'), `#!/bin/sh
test "$DSH_TAVERN_DEFER_SERVICE_START" = 1 || exit 11
: > "$DSH_TAVERN_PUBLISH_GATE.ready"
while [ ! -f "$DSH_TAVERN_PUBLISH_GATE" ]; do sleep 0.02; done
test "$(cat "$DSH_TAVERN_PUBLISH_GATE")" = publish || exit 12
printf new > ${quote(live)}
while [ ! -f ${quote(finish)} ]; do sleep 0.02; done
${quote(process.execPath)} --input-type=module -e ${quote(program)}
`)
    const children = [0, 1].map(() => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }))
    const exits = children.map(child => once(child, 'exit'))
    const relaunches = []
    const active = updateApplication({ ...f.options, desktopPids: children.map(child => child.pid), timeoutMs: 10000,
      assertDesktopStopped() { assert.ok(children.every(child => child.signalCode === 'SIGTERM')) },
      relaunchDesktop(exe, { continueProfile }) { relaunches.push([exe, continueProfile]) },
    }).catch(error => error)
    try {
      await until(async () => (await f.updater().status()).awaitingDesktopExit)
      assert.equal(await readFile(live, 'utf8'), 'old')
      if (cancel) {
        assert.equal((await f.updater().cancel()).phase, 'cancelling')
        assert.equal((await active).code, 'INSTALLATION_ABORTED')
        assert.equal(await readFile(live, 'utf8'), 'old')
        assert.deepEqual(relaunches, [])
        return
      }
      children[0].kill()
      await exits[0]
      await new Promise(resolve => setTimeout(resolve, 350))
      assert.equal((await f.updater().status()).awaitingDesktopExit, true)
      assert.equal(await readFile(live, 'utf8'), 'old')
      children[1].kill()
      await exits[1]
      await until(async () => await readFile(live, 'utf8') === 'new')
      const owner = installationState.readInstallation(f.root)
      assert.equal((await f.updater().status()).cancellable, false)
      assert.throws(() => installationState.requestCancellation(f.root, owner.attemptId), { code: 'INSTALLATION_PUBLISHING' })
      await writeFile(finish, '')
      assert.equal(await active, undefined)
      const completed = JSON.parse(await readFile(f.statusFile))
      assert.equal(completed.phase, 'completed')
      assert.equal(completed.requiresRestart, false)
      assert.equal(installationState.readInstallation(f.root), null)
      assert.deepEqual(relaunches, [[process.execPath, true]])
      assert.equal(JSON.parse(await readFile(path.join(f.root, 'profile-bridge/continue-profile.json'))).profile, 'tavern')
    } finally {
      for (const child of children) child.kill()
      await Promise.all(exits)
      await writeFile(finish, '')
      await active
    }
  })
}

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
  await writeFile(path.join(f.sourceRoot, 'install.ps1'), `if ($env:DSH_TAVERN_DEFER_SERVICE_START -ne '1') { exit 11 }; & '${(process.env.DSH_TEST_NODE_EXECUTABLE || process.execPath).replaceAll("'", "''")}' '${receiptScript.replaceAll("'", "''")}'; exit $LASTEXITCODE`)
  await mkdir(path.join(f.sourceRoot, 'bin'))
  const pidFile = path.join(f.root, 'service.pid')
  await writeFile(path.join(f.sourceRoot, 'bin/dsh-tavern.mjs'), `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});writeFileSync(${JSON.stringify(pidFile)},String(p.pid));p.unref()`)
  await updateApplication({ ...f.options, host: 'cli', startService: startUpdatedService })
  pid = Number(await readFile(pidFile, 'utf8'))
  assert.ok(pid > 0)
  process.kill(pid, 0)
  assert.equal(JSON.parse(await readFile(f.statusFile)).phase, 'completed')
})

test('sidebar stage follows the installer steps instead of staying at 安装程序', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  await writeFile(path.join(f.sourceRoot, 'install.sh'), `#!/bin/sh
printf '== [步骤 1] 下载源码（已用 0s）==\\n'
printf '== [步骤 2] 安装依赖并配置 Profile（已用 1s）==\\n'
while :; do sleep 0.02; done
`)
  const active = updateApplication({ ...f.options, timeoutMs: 10000 }).catch(error => error)
  await until(async () => (await f.updater().status()).stage === '第 2 步 · 安装依赖并配置 Profile')
  const running = await f.updater().status()
  assert.equal(running.phase, 'running')
  assert.equal(running.stalled, false)
  assert.equal((await f.updater().cancel()).phase, 'cancelling')
  const error = await active
  assert.equal(error.code, 'INSTALLATION_ABORTED')
})

test('取消安卓更新时把更新前的源码换回来，状态不再要求修复', { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t)
  // 已换上的新版源码（3.1.0），只有装上更新前的备份才算完整。取消发生在
  // install.sh 已经换完源码、依赖还没装完的时候（#388）。
  const setupScript = await readFile(new URL('../android/setup.sh', import.meta.url))
  await mkdir(path.join(f.sourceRoot, 'android'), { recursive: true })
  await writeFile(path.join(f.sourceRoot, 'android/setup.sh'), setupScript, { mode: 0o755 })
  await writeFile(path.join(f.sourceRoot, 'android/update.sh'), '#!/bin/sh\nprintf "== [步骤 1] 准备酒馆源码（已用 0s）==\\n"\nwhile :; do sleep 0.02; done\n')
  await writeFile(path.join(f.sourceRoot, 'package.json'), JSON.stringify({ version: '3.1.0' }))
  await writeFile(path.join(f.sourceRoot, 'pnpm-lock.yaml'), 'lock')
  await writeFile(path.join(f.sourceRoot, 'pnpm-workspace.yaml'), 'packages: []')
  const backup = path.join(f.root, 'apps/.dsh-tavern-download.fixture/previous-source')
  await mkdir(backup, { recursive: true })
  await writeFile(path.join(backup, 'package.json'), JSON.stringify({ version: '3.0.1' }))
  await writeFile(path.join(backup, 'pnpm-lock.yaml'), 'lock')
  await writeFile(path.join(backup, 'pnpm-workspace.yaml'), 'packages: []')
  await mkdir(path.join(f.sourceRoot, 'node_modules'), { recursive: true })
  await writeFile(path.join(f.sourceRoot, 'node_modules', 'carried'), 'dependency')

  const active = updateApplication({ ...f.options, host: 'android' }).catch(error => error)
  await until(async () => (await f.updater().status()).cancellable)
  assert.equal((await f.updater().cancel()).phase, 'cancelling')
  const error = await active
  assert.equal(error.code, 'INSTALLATION_ABORTED')
  assert.equal(JSON.parse(await readFile(path.join(f.sourceRoot, 'package.json'), 'utf8')).version, '3.0.1')
  // 旧版本没有 node_modules 就起不来：跟着源码一起换回去。
  assert.equal(await readFile(path.join(f.sourceRoot, 'node_modules', 'carried'), 'utf8'), 'dependency')
  const status = JSON.parse(await readFile(f.statusFile, 'utf8'))
  assert.equal(status.phase, 'failed')
  assert.equal(status.repairRequired, undefined)
  assert.match(status.error, /已恢复更新前的源码/)
})
