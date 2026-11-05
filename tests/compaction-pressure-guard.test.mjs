// tiny DeepSeek input cannot become pressure by reserving 256k output.
import test from 'node:test'
import assert from 'node:assert/strict'
import { compactForegroundIfNeeded } from '../tavern-plugin/lib/domain/foreground-compaction.js'
import { compactBackgroundIfNeeded, measureBackgroundBudget } from '../tavern-plugin/lib/domain/background-compaction.js'
import { measureForegroundPressure } from '../tavern-plugin/lib/domain/foreground-context-pressure.js'
import { compactCjkIfNeeded } from '../tavern-plugin/lib/domain/cjk-compaction.js'

function fixture({ input = 2580, meter, capacity = 258000 } = {}) {
  const warnings = [], session = { id: 'synthetic-deepseek-high', requestHeader: () => ({ config: { provider: 'fake', model: 'flash', maxTokens: 256000 } }) }
  const options = { agent: { session }, logger: { warn: text => warnings.push(text) },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: capacity }, defaultMaxTokens: 256000 }) },
    meter: meter ?? { measure: () => ({ totalTokens: input }), estimateMessage: () => 0 },
    background: { selection: { provider: 'fake', model: 'flash' }, maxTokens: 256000 } }
  return { options, warnings }
}

test('foreground and all background roles ignore output ceiling at 1% input', async () => {
  const { options } = fixture()
  const pressure = await measureForegroundPressure(options)
  assert.equal(pressure.percent, 1)
  assert.ok(pressure.budgetPercent > 100, 'reproduces the old erroneous forced admission')
  let scheduled = 0
  assert.equal(await compactForegroundIfNeeded({ trigger: 'pressure', native: async () => null,
    pressure: async () => pressure, forced: () => assert.fail('below threshold'), record: () => assert.fail('no transaction'),
    scheduled: () => scheduled++ }), null)
  assert.equal(scheduled, 1, 'explicit round/manual scheduling remains separate from pressure')
  for (const task of ['candidate', 'settlement', 'stage-director', 'image', 'phone']) {
    options.background.task = task
    assert.equal(await compactBackgroundIfNeeded({ trigger: 'pressure', native: async () => null,
      pressure: () => measureBackgroundBudget(options), forced: () => assert.fail(task + ': below threshold') }), null)
  }
})

test('missing/throwing meter, missing model capacity and nonfinite input fail closed and log once', async () => {
  for (const change of [o => { delete o.meter }, o => { o.meter.measure = () => { throw Error('meter unavailable') } },
    o => { o.llm.resolveModelInfo = async () => ({}) }, o => { o.meter.measure = () => ({ totalTokens: NaN }) }]) {
    const { options, warnings } = fixture(); change(options)
    for (let i = 0; i < 2; i++) {
      assert.equal(await measureForegroundPressure(options), null)
      assert.equal(await measureBackgroundBudget(options), null)
      assert.equal(await compactForegroundIfNeeded({ trigger: 'pressure', native: async () => null,
        pressure: () => measureForegroundPressure(options), forced: () => assert.fail('must not force'),
        scheduled: () => null, record: () => assert.fail('must not record') }), null)
      assert.equal(await compactBackgroundIfNeeded({ trigger: 'pressure', native: async () => null,
        pressure: () => measureBackgroundBudget(options), forced: () => assert.fail('must not force') }), null)
    }
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /session=synthetic-deepseek-high/)
  }
})

test('CJK guard never falls back to compact with unknown services/config or below its threshold', async () => {
  for (const change of [() => {}, o => { delete o.meter }, o => { delete o.llm }, o => { o.engine.config.thresholdRatio = NaN },
    o => { o.llm.resolveModelInfo = async () => ({}) }]) {
    const { options, warnings } = fixture()
    options.agent.session.requestHeader = () => ({ config: { provider: 'fake', model: 'flash' } })
    options.meter.measure = () => ({ nodes: [], surfaceTokens: 0, surfaceDeltaTokens: 0 })
    const call = { ...options, engine: { ctx: { logger: options.logger }, config: { thresholdRatio: 0.5, retainRatio: 0.16 } },
      trigger: 'pressure', native: () => assert.fail('unknown must not fall through'), balancedBefore: () => true }
    change(call)
    assert.equal(await compactCjkIfNeeded(call), null)
    assert.equal(await compactCjkIfNeeded(call), null)
    assert.ok(warnings.length <= 1)
  }
})

test('input alone exceeding capacity still gets protection; invalid numeric budgets never force', async () => {
  for (const percent of [1, NaN, Infinity, undefined]) {
    assert.equal(await compactForegroundIfNeeded({ trigger: 'pressure', native: async () => null,
      pressure: async () => ({ percent, budgetPercent: Infinity }), forced: () => assert.fail('invalid/below threshold'),
      record: () => {}, scheduled: () => {} }), null)
  }
  assert.equal(await compactBackgroundIfNeeded({ trigger: 'pressure', native: async () => null,
    pressure: async () => ({ inputTokens: 258000, capacity: 258000 }), forced: () => 'protected' }), 'protected')
})
