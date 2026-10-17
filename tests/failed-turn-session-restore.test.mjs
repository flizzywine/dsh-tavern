import assert from 'node:assert/strict'
import test from 'node:test'
import { Session, adoptSessionEvent } from './fixtures/dsh-session-host.mjs'
import { sessionEvents, appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { rollbackAvailability, clearFailedTurnSurface, locateRegenerationSurface, locateRollbackSurface, interruptedSurfaceTurns } from '../tavern-plugin/lib/domain/rollback-surface.js'

function fixture() {
  const session = Session.create('failed-turn-restore')
  const source = { kind: 'model', provider: 'test', model: 'test' }
  session.append('user/message', { id: 'user', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'body', role: 'assistant', content: [{ type: 'text', text: '原正文' }], source } }, { surfaceOp: 'append' })
  session.append('turn/start', { turn: 2 })
  session.append('user/message', { id: 'retry', role: 'user', content: [{ type: 'text', text: '重新生成' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 2, reason: { kind: 'error' } })
  return session
}

test('失败清理经过真实 DSH 消息校验及恢复，不损坏历史或误认玩家输入', () => {
  const session = fixture()
  assert.equal(clearFailedTurnSurface({ session, turn: 2 }), 1)
  const persisted = JSON.parse(JSON.stringify(sessionEvents(session)))
  for (const event of persisted) adoptSessionEvent(event)
  const restored = Session.create(session.id, persisted, session.header)
  const input = { events: sessionEvents(restored), nodes: restored.surface.nodes }
  assert.equal(locateRegenerationSurface({ ...input, turn: 1 }).assistantSeq, 1)
  assert.equal(locateRegenerationSurface({ ...input, turn: 2 }), null)
  const rollback = locateRollbackSurface(input)
  assert.equal(rollback.userSeq, 0)
  assert.equal(rollback.assistantSeq, 1)
  assert.deepEqual(rollback.shadowedSeqs, restored.surface.nodes)
  assert.equal(sessionEvents(restored)[1].data.message.content[0].text, '原正文')
})

test('新轮退役历史提示词后失败，清理及重载保留上一轮正文和退役标记', async () => {
  const { retireForegroundFrames } = await import('../tavern-plugin/lib/domain/foreground-frame-retirement.js')
  for (const traced of [true, false]) {
    let session = Session.create('retired-frame-failure')
    session.append('turn/start', { turn: 1 })
    session.append('user/message', { id: 'old-input', role: 'user', content: [{ type: 'text', text: '上一轮输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
    session.append('user/message', { id: 'frame', role: 'user', content: [{ type: 'text', text: '旧提示词' }], source: { kind: 'plugin', plugin: 'dsh-tavern', form: 'foreground-frame', ...(traced ? { trace: { turn: 1 } } : {}) } }, { surfaceOp: 'append' })
    appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'body', role: 'assistant', content: [{ type: 'text', text: '成功正文' }], source: { kind: 'model', provider: 'test', model: 'test' } } }, { surfaceOp: 'append' })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    for (const turn of [2, 3]) {
      session.append('turn/start', { turn })
      retireForegroundFrames(session, { keepTurn: turn })
      session.append('user/message', { id: 'retry-' + turn, role: 'user', content: [{ type: 'text', text: '失败输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
      session.append('turn/end', { turn, reason: { kind: 'error' } })
      const status = rollbackAvailability({ messages: [{ role: 'user' }, { role: 'assistant', turn: 1 }] }, { events: sessionEvents(session), nodes: session.surface.nodes })
      assert.ok(status.unclearedTurns.includes(turn))
      assert.equal(clearFailedTurnSurface({ session, turn }), 1)
      assert.equal(clearFailedTurnSurface({ session, turn }), 0)
      session = Session.create(session.id, JSON.parse(JSON.stringify(sessionEvents(session))), session.header)
      assert.match(JSON.stringify(session.deriveMessages()), /成功正文/)
      assert.doesNotMatch(JSON.stringify(session.deriveMessages()), /失败输入|旧提示词/)
      assert.equal(locateRegenerationSurface({ events: sessionEvents(session), nodes: session.surface.nodes, turn: 1 }).assistantSeq, 3)
    }
  }
})

test('服务中途停掉、从未结束的回合：下一轮开始时按失败回合清理，输入不会带进新请求', () => {
  const session = Session.create('crashed-turn')
  const source = { kind: 'model', provider: 'test', model: 'test' }
  session.append('turn/start', { turn: 2 })
  session.append('user/message', { id: 'ok', role: 'user', content: [{ type: 'text', text: '领取' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'body', role: 'assistant', content: [{ type: 'text', text: '正文' }], source } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 3 })
  session.append('user/message', { id: 'crashed', role: 'user', content: [{ type: 'text', text: '崩溃时的输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 3, step: 1, message: { id: 'half', role: 'assistant', content: [{ type: 'text', text: '半截' }], source } }, { surfaceOp: 'append' })
  // No turn/end: the server stopped. The next turn begins after restart.
  session.append('turn/start', { turn: 4 })
  // The new turn's input already stands after it: only the interrupted turn is found.
  session.append('user/message', { id: 'next', role: 'user', content: [{ type: 'text', text: '新的输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  assert.deepEqual(interruptedSurfaceTurns({ events: sessionEvents(session), nodes: session.surface.nodes }), [3])
  assert.ok(clearFailedTurnSurface({ session, turn: 3 }) > 0)
  const texts = session.surface.nodes.map(seq => sessionEvents(session).find(event => event.seq === seq)).map(event => (event.data.message?.content || event.data.content || []).map(block => block.text).join(''))
  assert.ok(!texts.includes('崩溃时的输入') && !texts.includes('半截'), JSON.stringify(texts))
  assert.ok(texts.includes('正文') && texts.includes('新的输入'))
  assert.deepEqual(interruptedSurfaceTurns({ events: sessionEvents(session), nodes: session.surface.nodes }), [])
})

test('崩溃后 DSH 恢复时补写 interrupted 结束的回合：同样按失败回合清理', () => {
  const session = Session.create('interrupted-turn')
  const source = { kind: 'model', provider: 'test', model: 'test' }
  session.append('turn/start', { turn: 2 })
  session.append('user/message', { id: 'ok', role: 'user', content: [{ type: 'text', text: '领取' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'body', role: 'assistant', content: [{ type: 'text', text: '正文' }], source } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 3 })
  session.append('user/message', { id: 'crashed', role: 'user', content: [{ type: 'text', text: '崩溃时的输入' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 3, reason: { kind: 'interrupted' } })
  const status = rollbackAvailability({ messages: [{ role: 'user' }, { role: 'assistant', turn: 2 }] }, { events: sessionEvents(session), nodes: session.surface.nodes })
  assert.ok(status.unclearedTurns.includes(3), JSON.stringify(status))
  assert.equal(clearFailedTurnSurface({ session, turn: 3 }), 1)
})
