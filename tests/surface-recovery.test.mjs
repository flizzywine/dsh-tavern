import test from 'node:test'
import assert from 'node:assert/strict'
import { planFailedTurnSurface, rollbackAvailability, clearRegenerationAttemptSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'

const user = (id, plugin) => ({ id, role: 'user', content: [{ type: 'text', text: id }], source: plugin ? { kind: 'plugin', plugin } : { kind: 'user' } })
const body = (id, turn) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text: id }], source: { kind: 'model', provider: 'test', model: 'test' } } })
// The terminal submit_story shape: a model call that carries the body, the durable
// call record, and the receipt whose text is the body the tool returned.
const storyCall = (id, turn, callId, content) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'tool-call', id: callId, name: 'submit_story', arguments: JSON.stringify({ content }) }], source: { kind: 'model', provider: 'test', model: 'test' } } })
const storyReceipt = (id, turn, callId, text) => ({ turn, step: 1, message: { id, role: 'user', content: [{ type: 'tool-result', toolCallId: callId, isError: false, content: [{ type: 'text', text }] }], source: { kind: 'tool', callId } } })
const storyBody = (session, turn, callId, content) => {
  const call = appendSessionEvent(session, 'assistant/message', storyCall('call-' + callId, turn, callId, content), { surfaceOp: 'append' })
  appendSessionEvent(session, 'tool/call', { turn, step: 1, callId, name: 'submit_story', arguments: JSON.stringify({ content }) })
  const receipt = appendSessionEvent(session, 'tool/result', storyReceipt('receipt-' + callId, turn, callId, content), { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
  return { call, receipt }
}
const storyTurn = (session, turn, callId, content) => {
  appendSessionEvent(session, 'turn/start', { turn })
  const result = storyBody(session, turn, callId, content)
  appendSessionEvent(session, 'turn/end', { turn, reason: { kind: 'completed' } })
  return result
}
function fixture() {
  const session = Session.create('surface-recovery')
  const context = appendSessionEvent(session, 'user/message', user('historical-context', 'context-provider'), { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', body('old-body', 1), { surfaceOp: 'append' })
  const start = appendSessionEvent(session, 'turn/start', { turn: 2 })
  const refreshed = replaceSessionSurface(session, 'user/message', user('refreshed-context', 'context-provider'), { start: context.seq, end: context.seq, sourceEventSeqs: [context.seq] })
  const input = appendSessionEvent(session, 'user/message', user('attempt', 'dsh-tavern-regen'), { surfaceOp: 'append' })
  const reply = appendSessionEvent(session, 'assistant/message', body('partial', 2), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'error' } })
  return { session, eventStart: start.seq, refreshed, input, reply }
}

test('归属跨回合混合或来源残缺时，清理拒绝写入', () => {
  for (const corrupt of ['mixed', 'missing', 'missing-all', 'forward']) {
    const f = fixture()
    const events = sessionEvents(f.session).map(event => structuredClone(event))
    const replacement = { seq: events.at(-1).seq + 1, type: 'assistant/message', data: body('replacement', 2),
      surfaceOp: { op: 'replace', start: f.reply.seq, end: f.reply.seq },
      sourceEventSeqs: corrupt === 'missing-all' ? [] : corrupt === 'mixed' ? [f.reply.seq, 1] : corrupt === 'missing' ? [f.reply.seq, 999] : [f.reply.seq, events.at(-1).seq + 1] }
    events.push(replacement)
    const nodes = f.session.surface.nodes.map(seq => seq === f.reply.seq ? replacement.seq : seq)
    const session = { events, surface: { nodes }, append() { assert.fail('unsafe recovery must not write') } }
    assert.throws(() => clearRegenerationAttemptSurface({ session, eventStart: f.eventStart }), /无法安全清理/)
    assert.throws(() => planFailedTurnSurface({ events, nodes, turn: 2 }), /无法安全清理/)
    const state = rollbackAvailability({ messages: [{ role: 'assistant', turn: 1 }] }, { events, nodes })
    assert.equal(state.canRollback, false)
  }
})

test('后续正文不能被重新生成成功的范围或正常回退偷偷吞掉', async () => {
  const { planRegenerationSurface, locateRollbackSurface } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const f = fixture()
  appendSessionEvent(f.session, 'turn/start', { turn: 3 })
  appendSessionEvent(f.session, 'assistant/message', body('new-turn', 3), { surfaceOp: 'append' })
  appendSessionEvent(f.session, 'turn/end', { turn: 3, reason: { kind: 'completed' } })
  const evidence = { events: sessionEvents(f.session), nodes: f.session.surface.nodes }
  assert.throws(() => planRegenerationSurface({ ...evidence, oldAssistantSeq: 1, eventStart: f.eventStart }), /无法安全清理/)
  assert.throws(() => locateRollbackSurface(evidence), /无法安全清理/)
})

test('旧正文与重新生成之间夹着别处写入的消息（如卡片脚本消息）时，保留它并完成替换', async () => {
  const { planRegenerationSurface, regenerationProjection, applyRegenerationProjection } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const session = Session.create('regen-foreign')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  const input = appendSessionEvent(session, 'user/message', user('input-1'), { surfaceOp: 'append' })
  const old = appendSessionEvent(session, 'assistant/message', body('old', 1), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  const script = appendSessionEvent(session, 'user/message', user('script-message', 'dsh-tavern-helper'), { surfaceOp: 'append' })
  const eventStart = sessionEvents(session).length
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  appendSessionEvent(session, 'user/message', user('regen', 'dsh-tavern-regen'), { surfaceOp: 'append' })
  const fresh = appendSessionEvent(session, 'assistant/message', body('new', 2), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'completed' } })
  const plan = planRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes, oldAssistantSeq: old.seq, eventStart })
  assert.deepEqual([plan.start, plan.end], [old.seq, old.seq])
  assert.equal(plan.cleanups.length, 1)
  assert.equal(plan.cleanups[0].end, fresh.seq)
  const projection = regenerationProjection(plan, { turn: 1, step: 1, message: { id: 'tavern-regen:op', role: 'assistant', content: [{ type: 'text', text: 'new' }], source: { kind: 'model', provider: 'test', model: 'test' } } }, 'op')
  applyRegenerationProjection(session, projection)
  applyRegenerationProjection(session, projection) // a retry after a crash writes nothing twice
  const visible = session.surface.nodes.map(seq => sessionEvents(session).find(event => event.seq === seq))
  assert.deepEqual(visible.map(event => event.data.message?.id ?? event.data.id), ['input-1', 'tavern-regen:op', 'script-message', 'tavern-regen-cleanup:op:0'])
  assert.equal(visible[2].seq, script.seq)
  assert.equal(input.seq, session.surface.nodes[0])
  // Another round's story reply in between is still never stepped over.
  const other = Session.create('regen-story-between')
  appendSessionEvent(other, 'user/message', user('input-1'), { surfaceOp: 'append' })
  const first = appendSessionEvent(other, 'assistant/message', body('old', 1), { surfaceOp: 'append' })
  appendSessionEvent(other, 'assistant/message', body('other-round', 5), { surfaceOp: 'append' })
  const start = sessionEvents(other).length
  appendSessionEvent(other, 'turn/start', { turn: 6 })
  appendSessionEvent(other, 'user/message', user('regen', 'dsh-tavern-regen'), { surfaceOp: 'append' })
  appendSessionEvent(other, 'assistant/message', body('new', 6), { surfaceOp: 'append' })
  appendSessionEvent(other, 'turn/end', { turn: 6, reason: { kind: 'completed' } })
  assert.throws(() => planRegenerationSurface({ events: sessionEvents(other), nodes: other.surface.nodes, oldAssistantSeq: first.seq, eventStart: start }), /归属不一致/)
})

test('中止工具正文重生成时，回执与调用一起转为中止标记', async () => {
  const { clearRegenerationAttemptSurface, regenerationAttemptTurns, locateRollbackSurface } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const session = Session.create('regen-story-abort')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  const input = appendSessionEvent(session, 'user/message', user('input-1'), { surfaceOp: 'append' })
  const old = storyTurn(session, 1, 'old', '旧正文')
  const eventStart = sessionEvents(session).length
  appendSessionEvent(session, 'turn/start', { turn: 2 })
  const regen = appendSessionEvent(session, 'user/message', user('regen', 'dsh-tavern-regen'), { surfaceOp: 'append' })
  const fresh = storyBody(session, 2, 'new', '草稿正文')
  appendSessionEvent(session, 'turn/end', { turn: 2, reason: { kind: 'aborted' } })

  assert.deepEqual(regenerationAttemptTurns({ events: sessionEvents(session), eventStart }), [2])
  assert.equal(clearRegenerationAttemptSurface({ session, eventStart }), 3)
  const visible = session.surface.nodes.map(seq => sessionEvents(session).find(event => event.seq === seq))
  assert.deepEqual(visible.slice(0, 3).map(event => event.data.message?.id ?? event.data.id), ['input-1', 'call-old', 'receipt-old'])
  assert.equal(visible[3].data.source?.plugin, 'dsh-tavern-regeneration-abort')
  assert.deepEqual(visible[3].data.message?.content ?? visible[3].data.content, [])
  for (const gone of [regen.seq, fresh.call.seq, fresh.receipt.seq]) assert.ok(!session.surface.nodes.includes(gone))
  // The old round keeps a legal call/receipt pair and stays rollbackable.
  const rollback = locateRollbackSurface({ events: sessionEvents(session), nodes: session.surface.nodes })
  assert.equal(rollback.assistantSeq, old.call.seq)
  assert.deepEqual(rollback.shadowedSeqs, [input.seq, old.call.seq, old.receipt.seq, session.surface.nodes[3]])
})

test('卡片脚本在正文后写入的消息不会让这一轮无法回退，也不会被当成本轮输入', async () => {
  const { locateRollbackSurface } = await import('../tavern-plugin/lib/domain/rollback-surface.js')
  const session = Session.create('rollback-helper')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  const input = appendSessionEvent(session, 'user/message', user('input-1'), { surfaceOp: 'append' })
  const reply = appendSessionEvent(session, 'assistant/message', body('reply-1', 1), { surfaceOp: 'append' })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  const script = appendSessionEvent(session, 'user/message', user('script-message', 'dsh-tavern-helper'), { surfaceOp: 'append' })
  const target = locateRollbackSurface({ events: sessionEvents(session), nodes: session.surface.nodes })
  assert.equal(target.userSeq, input.seq)
  assert.equal(target.assistantSeq, reply.seq)
  assert.deepEqual(target.shadowedSeqs, [input.seq, reply.seq, script.seq])
})
