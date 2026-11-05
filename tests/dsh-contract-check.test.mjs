import test from 'node:test'
import assert from 'node:assert/strict'
import { addedReferences, compareReports, readContracts, summarizeTap, hostReferences, root } from '../bin/dsh-contract-check.mjs'
import { probeTestRuntime } from '../bin/test-runtime.mjs'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const tap = '# tests 2\n# pass 2\n# fail 0\n# skipped 0\n'
test('required skips, empty execution, missing summary and crashed processes never pass', () => {
  assert.equal(summarizeTap(tap, 0).status, 'passed')
  for (const [output, status] of [[tap, 1], ['', 0], [tap.replace('tests 2', 'tests 0'), 0], [tap.replace('skipped 0', 'skipped 1'), 0]]) {
    assert.equal(summarizeTap(output, status).status, 'failed')
  }
  const skipped = 'ok 1 - optional capability # SKIP unavailable\n' + tap.replace('skipped 0', 'skipped 1')
  assert.equal(summarizeTap(skipped, 0, { 'optional capability': 'not available on old host' }).status, 'passed')
  assert.equal(summarizeTap(skipped, 0, { another: 'different case' }).status, 'failed')
})
test('new package use and new dependency locations require review; removals do not', () => {
  assert.deepEqual(addedReferences({ 'a.js': ['old', 'new'], 'b.js': ['old'] }, { 'a.js': ['old'], 'removed.js': ['old'] }),
    [{ file: 'a.js', name: 'new' }, { file: 'b.js', name: 'old' }])
})
test('runtime differences map back to affected contracts without calling hash changes failures', () => {
  const baseline = { packages: { host: { version: '1' } }, contracts: [{ id: 'tools', status: 'passed' }] }
  const candidate = { packages: { host: { version: '2' } }, contracts: [{ id: 'tools', status: 'passed', packages: ['host'] }] }
  assert.deepEqual(compareReports(baseline, candidate), [{ id: 'tools', baseline: 'passed', candidate: 'passed', changedPackages: ['host'] }])
  assert.ok(readContracts().contracts.length >= 5)
})

test('candidate inspection can probe future versions without weakening normal runtime policy', () => {
  const runtime = { command: 'node', args: [], env: {}, boot: '/fixture/boot.js' }
  const run = () => ({ status: 0, stdout: JSON.stringify({ boot: '/fixture/boot.js', version: '0.3.0', nodeVersion: '24.9.0' }) })
  assert.throws(() => probeTestRuntime(runtime, run), /0.3.0/)
  assert.equal(probeTestRuntime(runtime, run, { checkCompatibility: false }).version, '0.3.0')
})

test('dependency inventory includes maintained clients and subpaths but excludes vendor copies', t => {
  const cache = path.join(root, '.cache/dsh-contracts')
  mkdirSync(cache, { recursive: true })
  const directory = mkdtempSync(path.join(cache, 'inventory-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  for (const file of ['tavern-plugin/packages/example/client.js', 'tavern-plugin/lib/vendor/example.js']) {
    mkdirSync(path.dirname(path.join(directory, file)), { recursive: true })
    writeFileSync(path.join(directory, file), "import x from '@deepseek-ai/dsh-session/surface'")
  }
  assert.deepEqual(hostReferences(directory), {
    'tavern-plugin/packages/example/client.js': ['@deepseek-ai/dsh-session/surface']
  })
})
