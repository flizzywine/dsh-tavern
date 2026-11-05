import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveAgentCompaction, compactNativePlayIfNeeded, inject as relayInject } from '../tavern-plugin/lib/agent-compaction.js'
import { compactWholeTurnsNow } from '../tavern-plugin/lib/domain/whole-turn-maintenance.js'
import { pathToFileURL } from 'node:url'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { createAutoCompaction, installCompactionPolicy } from '../tavern-plugin/lib/domain/auto-compaction.js'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
const native = { skip: !process.env.DSH_BOOT_MODULE, timeout: 30000 }


test('two Cordis proxies install one whole-turn adapter and complete manual compaction', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  new BasicCompactionEngine(h.ctx, { auto: false })
  const { agent, session } = h.target
  for (let turn = 1; turn <= 3; turn++) {
    agent.followup({ id: 'manual-' + turn, role: 'user', content: [{ type: 'text', text: ('dialogue-' + turn + ' ').repeat(150) }], source: { kind: 'human' } })
    await agent.whenIdle()
  }
  const first = h.ctx.get('compaction'), second = h.ctx.get('compaction')
  assert.notEqual(first, second)
  let layers = 0
  const disposers = [first, second].map(engine => installCompactionPolicy(engine, (_a, _t, _s, fallback) => fallback(), {
    compactNow: (original, owner, signal, command) => {
      layers++
      return compactWholeTurnsNow(engine, original, owner, signal, command)
    }
  }))
  t.after(() => disposers.reverse().forEach(dispose => dispose?.()))
  assert.ok(await second.compactNow(agent, new AbortController().signal))
  assert.equal(layers, 1)
  assert.equal(disposers.filter(Boolean).length, 1)
  assert.ok(sessionEvents(session).some(event => event.type === 'compaction/summary'))
  assert.match(JSON.stringify(session.deriveMessages()), /dialogue-3/)
})

// root-owned fixtures alone cannot reproduce Cordis's dependency guard.
test('real Cordis: undeclared relay reproduces the tokenMeter stack; declared relay does not', native, async t => {
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  new BasicCompactionEngine(h.ctx, { auto: false })
  for (const inject of [undefined, relayInject]) {
    let engine
    const mounted = Promise.withResolvers()
    const fork = h.ctx.plugin({ name: 'relay-guard-' + Boolean(inject), ...(inject ? { inject } : {}),
      apply(ctx) { engine = ctx.get('compaction'); mounted.resolve() } })
    t.after(() => fork.dispose())
    await mounted.promise
    const check = () => compactNativePlayIfNeeded(engine, h.target.agent, 'pressure', new AbortController().signal, () => null)
    if (inject) assert.equal(await check(), null)
    else await assert.rejects(check(), error => {
      assert.match(error.message, /cannot get property "tokenMeter" without inject/)
      assert.match(error.stack, /compactNativePlayIfNeeded/)
      return true
    })
  }
})


test('real background loop recovers provider overflow and retains the pending candidate request', native, async t => {
  const { compactBackgroundIfNeeded } = await import('../tavern-plugin/lib/domain/background-compaction.js')
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
  t.after(() => h.dispose())
  const boot = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', boot))
  const engine = new BasicCompactionEngine(h.ctx, { auto: true })
  let protectedRewind = false, rejectNext = false, rejected = 0
  t.after(installCompactionPolicy(engine, (agent, trigger, signal, fallback, forced) => compactBackgroundIfNeeded({
    trigger, forced, native: async () => null, pressure: async () => null
  }), { beforeRegion: async () => { protectedRewind = true } }))
  h.ctx.on('llm/stream', (request, next) => {
    if (request.purpose === 'compaction') assert.equal(protectedRewind, true)
    if (rejectNext && request.purpose !== 'compaction') {
      rejectNext = false; rejected++
      return (async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { message: 'maximum context length 1048576; requested 1089015 (705015 messages, 384000 completion)', code: 'CONTEXT_WINDOW_EXCEEDED' } } } })()
    }
    return next()
  })
  const agent = h.target.agent
  agent.followup({ id: 'old-background', role: 'user', content: [{ type: 'text', text: '已有剧情与结算。'.repeat(800) }], source: { kind: 'human' } })
  await agent.whenIdle()
  rejectNext = true
  agent.followup({ id: 'candidate', role: 'user', content: [{ type: 'text', text: '请生成本轮候选项。' }], source: { kind: 'human' } })
  await agent.whenIdle()
  const events = sessionEvents(agent.session)
  assert.equal(rejected, 1)
  assert.ok(events.some(e => e.type === 'compaction/summary'))
  assert.equal(events.filter(e => e.type === 'turn/end').at(-1).data.reason.kind, 'completed')
  const request = h.requests.filter(r => r.purpose !== 'compaction').at(-1)
  assert.match(JSON.stringify(request.messages), /请生成本轮候选项/)
})

for (const policy of [{ mode: 'manual' }, { mode: 'rounds', rounds: 100 }]) {
  test(`real foreground: ${policy.mode} schedule cannot suppress provider overflow recovery`, native, async t => {
    const { compactForegroundIfNeeded } = await import('../tavern-plugin/lib/domain/foreground-compaction.js')
    const h = await createInitializationNative(process.env.DSH_BOOT_MODULE)
    t.after(() => h.dispose())
    const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
    const engine = new BasicCompactionEngine(h.ctx, { auto: true })
    const chat = { id: 'test', mode: 'story', sessionId: h.target.session.id, messages: [] }
    const service = createAutoCompaction({
      readChat: async () => chat, updateChat: async (_id, fn) => fn(chat), policy: async () => policy,
      activity: () => { throw Error('must not wait for background settlement') },
      compact: () => { throw Error('must not enter joint maintenance') }
    })
    let rejectNext = false, rejected = 0, recorded = 0
    t.after(installCompactionPolicy(engine, (agent, trigger, signal, fallback, forced) => compactForegroundIfNeeded({
      trigger, native: () => trigger === 'context-overflow' ? fallback() : null, forced,
      pressure: async () => null, record: async () => { recorded++ },
      scheduled: () => service.run(agent.session.id, { agent, signal, openTurnCompact: forced })
    })))
    h.ctx.on('llm/stream', (request, next) => {
      if (rejectNext && request.purpose !== 'compaction') {
        rejectNext = false; rejected++
        return (async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { message: 'context length exceeded', code: 'CONTEXT_WINDOW_EXCEEDED' } } } })()
      }
      return next()
    })
    const agent = h.target.agent
    agent.followup({ id: 'old', role: 'user', content: [{ type: 'text', text: '已有剧情。'.repeat(800) }], source: { kind: 'human' } })
    await agent.whenIdle()
    rejectNext = true
    agent.followup({ id: 'new', role: 'user', content: [{ type: 'text', text: '继续本轮剧情。' }], source: { kind: 'human' } })
    await agent.whenIdle()
    const events = sessionEvents(agent.session)
    assert.equal(rejected, 1); assert.equal(recorded, 1)
    assert.ok(events.some(event => event.type === 'compaction/summary'))
    assert.equal(events.filter(event => event.type === 'turn/end').at(-1).data.reason.kind, 'completed')
    assert.match(JSON.stringify(h.requests.filter(request => request.purpose !== 'compaction').at(-1).messages), /继续本轮剧情/)
  })
}



// the live DeepSeek model's huge output allowance is not input pressure.
test('real host: 258k window / 256k output allowance does not compact a tiny foreground surface', native, async t => {
  const { compactForegroundIfNeeded } = await import('../tavern-plugin/lib/domain/foreground-compaction.js')
  const { measureForegroundPressure } = await import('../tavern-plugin/lib/domain/foreground-context-pressure.js')
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { contextWindow: 258000 })
  t.after(() => h.dispose())
  const { agent, session } = h.target
  for (let i = 0; i < 2; i++) {
    agent.followup({ id: 'tiny-' + i, role: 'user', content: [{ type: 'text', text: 'x'.repeat(6000) }], source: { kind: 'human' } })
    await agent.whenIdle()
  }
  const header = session.requestHeader()
  session.append('request/header', { header: { ...header, config: { ...header.config, maxTokens: 256000 } }, reason: 'change' })
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const engine = new BasicCompactionEngine(h.ctx, { auto: true, thresholdRatio: 0.5 })
  const options = { agent, llm: h.ctx.llm, meter: h.ctx.tokenMeter }
  const pressure = await measureForegroundPressure(options)
  assert.ok(pressure.percent < 2 && pressure.budgetPercent > 100)
  t.after(installCompactionPolicy(engine, (owner, trigger, signal, fallback, forced) => compactForegroundIfNeeded({
    trigger, native: () => compactNativePlayIfNeeded(engine, owner, trigger, signal, fallback), forced,
    pressure: () => measureForegroundPressure({ ...options, agent: owner, signal }),
    record: () => assert.fail('no compaction expected'), scheduled: () => null
  })))
  agent.followup({ id: 'next', role: 'user', content: [{ type: 'text', text: 'continue' }], source: { kind: 'human' } })
  await agent.whenIdle()
  assert.equal(sessionEvents(session).filter(e => e.type === 'compaction/start').length, 0)
  assert.equal(h.requests.filter(r => r.purpose === 'compaction').length, 0)
  assert.equal(sessionEvents(session).filter(e => e.type === 'turn/end').at(-1).data.reason.kind, 'completed')
  t.diagnostic(JSON.stringify(pressure))
})
