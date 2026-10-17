import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { createStoryCompactionRequest } from '../tavern-plugin/lib/domain/story-compaction.js'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { installCompactionPolicy } from '../tavern-plugin/lib/domain/auto-compaction.js'
import { compactForegroundIfNeeded } from '../tavern-plugin/lib/domain/foreground-compaction.js'

const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }
const instruction = await readFile(new URL('../tavern-plugin/prompts/story-compaction.md', import.meta.url), 'utf8')

// Real DSH session/meter/compaction transactions, synthetic provider limits.
// Pricing intentionally uses the host's 4-characters/token heuristic, not a claim
// about any provider's tokenizer. The 2k window keeps fixtures and tests small.
async function fixture(t, { rounds = 8, text = '旧剧情与人物关系。'.repeat(40), system = '', thresholdOffset = 0, auto = false, summaryMaxTokens = 128 } = {}) {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  if (system) h.ctx.systemPrompt.section({ name: 'fixture-fixed-system', text: system, complete: true, order: 999 })
  t.after(() => h.dispose())
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const state = { limit: Infinity, output: '人物关系和重要事件已归纳。', summaries: [], rejectOrdinary: false, ordinary: 0 }
  h.ctx.on('llm/stream', (raw, next) => {
    if (raw.purpose !== 'compaction' && !state.rejectOrdinary) return next()
    const request = createStoryCompactionRequest(raw, instruction)
    const input = request.messages.reduce((n, message) => n + h.ctx.tokenMeter.estimateMessage(message), 0)
      + (request.system === undefined ? 0 : Math.ceil(request.system.length / 4) + 4)
      + (request.tools?.length ? Math.ceil(JSON.stringify(request.tools).length / 4) + 4 : 0)
    const total = input + (request.maxTokens || 0)
    if (raw.purpose === 'compaction') state.summaries.push({ input, output: request.maxTokens, total })
    else state.ordinary++
    return (async function* () {
      if (total > state.limit) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message: `synthetic context exceeded: ${total} > ${state.limit}` } } }
        return
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: state.output } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  })
  const agent = h.target.agent, session = agent.session
  for (let i = 0; i < rounds; i++) {
    agent.followup({ id: 'synthetic-' + i, role: 'user', content: [{ type: 'text', text }], source: { kind: 'human' } })
    await agent.whenIdle()
  }
  if (system) session.append('system/message', { message: { id: 'synthetic-system', role: 'system', content: [{ type: 'text', text: system }], source: { kind: 'plugin', plugin: 'fixture' } } }, { surfaceOp: 'append' })
  const before = h.ctx.tokenMeter.measure(session).totalTokens
  // The fixture's entire window is 2k; the host's default 64k headroom cannot fit.
  const engine = new BasicCompactionEngine(h.ctx, { auto, headroomTokens: 0, maxTokens: summaryMaxTokens, thresholdRatio: (Math.min(before, 1600) - thresholdOffset + 0.1) / 2000 })
  async function compact(kind, selected = engine) {
    const signal = new AbortController().signal
    if (kind === 'manual') return selected.compactNow(agent, signal)
    const turn = Math.max(0, ...sessionEvents(session).filter(e => e.type === 'turn/start').map(e => e.data.turn)) + 1
    session.append('turn/start', { turn })
    try { return await selected.compactIfNeeded(agent, kind, signal) }
    finally { session.append('turn/end', { turn, reason: { kind: 'completed' } }) }
  }
  function intact(nodes) {
    assert.deepEqual([...session.surface.nodes], nodes)
    const events = sessionEvents(session)
    assert.equal(events.filter(e => e.type === 'compaction/start').length, events.filter(e => e.type === 'compaction/end').length)
  }
  return { h, agent, session, state, before, engine, BasicCompactionEngine, compact, intact }
}

for (const offset of [-1, 0, 1]) {
  test(`native threshold boundary: usage is threshold ${offset >= 0 ? '+' : ''}${offset} token`, native, async t => {
    const f = await fixture(t, { thresholdOffset: offset })
    const threshold = f.before - offset
    const result = await f.compact('pressure')
    assert.equal(Boolean(result), offset >= 0)
    t.diagnostic(JSON.stringify({ usage: f.before, threshold, compacted: Boolean(result), after: f.h.ctx.tokenMeter.measure(f.session).totalTokens }))
  })
}

for (const kind of ['manual', 'pressure', 'context-overflow']) {
  for (const spare of [-1, 0, 1]) {
    test(`${kind}: summary input plus output budget at capacity ${spare >= 0 ? '+' : ''}${spare}`, native, async t => {
      const f = await fixture(t), nodes = [...f.session.surface.nodes]
      f.state.limit = 0
      await assert.rejects(f.compact(kind)) // Calibrate exact synthetic request size without replacing history.
      f.intact(nodes)
      const total = f.state.summaries.at(-1).total
      f.state.limit = total + spare
      if (spare < 0) { await assert.rejects(f.compact(kind)); f.intact(nodes) }
      else assert.ok(await f.compact(kind))
      t.diagnostic(JSON.stringify({ kind, summaryTokens: total, capacity: f.state.limit, success: spare >= 0 }))
    })
  }
}

for (const kind of ['manual', 'pressure', 'context-overflow']) {
  for (const output of ['', '没有变短的冗长摘要。'.repeat(1000)]) {
    test(`${kind}: reject ${output ? 'expanded' : 'empty'} summary and retain recoverable original history`, native, async t => {
      const f = await fixture(t), nodes = [...f.session.surface.nodes]
      f.state.output = output
      await assert.rejects(f.compact(kind))
      f.intact(nodes)
      f.state.output = '可用的简短摘要。'
      assert.ok(await f.compact(kind), 'a failed summary must not leave the native compaction lock stuck')
    })
  }
}

for (const kind of ['manual', 'pressure', 'context-overflow']) {
  test(`${kind}: legacy history exceeding the summarizer window fails safely`, native, async t => {
    const f = await fixture(t, { rounds: 12, text: '很长的历史。'.repeat(600) }), nodes = [...f.session.surface.nodes]
    f.state.limit = 2000
    await assert.rejects(f.compact(kind)); f.intact(nodes)
    assert.ok(f.state.summaries.at(-1).total > 2000)
    t.diagnostic(JSON.stringify({ kind, historyTokens: f.before, summaryTokens: f.state.summaries.at(-1).total, capacity: 2000 }))
  })
}

for (const largeHistory of [false, true]) {
  test(`real Agent overflow stops safely when ${largeHistory ? 'the summary request' : 'the new player message'} cannot fit`, native, async t => {
    const f = await fixture(t, { auto: true, ...(largeHistory ? { rounds: 12, text: '过长历史。'.repeat(700) } : {}) })
    const oldNodes = [...f.session.surface.nodes]
    t.after(installCompactionPolicy(f.engine, (_agent, trigger, _signal, fallback, forced) => compactForegroundIfNeeded({
      trigger, native: () => trigger === 'context-overflow' ? fallback() : null, forced,
      pressure: async () => null, scheduled: async () => null, record: async () => {}
    })))
    f.state.limit = 2000; f.state.rejectOrdinary = true
    f.agent.followup({ id: 'oversized-input', role: 'user', content: [{ type: 'text', text: largeHistory ? '继续。' : '超长的新输入。'.repeat(2000) }], source: { kind: 'human' } })
    await f.agent.whenIdle()
    const events = sessionEvents(f.session)
    assert.equal(events.filter(e => e.type === 'turn/end').at(-1).data.reason.kind, 'error')
    assert.ok(f.state.ordinary <= 2, 'native overflow retries are bounded')
    assert.equal(events.filter(e => e.type === 'compaction/start').length, events.filter(e => e.type === 'compaction/end').length)
    assert.ok(oldNodes.every(seq => events.some(e => e.seq === seq)), 'original history remains in the durable event log')
    if (largeHistory) assert.ok(oldNodes.every(seq => f.session.surface.nodes.includes(seq)), 'failed summary does not replace history')
    t.diagnostic(JSON.stringify({ largeHistory, ordinaryAttempts: f.state.ordinary, summaryAttempts: f.state.summaries.length, summaryTokens: f.state.summaries.map(s => s.total) }))
    f.state.limit = Infinity
    f.agent.followup({ id: 'recovery', role: 'user', content: [{ type: 'text', text: '更换足够大窗口后继续。' }], source: { kind: 'human' } })
    await f.agent.whenIdle()
    assert.equal(sessionEvents(f.session).filter(e => e.type === 'turn/end').at(-1).data.reason.kind, 'completed')
  })
}

for (const summaryMaxTokens of [128, 1024]) {
  test(`2k window at exactly 80 percent, summary output reservation ${summaryMaxTokens}`, native, async t => {
    const f = await fixture(t, { text: '合成剧情'.repeat(182), summaryMaxTokens })
    assert.equal(f.before, 1600)
    f.state.limit = 2000
    const nodes = [...f.session.surface.nodes]
    if (summaryMaxTokens === 128) assert.ok(await f.compact('pressure'))
    else { await assert.rejects(f.compact('pressure')); f.intact(nodes) }
    t.diagnostic(JSON.stringify({ usage: f.before, threshold: 1600, summaryMaxTokens, summaryRequest: f.state.summaries.at(-1), capacity: 2000 }))
  })
}
