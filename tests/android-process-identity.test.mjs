import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../bin/service-lifecycle.mjs', import.meta.url), 'utf8')
const alive = source.slice(source.indexOf('function isProcessAlive('), source.indexOf('export function isPortOpen('))
const state = source.slice(source.indexOf('async function serviceState('), source.indexOf('function findLegacyService('))
const stop = source.slice(source.indexOf('export async function stopService('), source.indexOf('export async function startService(')).replace('export ', '')
const denied = () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }) }

function sandbox(identity, portOpen = false) {
  let removed = 0, signals = 0
  const record = { pid: 27035, source: '/tavern', profile: 'tavern' }
  const context = { process: { platform: 'linux', kill(_pid, signal) { if (signal) signals++; denied() } },
    RUNTIME_HOST: 'android', SOURCE_ROOT: '/tavern', PROFILE: 'tavern', CLI_PORT: 3088,
    readPidRecord: () => record, removePidRecord: () => removed++,
    inspectRecordedProcess: () => identity, isPortOpen: async () => portOpen,
    isServiceReady: async () => portOpen, findLegacyService: () => null,
    verifyProfile() {}, console: { log() {} }, sleep: async () => {} }
  vm.createContext(context)
  vm.runInContext(alive + state + stop, context)
  return { context, counts: () => ({ removed, signals }) }
}

test('Android unreadable stale PID with closed port is cleared without signaling', async () => {
  const h = sandbox('unknown')
  await vm.runInContext('stopService()', h.context)
  assert.deepEqual(h.counts(), { removed: 1, signals: 0 })
})

test('Android unknown PID with occupied port is never stopped or forgotten', async () => {
  const h = sandbox('unknown', true)
  await assert.rejects(vm.runInContext('stopService()', h.context), /未识别|无法确认/)
  assert.deepEqual(h.counts(), { removed: 0, signals: 0 })
})

test('Android confirmed service permission failure is reported and record retained', async () => {
  const h = sandbox('owned')
  await assert.rejects(vm.runInContext('stopService()', h.context), /权限|无法停止/)
  assert.equal(h.counts().removed, 0)
})

const { inspectRecordedProcess, processStartToken } = await import('../bin/service-process-identity.mjs')
const record = { pid: 123, profile: 'tavern', port: 3088, startToken: '555' }
const stat = `123 (name with ) spaces) S ${Array(18).fill('0').join(' ')} 555 0`
function options(overrides = {}) {
  const files = { cmdline: '', environ: 'DSH_HOME=/root/.dsh\0', stat }
  // Keep NUL separate from numeric arguments (no octal escape).
  files.cmdline = ['node', 'dsh', '--profile', 'tavern', '--port', '3088', ''].join('\0')
  return { host: 'android', platform: 'linux', home: '/root/.dsh', kill() {},
    read(file) { const name = file.split('/').at(-1); if (overrides[name] instanceof Error) throw overrides[name]; return overrides[name] ?? files[name] } }
}

test('Android identity requires exact profile, port, installation and process start token', () => {
  assert.equal(processStartToken(123, options().read), '555')
  assert.equal(inspectRecordedProcess(record, options()), 'owned')
  for (const override of [
    { cmdline: ['node', 'dsh', '--profile', 'tavern-other', '--port', '3088'].join('\0') },
    { cmdline: ['node', 'dsh', '--profile', 'tavern', '--port', '9999'].join('\0') },
    { environ: 'DSH_HOME=/other\0' }, { stat: stat.replace('555', '556') }
  ]) assert.equal(inspectRecordedProcess(record, options(override)), 'foreign')
  assert.equal(inspectRecordedProcess(record, options({ environ: '' })), 'unknown')
  assert.equal(inspectRecordedProcess(record, { ...options({ cmdline: Object.assign(new Error(), { code: 'EACCES' }) }), kill: denied }), 'unknown')
  assert.equal(inspectRecordedProcess(record, { ...options(), kill: denied }), 'owned')
  assert.equal(inspectRecordedProcess(record, { ...options(), kill() { throw Object.assign(new Error(), { code: 'ESRCH' }) } }), 'gone')
  assert.equal(inspectRecordedProcess({ ...record, startToken: undefined }, options()), 'owned', 'legacy records remain identifiable')
})

test('desktop EPERM behavior does not depend on Linux proc visibility', () => {
  for (const platform of ['win32', 'darwin']) {
    assert.equal(inspectRecordedProcess(record, { ...options(), platform, kill: denied, read() { assert.fail('must not inspect proc') } }), 'owned')
  }
})

test('Android rechecks identity before SIGTERM and tolerates reuse during signaling', async () => {
  for (const race of ['before', 'during']) {
    const h = sandbox('owned')
    let probes = 0
    h.context.inspectRecordedProcess = () => ++probes >= (race === 'before' ? 2 : 3) ? 'foreign' : 'owned'
    await vm.runInContext('stopService()', h.context)
    assert.equal(h.counts().signals, race === 'before' ? 0 : 1)
    assert.equal(h.counts().removed, 1)
  }
})
