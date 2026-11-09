// synthetic CJK fixtures; no owner prose, credentials or paid model calls.
import assert from 'node:assert/strict'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { estimateCjkText, measureCompactionSurface, compactCjkIfNeeded } from '../tavern-plugin/lib/domain/cjk-compaction.js'
import { createNativePlayOrchestrationStrategy } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { compactNativePlayIfNeeded } from '../tavern-plugin/lib/agent-compaction.js'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'

const cjk = size => '\u4e2d\u6587\u304b\u306a'.repeat(Math.ceil(size / 4)).slice(0, size)
const message = (role, text, source = { kind: 'human' }) => ({ id: crypto.randomUUID(), role, content: [{ type: 'text', text }], source })
function snapshot(text) {
  return message('user', text, { kind: 'plugin', plugin: 'dsh-tavern', worldbookSnapshot: { schemaVersion: 1, text, rendered: text } })
}
const checkpoint = text => message('user', text, { kind: 'plugin', plugin: 'compact' })
const hostPrice = m => Math.ceil(m.content.map(b => b.text || '').join('').length / 4) + 8

function fixture(messages, { usage, config = {}, summary = cjk(1000) } = {}) {
  const events = messages.map((data, seq) => ({ seq, type: data.role === 'system' ? 'system/message' : data.role + '/message', data }))
  const session = { get seq() { return events.length }, surface: { nodes: events.map(e => e.seq) }, eventAt: seq => events[seq], deriveEventMessage: event => event.data,
    requestHeader: () => ({ config: { provider: 'fake', model: 'text' } }) }
  const anchor = messages.reduce((sum, m) => sum + hostPrice(m), 0)
  const meter = { measure() {
    const nodes = session.surface.nodes.map(seq => ({ seq, tokens: hostPrice(events[seq].data) }))
    const surfaceTokens = nodes.reduce((sum, n) => sum + n.tokens, 0)
    return { nodes, surfaceTokens, surfaceDeltaTokens: surfaceTokens - anchor,
      baseline: { kind: usage ? 'usage' : 'estimated', tokens: usage || anchor } }
  } }
  const calls = []
  const engine = { config: { thresholdRatio: 0.5, retainRatio: 0.16, compactionRetries: 1, modelPolicies: [], ...config },
    ctx: { get: () => undefined },
    async compactRegion(start, end) {
      const first = session.surface.nodes.indexOf(start), last = session.surface.nodes.indexOf(end)
      calls.push(session.surface.nodes.slice(first, last + 1).map(seq => events[seq].data))
      const seq = events.length
      events.push({ seq, type: 'user/message', data: checkpoint(typeof summary === 'function' ? summary(calls.length) : summary) })
      session.surface.nodes.splice(first, last - first + 1, seq)
      return { shadowedRange: { start, end } }
    } }
  const run = (options = {}) => compactCjkIfNeeded({ engine, agent: { session }, meter,
    llm: { resolveModelInfo: async () => ({ context: { contextWindow: 258000 } }) },
    balancedBefore: () => true, trigger: 'pressure', signal: new AbortController().signal,
    native: () => { throw Error('unexpected fallback') }, ...options })
  return { session, meter, calls, run, engine, events }
}

test('native requests preserve the previous turn byte prefix and firing-turn snapshots', t => {
  const old = snapshot('green-gun'), story = message('assistant', 'turn-1'), latest = snapshot('green-engine')
  const stagedRequests = new Map([['s', { scope: 'foreground', turn: 2, step: 1, snapshot: null }]])
  const strategy = createNativePlayOrchestrationStrategy({ stagedRequests })
  const project = messages => {
    const input = { sessionId: 's', messages }
    return (strategy.projectRequest(input) || input).messages
  }
  const first = [message('system', 'blue'), old, story], original = JSON.stringify(first)
  const second = first.concat([latest, message('assistant', 'turn-2')])
  const encode = messages => Buffer.from(messages.map(m => JSON.stringify(m)).join('\n') + '\n')
  const before = encode(project(first)), after = encode(project(second))
  assert.deepEqual(after.subarray(0, before.length), before)
  assert.deepEqual(project(second).map(m => m.content[0].text), ['blue', 'green-gun', 'turn-1', 'green-engine', 'turn-2'])
  assert.equal(JSON.stringify(first), original)
  assert.deepEqual(project(first), first, 'rewind keeps its own selected surface')
  const cleared = second.concat(snapshot('[worldbook cleared]'))
  assert.equal(project(cleared).filter(m => m.source?.worldbookSnapshot).length, 3)
  t.diagnostic(JSON.stringify({ prefixBytes: before.length, identicalPrefixBytes: before.length }))
})

test('205,888 usage anchor remains stable and all retained green snapshots are budgeted', async t => {
  const messages = [message('system', cjk(26686)), checkpoint(cjk(1829))]
  for (let i = 0; i < 15; i++) {
    if (i < 9) messages.push(snapshot(cjk(i === 8 ? 6354 : 5965) + i))
    messages.push(message('user', 'continue'), message('assistant', cjk(7952)))
  }
  const f = fixture(messages, { usage: 205888 })
  const before = measureCompactionSurface(f.session, f.meter)
  assert.equal(before.nodes.filter(n => n.tokens === 0).length, 0)
  assert.ok(before.totalTokens > 129000)
  await f.run()
  const after = measureCompactionSurface(f.session, f.meter)
  assert.equal(after.scale, before.scale, 'do not recalibrate a stale provider anchor against the shrunken tail')
  assert.ok(after.totalTokens < 116100)
  assert.ok(f.calls[0].some(m => m.role === 'assistant'))
  assert.ok(f.calls[0].includes(messages[1]), 'merge previous checkpoint with newly removed story')
  const retained = after.nodes.filter(n => n.message.role === 'assistant').length
  assert.ok(retained < 15)
  t.diagnostic(JSON.stringify({ providerInput: 205888, projectedBefore: before.totalTokens, after: after.totalTokens, summaries: f.calls.length, retainedReplies: retained }))
})

test('system-only pressure and cancellation do not spend summary calls; overflow delegates unchanged', async () => {
  const f = fixture([message('system', cjk(140000)), checkpoint('summary'), message('user', 'continue')])
  await assert.rejects(f.run(), /cannot reach/)
  assert.equal(f.calls.length, 0)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(f.run({ signal: controller.signal }), { name: 'AbortError' })
  assert.equal(f.calls.length, 0)
  assert.equal(await f.run({ trigger: 'context-overflow', native: () => 'host-overflow' }), 'host-overflow')
})

const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }
test('real host transaction: old chars/4 retry stalls, Tavern CJK selection yields a smaller next request', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { contextWindow: 258000, assembleStablePrefix: false })
  t.after(() => h.dispose())
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const session = h.target.session, agent = h.target.agent
  session.append('system/message', { message: message('system', cjk(26686)) }, { surfaceOp: 'append' })
  session.append('request/header', { header: { config: { provider: 'initialization-fixture', model: 'text' } }, reason: 'initial' })
  session.append('user/message', checkpoint(cjk(1829)), { surfaceOp: 'append' })
  for (let i = 0; i < 15; i++) {
    session.append('turn/start', { turn: i + 1 })
    session.append('step/start', { turn: i + 1, step: 1 })
    if (i < 9) session.append('user/message', snapshot(cjk(i === 8 ? 6354 : 5965) + i), { surfaceOp: 'append' })
    session.append('user/message', message('user', 'continue'), { surfaceOp: 'append' })
    session.append('assistant/message', { turn: i + 1, step: 1, stream: [],
      message: message('assistant', cjk(7952), { kind: 'model', provider: 'initialization-fixture', model: 'text' }),
      ...(i === 14 ? { usage: { inputTokens: 7523, cacheWriteTokens: 198365, outputTokens: 0, totalTokens: 205888 } } : {}) }, { surfaceOp: 'append' })
    session.append('step/end', { turn: i + 1, step: 1 })
    session.append('turn/end', { turn: i + 1, reason: { kind: 'completed' } })
  }
  const calls = []
  class SummaryFixture extends BasicCompactionEngine {
    async summarize(input) {
      calls.push(input.messages)
      return { summary: [{ type: 'text', text: cjk(calls.length === 1 ? 1000 : 500) }], provider: 'initialization-fixture', model: 'text' }
    }
  }
  const engine = new SummaryFixture(h.ctx, { auto: false, thresholdRatio: 0.5 })
  const before = h.ctx.tokenMeter.measure(session).totalTokens
  assert.equal(before, 207884, '205,888 reported input plus the newest reply heuristic')
  session.append('turn/start', { turn: 16 })
  const signal = new AbortController().signal
  await assert.rejects(engine.compactIfNeeded(agent, 'pressure', signal), /still above threshold/)
  const oldRetained = session.deriveMessages().filter(m => m.role === 'assistant').length
  assert.ok(oldRetained >= 14)
  assert.equal(calls.at(-1).filter(m => m.role === 'assistant').length, 0, 'host retried only the summary')
  const oldCalls = calls.length
  const result = await compactNativePlayIfNeeded(engine, agent, 'pressure', signal, () => engine.compactIfNeeded(agent, 'pressure', signal))
  assert.ok(result)
  assert.ok(calls.slice(oldCalls).every(call => call.some(m => m.role === 'assistant')))
  session.append('turn/end', { turn: 16, reason: { kind: 'completed' } })
  const retainedSnapshots = session.deriveMessages().filter(m => m.source?.worldbookSnapshot).length
  const next = session.deriveMessages().concat([snapshot(cjk(6354)), message('user', cjk(1000))])
  const nextTokens = next.reduce((sum, m) => sum + estimateCjkText(m.content.map(b => b.text || '').join('')) + 8, 0)
  const after = measureCompactionSurface(session, h.ctx.tokenMeter)
  assert.ok(after.totalTokens < 116100)
  assert.ok(nextTokens < 129000)
  assert.equal(next.filter(m => m.source?.worldbookSnapshot).length, retainedSnapshots + 1)
  const events = session.snapshotEvents()
  assert.equal(events.filter(e => e.type === 'compaction/start').length, events.filter(e => e.type === 'compaction/end').length)
  assert.equal(events.filter(e => e.type === 'assistant/message').length, 15, 'original story remains in append-only history')
  t.diagnostic(JSON.stringify({ providerInput: 205888, meterBefore: before, oldRetained, calibratedAfter: after.totalTokens, nextRequestCjkTokens: nextTokens,
    retainedReplies: next.filter(m => m.role === 'assistant').length, newSummaryCalls: calls.length - oldCalls }))
})
