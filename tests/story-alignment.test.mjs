import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { replaceSessionSurface } from '../tavern-plugin/lib/domain/session-surface-mutations.js'
import { inspectStoryAlignment, nativeStoryTurns } from '../tavern-plugin/lib/domain/story-alignment.js'
import { reshadowRolledBackRounds } from '../tavern-plugin/lib/domain/rollback-surface.js'

const input = (id, rpcId) => ({ id, role: 'user', content: [{ type: 'text', text: id }], source: { kind: 'user', rpcId } })
const reply = (id, turn) => ({ turn, step: 1, message: { id, role: 'assistant', content: [{ type: 'text', text: id }], source: { kind: 'model', provider: 'test', model: 'test' } } })
function game() {
  const session = Session.create('alignment')
  appendSessionEvent(session, 'assistant/message', reply('tavern-opening:x', 1), { surfaceOp: 'append' })
  const round = (turn, reason = 'completed') => {
    appendSessionEvent(session, 'turn/start', { turn })
    const user = appendSessionEvent(session, 'user/message', input('in-' + turn, 'rpc-' + turn), { surfaceOp: 'append' })
    const out = appendSessionEvent(session, 'assistant/message', reply('out-' + turn, turn), { surfaceOp: 'append' })
    appendSessionEvent(session, 'turn/end', { turn, reason: { kind: reason } })
    return { user, out }
  }
  return { session, round }
}

test('存档与模型上下文一致时报告对齐；失败的、进行中的回合不算剧情', () => {
  const { session, round } = game()
  round(2); round(3); round(4, 'error')
  appendSessionEvent(session, 'turn/start', { turn: 5 })
  appendSessionEvent(session, 'assistant/message', reply('running', 5), { surfaceOp: 'append' })
  assert.deepEqual(nativeStoryTurns(session), [2, 3])
  const report = inspectStoryAlignment({ session, header: { nativeCommits: { 2: {}, 3: {} } }, storyTurns: [2, 3] })
  assert.equal(report.aligned, true)
  // Compaction leaves only the latest rounds natively: the save's tail is compared.
  assert.equal(inspectStoryAlignment({ session, header: { nativeCommits: { 3: {} } }, storyTurns: [1, 2, 3].slice(1) }).aligned, true)
})

test('存档漏了一轮：可补记；回退没传到模型上下文：可重新隐藏；其余不一致只报告', () => {
  const { session, round } = game()
  round(2); round(3)
  const missing = inspectStoryAlignment({ session, header: { nativeCommits: { 2: {} } }, storyTurns: [2] })
  assert.equal(missing.aligned, false)
  assert.deepEqual(missing.adopt.map(item => item.turn), [3])
  assert.equal(missing.state, 'ok')

  const lost = inspectStoryAlignment({ session, header: { nativeCommits: { 2: {} }, suppressedDshTurns: [3] }, storyTurns: [2] })
  assert.deepEqual(lost.rolledBackVisible, [3])
  assert.deepEqual(lost.adopt, [], 'a rolled-back round is never adopted back')
  assert.deepEqual(reshadowRolledBackRounds(session, new Set(lost.rolledBackVisible)), [3])
  assert.deepEqual(nativeStoryTurns(session), [2])
  assert.equal(inspectStoryAlignment({ session, header: { nativeCommits: { 2: {} }, suppressedDshTurns: [3] }, storyTurns: [2] }).aligned, true)
  assert.deepEqual(reshadowRolledBackRounds(session, new Set([3])), [], 'repeating is a no-op')

  const strange = inspectStoryAlignment({ session, header: { nativeCommits: { 2: {} } }, storyTurns: [2, 9] })
  assert.equal(strange.state, 'mismatch')
  assert.deepEqual(strange.mismatch, { native: [2], story: [2, 9] })
  assert.equal(inspectStoryAlignment({ session, header: { regenInProgress: true }, storyTurns: [2] }).state, 'regenerating')
})
