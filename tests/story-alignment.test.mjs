import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from "../tavern-plugin/lib/domain/session-events.js"

import { inspectStoryAlignment, nativeStoryTurns } from '../tavern-plugin/lib/domain/story-alignment.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { reshadowRolledBackRounds } from '../tavern-plugin/lib/domain/rollback-surface.js'

const input = (id, rpcId) => ({ id, role: 'user', content: [{ type: 'text', text: id }], source: { kind: 'user', rpcId } })
const reply = (id, turn, source = { kind: 'model', provider: 'test', model: 'test' }) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text: id }], source } })
function game() {
  const session = Session.create('alignment')
  appendSessionEvent(session, 'assistant/message', reply('tavern-opening:x', 1), { surfaceOp: 'append' })
  const round = (turn, reason = 'completed', source) => {
    appendSessionEvent(session, 'turn/start', { turn })
    const user = appendSessionEvent(session, 'user/message', input('in-' + turn, 'rpc-' + turn), { surfaceOp: 'append' })
    const out = appendSessionEvent(session, 'assistant/message', reply('out-' + turn, turn, source), { surfaceOp: 'append' })
    appendSessionEvent(session, 'turn/end', { turn, reason: { kind: reason } })
    return { user, out }
  }
  return { session, round }
}

test('存档漏了一轮：可补记；回退没传到模型上下文：可重新隐藏；其余不一致只报告', () => {
  const { session, round } = game()
  const source = { kind: 'model', provider: 'dsh-tavern', model: 'reply-projection' }
  round(2)
  round(3, 'completed', { ...source, toolReplay: { provider: 'google', model: 'gemini-4-argon', thoughtSignature: 'original-signature' } })
  const missing = inspectStoryAlignment({ session, header: { nativeCommits: { 2: {} } }, storyTurns: [2] })
  assert.equal(missing.aligned, false)
  assert.deepEqual(missing.adopt.map(item => item.turn), [3])
  assert.equal(missing.state, 'ok')

  const lost = inspectStoryAlignment({ session, header: { nativeCommits: { 2: {} }, suppressedDshTurns: [3] }, storyTurns: [2] })
  assert.deepEqual(lost.rolledBackVisible, [3])
  assert.deepEqual(lost.adopt, [], 'a rolled-back round is never adopted back')
  assert.deepEqual(reshadowRolledBackRounds(session, new Set(lost.rolledBackVisible)), [3])
  const placeholder = sessionEvents(session).find(event => event.seq === session.surface.nodes.at(-1)).data.message
  assert.deepEqual(placeholder.content, [])
  assert.deepEqual(placeholder.source, source)
  assert.deepEqual(nativeStoryTurns(session), [2])
  assert.equal(inspectStoryAlignment({ session, header: { nativeCommits: { 2: {} }, suppressedDshTurns: [3] }, storyTurns: [2] }).aligned, true)
  assert.deepEqual(reshadowRolledBackRounds(session, new Set([3])), [], 'repeating is a no-op')

  const strange = inspectStoryAlignment({ session, header: { nativeCommits: { 2: {} } }, storyTurns: [2, 9] })
  assert.equal(strange.state, 'mismatch')
  assert.deepEqual(strange.mismatch, { native: [2], story: [2, 9] })
  assert.equal(inspectStoryAlignment({ session, header: { regenInProgress: true }, storyTurns: [2] }).state, 'regenerating')
})

test('回退后对账不会拿已回退轮次的输入给前一轮重写正文补记一轮', () => {
  const { session, round } = game()
  const second = round(2)
  const source = { kind: 'model', provider: 'test', model: 'test', tavernStoryTurn: 2 }
  appendSessionEvent(session, 'turn/start', { turn: 3 })
  replaceSessionSurface(session, 'assistant/message', reply('rewritten-out-2', 3, source), {
    start: second.out.seq, end: second.out.seq, sourceEventSeqs: [second.out.seq]
  })
  appendSessionEvent(session, 'turn/end', { turn: 3, reason: { kind: 'completed' } })
  round(4)
  assert.deepEqual(reshadowRolledBackRounds(session, new Set([4])), [4])
  const report = inspectStoryAlignment({
    session, header: { nativeCommits: { 2: {} }, suppressedDshTurns: [4] }, storyTurns: [2]
  })
  assert.deepEqual(report.adopt.map(item => item.turn), [])
  assert.equal(report.aligned, true)
})

test('补写失败尾部后，已记录的宿主轮号映射参与存档对账', () => {
  const { session, round } = game()
  round(19)
  round(21)
  round(22)
  const header = { nativeCommits: { 19: {}, 20: {}, 22: {} }, regeneratedDshTurns: { 20: 21 } }
  const report = inspectStoryAlignment({ session, header, storyTurns: [19, 20, 22] })
  assert.equal(report.aligned, true)
  assert.deepEqual(report.adopt, [])
  assert.deepEqual(report.rolledBackVisible, [])
})

test('对账优先采用投影正文携带的剧情轮号', () => {
  const { session, round } = game()
  round(21, 'completed', { kind: 'model', provider: 'test', model: 'test', tavernStoryTurn: 19 })
  const report = inspectStoryAlignment({ session, header: { regeneratedDshTurns: { 20: 21 } }, storyTurns: [19, 20] })
  assert.deepEqual(report.mismatch, { native: [19], story: [19, 20] })
})

test('只有模型回复的回合结束后才对账：回退、撤销回退、编辑这类 Tavern 自己的回合不触发', async () => {
  const { turnRepliedByModel } = await import('../tavern-plugin/lib/domain/story-alignment.js')
  const model = { kind: 'model', provider: 'fixture', model: 'fixture' }
  const reply = (seq, turn, source, surfaceOp = 'append', text = '正文') => ({ seq, type: 'assistant/message', surfaceOp, data: { turn, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }], source } } })
  const start = (seq, turn) => ({ seq, type: 'turn/start', data: { turn } })
  const events = [
    start(0, 2), reply(1, 2, model),
    start(2, 3), reply(3, 3, { kind: 'model', provider: 'dsh-tavern', model: 'body-edit', tavernStoryTurn: 2 }, { op: 'replace', startSeq: 1, endSeq: 1 }),
    start(4, 4), { seq: 5, type: 'user/message', surfaceOp: 'append', data: { role: 'user', content: [], source: { kind: 'plugin:dsh-tavern-surface-restore' } } },
    start(6, 5), reply(7, 5, { ...model, tavernStoryTurn: 2 }),
    start(8, 6), reply(9, 6, model, 'append', '')
  ]
  assert.deepEqual([2, 3, 4, 5, 6].map(turn => turnRepliedByModel(events, turn)), [true, false, false, false, false])
})
