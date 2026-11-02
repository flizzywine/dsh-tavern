import test from 'node:test'
import assert from 'node:assert/strict'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'

import { worldbookSnapshot } from '../tavern-plugin/lib/domain/worldbook-snapshot.js'

function append(session, text) {
  const snapshot = worldbookSnapshot(session, [{ ref: 'entry:weather-17', text }])
  if (!snapshot) return null
  return appendSessionEvent(session, 'user/message', { id: crypto.randomUUID(), role: 'user',
    content: [{ type: 'text', text: snapshot.rendered }], source: { kind: 'plugin', plugin: 'dsh-tavern', worldbookSnapshot: snapshot } }, { surfaceOp: 'append' })
}

import { clearRegenerationAttemptSurface } from '../tavern-plugin/lib/domain/rollback-surface.js'

test('放弃重生成时清理临时快照，恢复原版本', () => {
  const session = Session.create('snapshot-regeneration')
  append(session, '晴')
  const eventStart = session.seq
  append(session, '雨')
  assert.ok(clearRegenerationAttemptSurface({ session, eventStart }))
  assert.equal(worldbookSnapshot(session, [{ ref: 'entry:weather-17', text: '晴' }]), null)
  assert.ok(worldbookSnapshot(session, [{ ref: 'entry:weather-17', text: '雨' }]))
})
