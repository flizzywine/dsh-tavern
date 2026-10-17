import assert from 'node:assert/strict'
import test from 'node:test'

import { Session } from './fixtures/dsh-session-host.mjs'
import { ensureSessionSeedTrajectory, sessionSeedTrajectoryMessages } from '../tavern-plugin/lib/domain/session-seed-trajectory.js'
import { sessionEvents } from '../tavern-plugin/lib/domain/session-events.js'

test('会话种子可从自身尾部的部分写入继续，不覆盖或重复已有事件', async () => {
  const session = Session.create('seed-partial')
  const messages = sessionSeedTrajectoryMessages(session.id)
  session.append('user/message', messages[0].data, { surfaceOp: 'append' })
  const before = structuredClone(sessionEvents(session))

  await ensureSessionSeedTrajectory(session)

  assert.deepEqual(sessionEvents(session).slice(0, before.length), before)
  assert.deepEqual(session.deriveMessages().map(message => message.role), ['user', 'assistant', 'user'])
})
