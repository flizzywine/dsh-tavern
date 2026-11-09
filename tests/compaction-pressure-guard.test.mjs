// tiny DeepSeek input cannot become pressure by reserving 256k output.
import test from 'node:test'
import assert from 'node:assert/strict'
import { compactCjkIfNeeded } from '../tavern-plugin/lib/domain/cjk-compaction.js'

function fixture({ input = 2580, meter, capacity = 258000 } = {}) {
  const warnings = [], session = { id: 'synthetic-deepseek-high', requestHeader: () => ({ config: { provider: 'fake', model: 'flash', maxTokens: 256000 } }) }
  const options = { agent: { session }, logger: { warn: text => warnings.push(text) },
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: capacity }, defaultMaxTokens: 256000 }) },
    meter: meter ?? { measure: () => ({ totalTokens: input }), estimateMessage: () => 0 },
    background: { selection: { provider: 'fake', model: 'flash' }, maxTokens: 256000 } }
  return { options, warnings }
}

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
