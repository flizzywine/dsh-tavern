import test from 'node:test'
import assert from 'node:assert/strict'
import { renameWithRetrySync } from '../bin/portable-fs.mjs'

test('rename retry immediately propagates unrelated failures and non-Windows errors', () => {
  for (const [platform, code] of [['win32', 'ENOENT'], ['win32', 'EXDEV'], ['darwin', 'EPERM']]) {
    const error = Object.assign(Error('rename failed'), { code })
    assert.throws(() => renameWithRetrySync('from', 'to', {
      platform, rename() { throw error }, delay() { assert.fail('must not retry') },
    }), actual => actual === error)
  }
})

test('Windows access errors can recover without exceeding the retry deadline', () => {
  let time = 0, calls = 0
  renameWithRetrySync('from', 'to', {
    platform: 'win32', timeout: 150, interval: 100, now: () => time,
    delay(ms) { time += ms },
    rename() { if (++calls < 3) throw Object.assign(Error('busy'), { code: 'EACCES' }) },
  })
  assert.equal(time, 150)
  assert.equal(calls, 3)
})
