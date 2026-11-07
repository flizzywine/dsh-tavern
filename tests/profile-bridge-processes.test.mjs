import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureOwnedProcesses, cleanupOwnedProcesses, selectOwnedProcesses, waitForOwnedExit } from '../tavern-plugin/packages/dsh-tavern/lib/processes.mjs'

const row = (pid, parentPid, created) => ({ pid, parentPid, created: String(created) })
test('ownership follows pre-quit ancestry, not executable names or shared profile paths', () => {
  const rows = [row(10, 2, 100), row(11, 10, 110), row(12, 11, 120), row(20, 2, 90), row(21, 20, 130)]
  assert.deepEqual(selectOwnedProcesses(rows, [10]).descendants.map(p => p.pid), [11, 12])
})
test('stale parent PID, inaccessible identity, and inspector subtree are never owned', () => {
  const rows = [row(10, 2, 100), row(11, 10, 90), row(12, 11, 120), { pid: 13, parentPid: 10, created: null }, row(14, 13, 130), row(15, 10, 150), row(16, 15, 160), row(17, 10, 170)]
  assert.deepEqual(selectOwnedProcesses(rows, [10], [15]).descendants.map(p => p.pid), [17])
  assert.throws(() => selectOwnedProcesses(rows, [13]), /身份/)
  assert.throws(() => selectOwnedProcesses(rows, [999]), /身份/)
})
test('FILETIME ownership checks preserve precision beyond JS safe integers', () => {
  const rows = [row(10, 2, '133000000000000002'), row(11, 10, '133000000000000001'), row(12, 10, '133000000000000003')]
  assert.deepEqual(selectOwnedProcesses(rows, [10]).descendants.map(p => p.pid), [12])
})
test('capture excludes its own inspector; other platforms never invoke Windows tools', async () => {
  let called = false
  const inspect = async () => { called = true; return { inspectorPid: 11, rows: [row(2, 1, 90), row(10, 2, 100), row(11, 10, 110), row(12, 11, 120), row(13, 10, 130)] } }
  assert.equal(await captureOwnedProcesses([10], { platform: 'linux', inspect }), undefined)
  assert.equal(called, false)
  assert.deepEqual((await captureOwnedProcesses([10, 2], { platform: 'win32', inspect })).descendants.map(p => p.pid), [13])
})
test('capture refuses a recycled Desktop root PID and wrong parent relationship', async () => {
  for (const rows of [[row(10, 2, 100), row(2, 1, 101)], [row(10, 3, 100), row(2, 1, 90)]]) {
    await assert.rejects(captureOwnedProcesses([10, 2], { platform: 'win32', inspect: async () => ({ inspectorPid: 99, rows }) }), /父子进程身份/)
  }
})

test('identity waits are bounded and cleanup records reused PID skips', async () => {
  const ownership = { roots: [row(10, 2, 100)], descendants: [row(11, 10, 110)] }
  let script
  await waitForOwnedExit(ownership, { timeout: 123, inspect: async (body, options) => { script = body; assert.equal(options.timeout, 30123); return true } })
  assert.match(script, /WaitExit/)
  const logs = []
  const result = await cleanupOwnedProcesses(ownership, { platform: 'win32', log: line => logs.push(line), inspect: async body => {
    assert.match(body, /Desktop is still running/)
    assert.match(body, /protected.Add/)
    assert.match(body, /BridgeProcesses\]::Stop/)
    return { results: [{ pid: 11, status: 'reused-pid-skipped' }] }
  } })
  assert.equal(result[0].status, 'reused-pid-skipped')
  assert.match(logs[0], /11.*reused-pid-skipped/)
  await assert.rejects(cleanupOwnedProcesses({ roots: [], descendants: [] }, { platform: 'win32' }), /身份/)
})

test('partial cleanup failures preserve completed-process diagnostics and fail closed', async () => {
  const logs = []
  await assert.rejects(cleanupOwnedProcesses({ roots: [row(10, 2, 100)], descendants: [row(11, 10, 110)] }, {
    platform: 'win32', log: line => logs.push(line), inspect: async () => ({ results: [{ pid: 11, status: 'terminated' }], error: 'access denied' }),
  }), /access denied/)
  assert.match(logs[0], /11.*terminated/)
})

test('Windows: detached descendant cwd lock is released; unrelated CLI and helper survive', { skip: process.platform !== 'win32', timeout: 90000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'pb-cwd-lock-'))
  const live = join(root, 'desktop'); mkdirSync(live)
  const sleeper = 'setInterval(() => {}, 1000)'
  const hostCode = `const {spawn}=require('node:child_process'); const p=spawn(process.execPath,['-e',${JSON.stringify(sleeper)}],{cwd:${JSON.stringify(live)},detached:true,stdio:'ignore'}); p.unref(); console.log(p.pid); process.stdin.resume(); process.stdin.once('data',()=>process.exit(0));`
  const desktopCode = `const {spawn}=require('node:child_process'); const p=spawn(process.execPath,['-e',${JSON.stringify(hostCode)}],{stdio:['pipe','pipe','inherit']}); p.stdout.once('data',data=>console.log(JSON.stringify({hostPid:p.pid,orphanPid:Number(String(data).trim())}))); process.stdin.once('data',()=>{p.once('exit',()=>process.exit(0));p.stdin.write('quit')});`
  const host = spawn(process.execPath, ['-e', desktopCode], { stdio: ['pipe', 'pipe', 'inherit'] })
  let orphanPid, hostPid
  const unrelated = spawn(process.execPath, ['-e', sleeper], { cwd: root, stdio: 'ignore' })
  t.after(async () => {
    for (const pid of [host.pid, hostPid, orphanPid, unrelated.pid]) { try { process.kill(pid) } catch {} }
    await new Promise(resolve => setTimeout(resolve, 300))
    rmSync(root, { recursive: true, force: true })
  })
  const info = JSON.parse(String((await once(host.stdout, 'data'))[0]).trim())
  hostPid = info.hostPid
  orphanPid = info.orphanPid
  const owned = await captureOwnedProcesses([info.hostPid, host.pid])
  assert.ok(owned.descendants.some(p => p.pid === orphanPid))
  assert.ok(!owned.descendants.some(p => p.pid === unrelated.pid))
  await assert.rejects(cleanupOwnedProcesses(owned), /still running/)
  const exited = once(host, 'exit'); host.stdin.write('quit'); await exited
  await waitForOwnedExit(owned)
  assert.throws(() => renameSync(live, join(root, 'backup')), error => ['EBUSY', 'EPERM', 'EACCES'].includes(error.code))
  const result = await cleanupOwnedProcesses(owned)
  assert.ok(result.some(p => p.pid === orphanPid && p.status === 'terminated'))
  renameSync(live, join(root, 'backup'))
  process.kill(unrelated.pid, 0)
  process.kill(process.pid, 0)
})
