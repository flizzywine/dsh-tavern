import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'
import { restoreSurface, preflightSurfaceRestore } from '../tavern-plugin/lib/domain/surface-restoration.js'
import { foregroundSuppressedTurns } from '../tavern-plugin/lib/domain/rollback-surface.js'

 test('原生 Session 恢复各消息角色，追加日志不制造重复正文，重载仍保持撤销结果', () => {
  let session = Session.create('restore-native')
  appendSessionEvent(session, 'user/message', { id: 'u', turn: 2, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '推门' }] }, { surfaceOp: 'append' })
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'a', role: 'assistant', content: [{ type: 'text', text: '门开了' }], source: { kind: 'model', provider: 'test', model: 'test' } } }, { surfaceOp: 'append' })
  const saved = [...session.surface.nodes]
  const original = sessionEvents(session).map(event => structuredClone(event))
  const seq = sessionEvents(session).length
  appendSessionEvent(session, 'assistant/message', { turn: 2, step: 1, message: { id: 'rollback', role: 'assistant', content: [], source: { kind: 'model', provider: 'test', model: 'test' } } },
    { surfaceOp: { op: 'replace', start: saved[0], end: saved.at(-1) }, sourceEventSeqs: saved })
  assert.deepEqual(foregroundSuppressedTurns({}, sessionEvents(session)), [2])
  preflightSurfaceRestore(session, saved)
  restoreSurface(session, saved)
  for (const reload of [false, true]) {
    if (reload) session = Session.create(session.id, sessionEvents(session), session.header)
    const events = sessionEvents(session)
    assert.deepEqual(events.slice(0, original.length), original)
    assert.deepEqual(foregroundSuppressedTurns({}, events), [])
    assert.deepEqual(session.surface.nodes.map(n => events[n].type), ['user/message', 'assistant/message'])
    assert.equal(events[session.surface.nodes.at(-1)].data.message.content[0].text, '门开了')
    assert.equal(events.slice(seq).filter(e => e.surfaceOp === 'append' && e.data.message?.content?.length).length, 0)
  }
})
