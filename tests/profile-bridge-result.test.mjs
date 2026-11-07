import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLastResult, resolvePaths, statusPayload } from '../tavern-plugin/packages/dsh-tavern/lib/state.mjs'

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
