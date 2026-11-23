import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'

import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { runInstallationProcess, verifyInstallationProcessesStopped, resolveWindowsInstallationInvocation } from '../bin/installation-process.mjs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import installationState from '../bin/installation-state.cjs'

const moduleUrl = new URL('../bin/installation-process.mjs', import.meta.url).href
const fastCleanup = { killGraceMs: 50, cleanupTimeoutMs: process.platform === 'win32' ? 10_000 : 2000 }
const fixtureTimeout = process.platform === 'win32' ? 30_000 : 5000

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tavern-supervisor-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

async function waitForFile(file) {
  const deadline = Date.now() + fixtureTimeout
  while (Date.now() < deadline) {
    try { return await readFile(file, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
    await delay(10)
  }
  throw new Error(`Fixture did not become ready: ${file}`)
}

async function absent(file) {
  await assert.rejects(readFile(file), { code: 'ENOENT' })
}

// A surviving descendant writes `late` this long after `ready`. Keep it well above
// slow-runner cleanup latency (macOS CI probes process groups via ps), or a
// correct but slow kill looks like a leaked process.
const LATE_WRITE_MS = 2000
const afterLateWrite = () => delay(LATE_WRITE_MS + 300)

function writerScript(ready, late) {
  return `const fs = require('node:fs'); process.on('SIGTERM', () => {}); fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setTimeout(() => fs.writeFileSync(${JSON.stringify(late)}, 'late write'), ${LATE_WRITE_MS}); setInterval(() => {}, 1000)`
}

test('timeout kills a TERM-ignoring grandchild before reporting safe stopped', { skip: process.platform === 'win32' }, async t => {
  const directory = await fixture(t)
  const ready = path.join(directory, 'ready')
  const late = path.join(directory, 'late')
  const descendant = writerScript(ready, late)
  const script = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'ignore'}); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`
  const start = Date.now()
  const executable = process.env.DSH_TEST_NODE_EXECUTABLE || process.execPath
  const timeoutMs = 1500
  const promise = runInstallationProcess(executable, ['-e', script], { timeoutMs, label: '--dump-config', ...fastCleanup })
  const stopped = assert.rejects(promise, error => {
    assert.equal(error.code, 'INSTALLATION_TIMEOUT', error.message)
    assert.equal(error.timeoutMs, timeoutMs)
    assert.equal(error.unsafeToRetry, false)
    assert.match(error.message, /--dump-config.*1500/)
    assert.deepEqual(error.remainingProcessGroups, [])
    return true
  })
  await Promise.all([waitForFile(ready), stopped])
  assert.ok(Date.now() - start < 3000)
  await afterLateWrite()
  await absent(late)
})

test('abort is responsive and stops descendants before rejection', async t => {
  const directory = await fixture(t)
  const ready = path.join(directory, 'ready')
  const late = path.join(directory, 'late')
  const controller = new AbortController()
  const promise = runInstallationProcess(process.execPath, ['-e', writerScript(ready, late)], { signal: controller.signal, timeoutMs: fixtureTimeout, ...fastCleanup })
  await waitForFile(ready)
  controller.abort('fixture cancellation')
  await assert.rejects(promise, error => {
    assert.equal(error.code, 'INSTALLATION_ABORTED', error.message)
    assert.equal(error.unsafeToRetry, false)
    return true
  })
  await afterLateWrite()
  await absent(late)
})

test('an already aborted signal does not launch a process', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(runInstallationProcess(process.execPath, ['-e', 'process.exit(0)'], {
    signal: controller.signal,
    onSpawn() { assert.fail('must not spawn') },
  }), { code: 'INSTALLATION_ABORTED', unsafeToRetry: false })
})

test('a successful direct command cannot leave background descendants writing', async t => {
  const directory = await fixture(t)
  const ready = path.join(directory, 'ready')
  const late = path.join(directory, 'late')
  const descendant = writerScript(ready, late)
  const script = `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'ignore', detached:process.platform==='win32'}); child.unref(); setInterval(() => { if (require('node:fs').existsSync(${JSON.stringify(ready)})) process.exit(0); }, 10)`
  const promise = runInstallationProcess(process.execPath, ['-e', script], fastCleanup)
  await waitForFile(ready)
  assert.equal((await promise).status, 0)
  await afterLateWrite()
  await absent(late)
})

test('outer cancellation also kills separately grouped nested stages', async t => {
  const directory = await fixture(t)
  const ready = path.join(directory, 'ready')
  const late = path.join(directory, 'late')
  const nested = path.join(directory, 'nested.mjs')
  await writeFile(nested, `import { runInstallationProcess } from ${JSON.stringify(moduleUrl)}; await runInstallationProcess(process.execPath, ['-e', ${JSON.stringify(writerScript(ready, late))}], { timeoutMs: ${fixtureTimeout} });`)
  const controller = new AbortController()
  const promise = runInstallationProcess(process.execPath, [nested], { signal: controller.signal, timeoutMs: fixtureTimeout, ...fastCleanup })
  await waitForFile(ready)
  controller.abort()
  await assert.rejects(promise, error => {
    assert.equal(error.code, 'INSTALLATION_ABORTED', error.message)
    assert.equal(error.unsafeToRetry, false)
    assert.ok(error.processGroups.length >= 2)
    return true
  })
  await afterLateWrite()
  await absent(late)
})

test('recovery only clears closed, verified trees whose supervisor has exited', async t => {
  const directory = await fixture(t)
  const registry = path.join(directory, 'processes')
  const runner = path.join(directory, 'runner.mjs')
  await writeFile(runner, `import { runInstallationProcess } from ${JSON.stringify(moduleUrl)}; await runInstallationProcess(process.execPath, ['-e', 'process.exit(0)'], { processDirectory: ${JSON.stringify(registry)} });`)
  const child = spawn(process.execPath, [runner], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Fixture exited ${code}: ${stderr}`)))
  })
  assert.equal((await verifyInstallationProcessesStopped(registry)).safe, true)
  await writeFile(path.join(registry, 'supervisor.json'), JSON.stringify({ pid: process.pid }))
  assert.deepEqual(await verifyInstallationProcessesStopped(registry), { safe: false, reason: 'supervisor-still-running', pid: process.pid })
  await rm(path.join(registry, 'stopping'))
  assert.equal((await verifyInstallationProcessesStopped(registry)).reason, 'launch-gate-open')
  assert.equal((await verifyInstallationProcessesStopped(path.join(directory, 'missing'))).safe, false)
})

test('lost POSIX supervisor closes its launch gate and stops owned writers', { skip: process.platform === 'win32' }, async t => {
  const directory = await fixture(t)
  const registry = path.join(directory, 'processes')
  const ready = path.join(directory, 'ready')
  const late = path.join(directory, 'late')
  const runner = path.join(directory, 'runner.mjs')
  await writeFile(runner, `import { existsSync } from 'node:fs'; import { runInstallationProcess } from ${JSON.stringify(moduleUrl)}; setInterval(() => { if (existsSync(${JSON.stringify(ready)})) process.kill(process.pid, 'SIGKILL'); }, 10); await runInstallationProcess(process.execPath, ['-e', ${JSON.stringify(writerScript(ready, late))}], { processDirectory: ${JSON.stringify(registry)}, timeoutMs: ${fixtureTimeout} });`)
  const child = spawn(process.execPath, [runner], { stdio: 'ignore' })
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
  const deadline = Date.now() + 2500
  let result
  do {
    result = await verifyInstallationProcessesStopped(registry)
    if (result.safe) break
    await delay(25)
  } while (Date.now() < deadline)
  assert.equal(result.safe, true, JSON.stringify(result))
  await afterLateWrite()
  await absent(late)
})

test('Windows containment publishes a suspended-assigned job before resuming it', async () => {
  const source = await readFile(new URL('../bin/installation-process.mjs', import.meta.url), 'utf8')
  const create = source.indexOf('Check(CreateProcess(null, line')
  const assign = source.indexOf('if (!AssignProcessToJobObject(job, child.process))', create)
  const publish = source.indexOf('Publish(ready,', assign)
  const resume = source.indexOf('Check(ResumeThread(child.thread)', publish)
  assert.ok(create > 0 && assign > create && publish > assign && resume > publish)
  assert.match(source, /0x08000004.*NO_WINDOW \| SUSPENDED/)
  assert.match(source, /limits\.basic\.flags = 0x2000.*KILL_ON_JOB_CLOSE/)
  assert.match(source, /Check\(TerminateJobObject\(job, 1\)\)/)
  assert.match(source, /QueryInformationJobObject\(job, 1, out accounting/)
  assert.match(source, /accounting\.active == 0/)
  assert.match(source, /Windows job .*no verified empty-job receipt/)
})

function launchCli(args, env = process.env, stdin = 'ignore') {
  const child = spawn(process.execPath, [fileURLToPath(moduleUrl), '--run', ...args], { env, stdio: [stdin, 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', status => resolve({ status, stdout, stderr }))
  })
  return { child, completion }
}

test('standalone CLI never lets a stage wait on the console', async () => {
  // The installer's console stays open; a stage that reads it (e.g. a pnpm prompt) must see EOF, not hang.
  const { child, completion } = launchCli(['fixture', String(fixtureTimeout), process.execPath, '-e', 'process.stdin.resume(); process.stdin.on("end", () => console.log("stdin closed"))'], process.env, 'pipe')
  const result = await completion
  child.stdin.destroy()
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /stdin closed/)
})

test('standalone CLI preserves output and enforces stage deadlines', async () => {
  const good = await launchCli(['fixture', String(fixtureTimeout), process.execPath, '-e', 'console.log("cli output")']).completion
  assert.equal(good.status, 0, good.stderr)
  assert.match(good.stdout, /cli output/)
  const timedOut = await launchCli(['fixture timeout', '100', process.execPath, '-e', 'setInterval(() => {}, 1000)']).completion
  assert.equal(timedOut.status, 1)
  assert.match(timedOut.stderr, /INSTALLATION_TIMEOUT/)
})

test('standalone CLI joins ownership and honors durable cancellation', async t => {
  const directory = await fixture(t)
  const ready = path.join(directory, 'ready')
  const lease = installationState.acquireInstallation({ dshHome: directory, attemptId: 'cli-cancel' })
  const { completion } = launchCli(['fixture cancellation', String(fixtureTimeout), process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000)`], {
    ...process.env, DSH_TAVERN_INSTALL_LOCK: lease.lockDir, DSH_TAVERN_INSTALL_ATTEMPT: lease.attemptId,
  })
  await waitForFile(ready)
  installationState.requestCancellation(directory, lease.attemptId)
  const result = await completion
  assert.equal(result.status, 1)
  assert.match(result.stderr, /INSTALLATION_ABORTED/)
  assert.notEqual(lease.owner.unsafeToRetry, true)
  assert.equal(lease.release(), true)
})

test('Windows cmd encoding preserves boundaries and escapes each parsing layer', () => {
  const nativeArgs = ['C:\\Games\\DSH Tavern', '中文 & (test)', 'a"b', '', 'tail\\']
  assert.deepEqual(resolveWindowsInstallationInvocation('C:\\Program Files\\node.exe', nativeArgs, { shell: true }), {
    command: 'C:\\Program Files\\node.exe', args: nativeArgs, verbatimArguments: false,
  })
  const encoded = resolveWindowsInstallationInvocation('C:\\Games\\DSH Tavern\\pnpm.cmd', ['--dir', 'C:\\游戏 & (测试)\\DSH Tavern', 'say"hello', '', 'tail\\', '%PATH%', '!X!', 'a|b>c'], { shell: true, comspec: 'cmd.exe' })
  assert.deepEqual(encoded.args.slice(0, 4), ['/d', '/s', '/v:off', '/c'])
  assert.equal(encoded.verbatimArguments, true)
  assert.match(encoded.args[4], /C:\\Games\\DSH\^ Tavern\\pnpm.cmd/)
  assert.match(encoded.args[4], /\^\^\^&/)
  assert.match(encoded.args[4], /\^\^\^\(/)
  assert.match(encoded.args[4], /\^\^\^"/)
  assert.match(encoded.args[4], /\^\^\^%PATH\^\^\^%/)
  assert.match(encoded.args[4], /\^\^\^!/)
  assert.match(encoded.args[4], /\^\^\^\|/)
  assert.match(encoded.args[4], /\^\^\^>/)
  assert.match(encoded.args[4], /中文|游戏/)
  assert.throws(() => resolveWindowsInstallationInvocation('pnpm.cmd', ['a\nb'], { shell: true }), /line breaks/)
  assert.throws(() => resolveWindowsInstallationInvocation('pnpm.cmd', [], { shell: 'powershell.exe' }), /only support cmd/)
})

test('Windows batch forwarding preserves argument data and cannot inject commands', { skip: process.platform !== 'win32' }, async t => {
  const directory = await fixture(t)
  const shim = path.join(directory, 'npm fixture.cmd')
  const target = path.join(directory, 'dump-arguments.cjs')
  const injected = path.join(directory, 'injected.txt')
  await writeFile(target, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
  await writeFile(shim, `@echo off\r\n"${process.execPath}" "${target}" %*\r\n`)
  const args = ['--dir', 'C:\\Games\\DSH Tavern', '中文 & (测试)', 'embedded"quote', 'slash\\"quote', '', 'tail\\', '%PATH%', '!VARIABLE!', `& echo injected > "${injected}"`, '(a|b)', '^caret']
  const result = await runInstallationProcess(shim, args, { shell: true, timeoutMs: fixtureTimeout, ...fastCleanup })
  assert.deepEqual(JSON.parse(result.stdout), args)
  await absent(injected)
})

test('an explicit new root ignores stale registry and ancestry environment markers', async t => {
  const directory = await fixture(t)
  const stale = path.join(directory, 'stale')
  const runner = path.join(directory, 'fresh-root.mjs')
  await import('node:fs/promises').then(fs => fs.mkdir(stale))
  await writeFile(path.join(stale, 'stopping'), '')
  await writeFile(runner, `import { runInstallationProcess } from ${JSON.stringify(moduleUrl)}; process.env.DSH_TAVERN_INSTALL_PROCESS_DIR = ${JSON.stringify(stale)}; process.env.DSH_TAVERN_INSTALL_PROCESS_ANCESTORS = '[999999999]'; const result = await runInstallationProcess(process.execPath, ['-e', 'console.log("fresh root")'], { root: true }); console.log(JSON.stringify({ status: result.status, processDirectory: result.processDirectory, stdout: result.stdout }));`)
  const result = await runInstallationProcess(process.execPath, [runner], { root: true, timeoutMs: fixtureTimeout, ...fastCleanup })
  const inner = JSON.parse(result.stdout)
  assert.equal(inner.status, 0)
  assert.notEqual(inner.processDirectory, stale)
  assert.match(inner.stdout, /fresh root/)
})

test('a wrapper that reuses a finished wrapper PID ignores that predecessor\'s stop marker', async t => {
  const { clearStaleWrapperFiles } = await import('../bin/installation-process.mjs')
  const { mkdtempSync, writeFileSync, utimesSync, existsSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const pathModule = (await import('node:path')).default
  const directory = mkdtempSync(pathModule.join(tmpdir(), 'wrapper-pid-reuse-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const startedAt = Date.now()
  const stale = pathModule.join(directory, 'stopping-4242')
  writeFileSync(stale, '')
  utimesSync(stale, (startedAt - 60000) / 1000, (startedAt - 60000) / 1000)
  const unrelated = pathModule.join(directory, 'stopping-777')
  writeFileSync(unrelated, '')
  utimesSync(unrelated, (startedAt - 60000) / 1000, (startedAt - 60000) / 1000)
  clearStaleWrapperFiles(directory, 4242, startedAt)
  assert.equal(existsSync(stale), false)
  assert.equal(existsSync(unrelated), true)
  // A cancellation written for this wrapper after it started is kept. Set the time
  // explicitly: Linux file timestamps are coarse and can trail Date.now() by milliseconds.
  writeFileSync(stale, '')
  utimesSync(stale, (startedAt + 1000) / 1000, (startedAt + 1000) / 1000)
  clearStaleWrapperFiles(directory, 4242, startedAt)
  assert.equal(existsSync(stale), true)
})

test('Windows job hosts resolve bare commands through PATHEXT like a shell (Desktop node.cmd shim)', async () => {
  const { resolveWindowsCommand } = await import('../bin/installation-process.mjs')
  const present = new Set(['C:\\dsh\\runtime-commands\\node.cmd', 'C:\\tools\\pnpm.exe'])
  const exists = file => present.has(file)
  const env = { Path: 'C:\\Windows;C:\\dsh\\runtime-commands;C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' }
  // CreateProcess("node") would only try node.exe and fail with ENOENT.
  assert.equal(resolveWindowsCommand('node', env, 'X:\\Desktop.exe', exists), 'C:\\dsh\\runtime-commands\\node.cmd')
  assert.equal(resolveWindowsCommand('pnpm', env, 'X:\\Desktop.exe', exists), 'C:\\tools\\pnpm.exe')
  // Nothing on PATH: "node" is the runtime this wrapper already runs on.
  assert.equal(resolveWindowsCommand('node', { PATH: '' }, 'X:\\Desktop.exe', () => false), 'X:\\Desktop.exe')
  assert.equal(resolveWindowsCommand('C:\\explicit\\tool.exe', env, 'X', exists), 'C:\\explicit\\tool.exe')
})

test('a Windows job host that failed to launch still acknowledges the stop request', async () => {
  const source = await readFile(fileURLToPath(new URL('../bin/installation-process.mjs', import.meta.url)), 'utf8')
  const failurePath = source.slice(source.indexOf('} catch {', source.indexOf('const windowsJobScript')))
  // Without this receipt cleanup cannot confirm the tree and keeps the install lock.
  assert.match(failurePath, /Set-Content -LiteralPath \$config\.stopped/)
})
