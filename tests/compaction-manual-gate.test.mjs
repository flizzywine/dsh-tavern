import test from 'node:test'
import assert from 'node:assert/strict'
import { compactForegroundIfNeeded } from '../tavern-plugin/lib/domain/foreground-compaction.js'
import { compactBackgroundIfNeeded } from '../tavern-plugin/lib/domain/background-compaction.js'

// The manual compaction policy must never summarize by capacity. Provider
// overflow is the single exception: without it an oversized request has no way
// back into the story, so that recovery still runs.
function counter() {
  const calls = []
  return { calls, hit: name => calls.push(name), has: name => calls.includes(name) }
}

test('manual policy skips every capacity path on pressure', async () => {
  const seen = counter()
  const result = await compactForegroundIfNeeded({
    trigger: 'pressure', automatic: false,
    native: async () => { seen.hit('native'); return { shadowedSeqs: [1] } },
    forced: async () => { seen.hit('forced'); return { shadowedSeqs: [2] } },
    pressure: async () => { seen.hit('pressure'); return { percent: 150 } },
    scheduled: async () => { seen.hit('scheduled') },
    record: async () => { seen.hit('record') },
  })
  assert.equal(result, null)
  assert.deepEqual(seen.calls, [])
})

test('manual policy still recovers a provider overflow', async () => {
  const seen = counter()
  const summary = { shadowedSeqs: [1, 2] }
  const result = await compactForegroundIfNeeded({
    trigger: 'context-overflow', automatic: false,
    native: async () => { seen.hit('native'); return summary },
    forced: async () => { seen.hit('forced'); return null },
    pressure: async () => { seen.hit('pressure'); return { percent: 120 } },
    scheduled: async () => { seen.hit('scheduled') },
    record: async () => { seen.hit('record') },
  })
  assert.equal(result, summary)
  assert.deepEqual(seen.calls, ['native', 'record'])
})

test('overflow without a native result keeps the manual policy silent', async () => {
  const seen = counter()
  const result = await compactForegroundIfNeeded({
    trigger: 'context-overflow', automatic: false,
    native: async () => { seen.hit('native'); return null },
    forced: async () => { seen.hit('forced'); return null },
    pressure: async () => { seen.hit('pressure'); return { percent: 120 } },
    scheduled: async () => { seen.hit('scheduled') },
    record: async () => { seen.hit('record') },
  })
  assert.equal(result, null)
  assert.deepEqual(seen.calls, ['native'])
})

test('automatic policies keep the round schedule and the forced rescue', async () => {
  const seen = counter()
  const whole = { shadowedSeqs: [3] }
  assert.equal(await compactForegroundIfNeeded({
    trigger: 'pressure', automatic: true,
    native: async () => { seen.hit('native'); return null },
    forced: async () => { seen.hit('forced'); return whole },
    pressure: async () => { seen.hit('pressure'); return { percent: 100 } },
    scheduled: async () => { seen.hit('scheduled') },
    record: async () => { seen.hit('record') },
  }), whole)
  assert.deepEqual(seen.calls, ['native', 'pressure', 'forced', 'record'])

  const planned = counter()
  assert.equal(await compactForegroundIfNeeded({
    trigger: 'pressure', automatic: true,
    native: async () => { planned.hit('native'); return null },
    forced: async () => { planned.hit('forced'); return whole },
    pressure: async () => { planned.hit('pressure'); return { percent: 40 } },
    scheduled: async () => { planned.hit('scheduled') },
    record: async () => { planned.hit('record') },
  }), null)
  assert.deepEqual(planned.calls, ['native', 'pressure', 'scheduled'])
})

test('background tasks honour the manual policy but keep overflow recovery', async () => {
  const seen = counter()
  assert.equal(await compactBackgroundIfNeeded({
    trigger: 'pressure', automatic: false,
    native: async () => { seen.hit('native'); return { shadowedSeqs: [1] } },
    forced: async () => { seen.hit('forced'); return { shadowedSeqs: [2] } },
    pressure: async () => { seen.hit('pressure'); return { inputTokens: 10, capacity: 5 } },
  }), null)
  assert.deepEqual(seen.calls, [])

  const overflow = counter()
  const summary = { shadowedSeqs: [4] }
  assert.equal(await compactBackgroundIfNeeded({
    trigger: 'context-overflow', automatic: false,
    native: async () => { overflow.hit('native'); return null },
    forced: async () => { overflow.hit('forced'); return summary },
    pressure: async () => { overflow.hit('pressure'); return null },
  }), summary)
  assert.deepEqual(overflow.calls, ['forced'])
})
