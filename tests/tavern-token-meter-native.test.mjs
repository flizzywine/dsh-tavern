import { appendSessionEvent, closeOpeningTurn } from '../tavern-plugin/lib/domain/session-events.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installTavernTokenMeter } from '../tavern-plugin/lib/domain/tavern-token-meter.js'
import { sessionSeedTrajectoryMessages } from '../tavern-plugin/lib/domain/session-seed-trajectory.js'

const native = { skip: !process.env.DSH_BOOT_MODULE }
async function harness(t) {
  const url = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { boot } = await import(url)
  const { Session } = await import(new URL('../../dsh-session/lib/index.js', url))
  const root = await mkdtemp(join(tmpdir(), 'tavern-meter-'))
  const config = join(root, 'host.yml')
  await writeFile(config, ['dsh-session', 'dsh-session-projection', 'dsh-token-meter'].map(n => '- name: ' + new URL('../../' + n + '/lib/index.js', url).href).join('\n'))
  const ctx = await boot('tavern-meter-test', config)
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  return { ctx, Session }
}
const source = { kind: 'model', provider: 'fixture', model: 'text' }
function completed(session, usage) {
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const e = appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, ...(usage ? {usage} : {}), message: { id: 'body', role: 'assistant', content: [{ type: 'text', text: 'Story '.repeat(1000) }], source } }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return e
}

test('原生 Token Meter 可统计既有无 step 的 Tavern 种子消息，且不改写历史', native, async t => {
  const { ctx, Session } = await harness(t)
  const session = Session.create('seed', [], { ...Session.create('seed').header, agentPreset: 'tavern' })
  // Pre-0.2 archives hold the reserved head and Tavern seeds without any
  // opening turn. The meter patch must still measure them without rewriting.
  appendSessionEvent(session, 'system/message', { turn: 1, step: 1, message: {
    id: 'tavern-system-head:' + session.id, role: 'system', content: [], source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' })
  for (const stage of sessionSeedTrajectoryMessages(session.id)) appendSessionEvent(session, stage.type, stage.data, stage.intent)
  const before = JSON.stringify(session.snapshotEvents())
  assert.throws(() => ctx.tokenMeter.measure(session), /assistant\/message.*no matching step\/start/)
  const dispose = installTavernTokenMeter(ctx.tokenMeter)
  t.after(dispose)
  const measured = ctx.tokenMeter.measure(session)
  assert.ok(measured.totalTokens > 0)
  assert.equal(measured.nodes.length, session.header.version >= 3 ? 4 : 3)
  assert.equal(JSON.stringify(session.snapshotEvents()), before)
})

test('原生 Token Meter 在闭合回合后统计后台回退和正文替换', native, async t => {
  const { ctx, Session } = await harness(t)
  const session = Session.create('background', [], { ...Session.create('background').header, agentPreset: 'tavern-background' })
  completed(session)
  const before = ctx.tokenMeter.measure(session).totalTokens
  const seq = session.surface.nodes[0]
  appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'replacement', role: 'assistant', content: [], source } }, { surfaceOp: { op: 'replace', start: seq, end: seq }, sourceEventSeqs: [seq] })
  assert.throws(() => ctx.tokenMeter.measure(session), /assistant\/message.*no matching step\/start/)
  t.after(installTavernTokenMeter(ctx.tokenMeter))
  assert.ok(ctx.tokenMeter.measure(session).totalTokens < before)
})

test('前后台固定系统背景连续压缩三次仍不变，原事件和恢复后的背景完整', native, async t => {
  const { ctx, Session } = await harness(t)
  const { ensureSessionStablePrefix, sessionStablePrefixSections } = await import('../tavern-plugin/lib/domain/session-stable-prefix.js')
  const { BasicCompactionEngine } = await import(new URL('../../dsh-compaction-basic/lib/index.js', pathToFileURL(process.env.DSH_BOOT_MODULE)))
  const fixed = '人物卡：固定人物形象。常驻世界书：固定世界规则。'
  let calls = 0
  class FixtureCompaction extends BasicCompactionEngine {
    async summarize(input) {
      calls++
      const systemText = input.system ?? input.messages.filter(m => m.role === 'system').map(m => m.content.map(b => b.text || '').join('')).join('\n')
      assert.equal(systemText, fixed)
      assert.ok(input.messages.filter(m => m.role !== 'system').every(message => !JSON.stringify(message.content).includes('固定人物形象')))
      return { summary: [{ type: 'text', text: '剧情摘要。' }], provider: 'fixture', model: 'summary', maxTokens: 128 }
    }
  }
  const engine = new FixtureCompaction(ctx, { auto: false })
  for (const preset of ['tavern', 'tavern-background']) {
    const session = ctx.sessions.create('fixed-' + preset, { meta: { agentPreset: preset } })
    await ensureSessionStablePrefix(session, fixed)
    const system = sessionStablePrefixSections(session).map(s => s.text).join('\n')
    session.append('request/header', { header: { config: { provider: 'fixture', model: 'summary' }, ...(session.header.version < 3 ? { system } : {}) }, reason: 'initial' })
    if (session.header.version >= 3) {
      const head = session.surface.nodes[0]
      session.append('system/message', { message: { id: 'assembled', role: 'system', content: [{ type: 'text', text: system }], source: { kind: 'system-prompt' } } }, { surfaceOp: { op: 'replace', startSeq: head, endSeq: head }, sourceEventSeqs: [head] })
    }
    closeOpeningTurn(session)
    for (let n = 0; n < 3; n++) {
      session.append('turn/start', { turn: n + 2 })
      session.append('step/start', { turn: n + 2, step: 1 })
      session.append('user/message', { id: 'history-' + n, role: 'user', content: [{ type: 'text', text: '剧情进展。'.repeat(500) }], source: { kind: 'user' } }, { surfaceOp: 'append' })
      session.append('user/message', { id: 'tail-' + n, role: 'user', content: [{ type: 'text', text: '最新剧情' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
      session.append('step/end', { turn: n + 2, step: 1 })
      session.append('turn/end', { turn: n + 2, reason: { kind: 'completed' } })
      const original = session.snapshotEvents()
      const signal = new AbortController().signal
      assert.ok(await engine.compactNow({ session, options: {}, runMaintenance: fn => fn(signal) }, signal))
      if (session.header.version < 3) assert.equal(session.requestHeader().system, fixed)
      else assert.equal(session.deriveEventMessage(session.eventAt(session.surface.nodes[0])).content[0].text, fixed)
      assert.deepEqual(session.snapshotEvents().slice(0, original.length), original)
      const restored = Session.create(session.id, session.snapshotEvents(), session.header)
      assert.equal(sessionStablePrefixSections(restored).map(s => s.text).join('\n'), fixed)
      await ensureSessionStablePrefix(restored, '修改后的卡片不影响旧局')
      assert.equal(sessionStablePrefixSections(restored).map(s => s.text).join('\n'), fixed)
    }
  }
  assert.equal(calls, 6)
})

test('撤销回退恢复带 usage 的模型正文后仍可统计，历史和用量不重写', native, async t => {
  const {restoreSurface} = await import('../tavern-plugin/lib/domain/surface-restoration.js')
  const {ctx, Session} = await harness(t)
  const session = Session.create('undo-meter', [], {...Session.create('undo-meter').header, agentPreset: 'tavern'})
  const original = completed(session, {inputTokens: 100, outputTokens: 50, totalTokens: 150})
  const target = [...session.surface.nodes]
  appendSessionEvent(session, 'assistant/message', {turn: 1, step: 1, message: {id: 'rollback', role: 'assistant', content: [], source}}, {surfaceOp: {op: 'replace', start: original.seq, end: original.seq}, sourceEventSeqs: [original.seq]})
  restoreSurface(session, target)
  const before = JSON.stringify(session.snapshotEvents())
  t.after(installTavernTokenMeter(ctx.tokenMeter))
  assert.ok(ctx.tokenMeter.measure(session).totalTokens > 0)
  assert.equal(JSON.stringify(session.snapshotEvents()), before)
})

test('后续切换预设不改变旧替换的归属，伪造恢复内容仍被拒绝', native, async t => {
  const {ctx, Session} = await harness(t)
  const session = Session.create('switch-after-edit')
  session.append('agent-preset/selected', {agentPreset: 'tavern'})
  const original = completed(session)
  const edit = appendSessionEvent(session, 'assistant/message', {turn: 1, step: 1, message: {id: 'edit', role: 'assistant', content: [], source}}, {surfaceOp: {op: 'replace', start: original.seq, end: original.seq}, sourceEventSeqs: [original.seq]})
  session.append('agent-preset/selected', {agentPreset: 'standard'})
  t.after(installTavernTokenMeter(ctx.tokenMeter))
  assert.doesNotThrow(() => ctx.tokenMeter.measure(session))
  session.append('agent-preset/selected', {agentPreset: 'tavern'})
  appendSessionEvent(session, 'assistant/message', {...original.data, message: {...original.data.message, content: [{type: 'text', text: '不是原文'}]}}, {surfaceOp: {op: 'replace', start: edit.seq, end: edit.seq}, sourceEventSeqs: [edit.seq, original.seq]})
  assert.throws(() => ctx.tokenMeter.measure(session), /no matching step\/start/)
})
