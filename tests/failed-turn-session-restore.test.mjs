import assert from 'node:assert/strict'
import test from 'node:test'
import { Session, adoptSessionEvent } from './fixtures/dsh-session-host.mjs'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { clearFailedTurnSurface, locateRegenerationSurface, locateRollbackSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'

function fixture() {
  const session = Session.create('failed-turn-restore')
  const source = { kind: 'model', provider: 'test', model: 'test' }
  session.append('user/message', { id: 'user', role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } }, { surfaceOp: 'append' })
  session.append('assistant/message', { turn: 1, step: 1, message: { id: 'body', role: 'assistant', content: [{ type: 'text', text: '原正文' }], source } }, { surfaceOp: 'append' })
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

test('失败轮只有用户输入、从未获得模型来源，也能清理并恢复', () => {
  const session = fixture()
  clearFailedTurnSurface({ session, turn: 2 })
  const marker = sessionEvents(session).at(-1)
  assert.equal(marker.type, 'user/message')
  assert.equal(marker.data.source.kind, 'plugin')
  assert.deepEqual(marker.data.content, [])
  assert.deepEqual(marker.sourceEventSeqs, [3])
  assert.doesNotThrow(() => Session.create(session.id, sessionEvents(session), session.header))
})
