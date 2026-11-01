import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { resolveBindHost, DEFAULT_BIND_HOST } from '../bin/service-address.mjs'
import { sourceFunction } from './fixtures/source-function.mjs'

const source = readFileSync(new URL('../bin/service-lifecycle.mjs', import.meta.url), 'utf8')
const alive = sourceFunction(source, 'isProcessAlive')
const state = sourceFunction(source, 'serviceState')
const stop = sourceFunction(source, 'stopPermissionMessage') + sourceFunction(source, 'stopService')
const denied = () => { throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' }) }

function sandbox(identity, portOpen = false, host = 'android') {
  let removed = 0, signals = 0
  const record = { pid: 27035, source: '/tavern', profile: 'tavern' }
  const context = { process: { platform: 'linux', kill(_pid, signal) { if (signal) signals++; denied() } },
    resolveBindHost, DEFAULT_BIND_HOST, CLI_HOST: DEFAULT_BIND_HOST, fetch,
    RUNTIME_HOST: host, SOURCE_ROOT: '/tavern', PROFILE: 'tavern', CLI_PORT: 3088,
    PID_FILE: '/root/.dsh-tavern/logs/tavern.pid.json',
    readPidRecord: () => record, removePidRecord: () => removed++,
    inspectRecordedProcess: () => identity, isPortOpen: async () => portOpen,
    isServiceReady: async () => portOpen, findLegacyService: () => null,
    verifyProfile() {}, console: { log() {} }, sleep: async () => {} }
  vm.createContext(context)
  vm.runInContext(alive + state + stop, context)
  return { context, counts: () => ({ removed, signals }) }
}

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

test('Linux hosts identify the service from /proc instead of trusting kill(0)', () => {
  for (const host of ['cli', 'desktop']) {
    assert.equal(inspectRecordedProcess(record, { ...options(), platform: 'linux', host, kill: denied }), 'owned',
      'the recorded service is still ours when kill(0) is denied')
    const foreign = options({ cmdline: ['/usr/sbin/cron', '-f', ''].join('\0') })
    assert.equal(inspectRecordedProcess(record, { ...foreign, platform: 'linux', host, kill: denied }), 'foreign',
      'a PID from outside a sandbox namespace is not ours')
  }
})

test('Linux permission failure while signaling is reported instead of the raw kill error', async () => {
  const h = sandbox('owned', false, 'cli')
  await assert.rejects(vm.runInContext('stopService()', h.context), /权限不足。该 PID 可能已被其他进程复用/)
  assert.deepEqual(h.counts(), { removed: 0, signals: 1 })
})

test('recorded bind address is part of process identity, with canonical IPv6 comparison', () => {
  const args = host => ['node', 'dsh', '--profile', 'tavern', '--port', '3088', '--host', host, ''].join('\0')
  const bound = { ...record, bindHost: 'fd00::1' }
  assert.equal(inspectRecordedProcess(bound, options({ cmdline: args('fd00:0:0:0:0:0:0:1') })), 'owned')
  assert.equal(inspectRecordedProcess(bound, options({ cmdline: args('fd00::2') })), 'foreign')
  assert.equal(inspectRecordedProcess(bound, options({ cmdline: args('::') })), 'foreign')
  assert.equal(inspectRecordedProcess(bound, options()), 'foreign')
  assert.equal(inspectRecordedProcess(record, options()), 'owned', 'records without bindHost remain compatible')
})
