import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent, withSurfaceEditTurn } from '../tavern-plugin/lib/domain/session-events.js'

// A rollback after an input edit opened its edit turn while a manual compaction was
// summarizing. The live Session took it; the stored log then never opened again
// ("turn/start crosses an open compaction").
test('no edit turn opens while a between-turns compaction is still open', async () => {
  const { replaceSessionSurface } = await import('../tavern-plugin/lib/domain/session-surface-mutations.js')
  const session = Session.create('surface-edit-compaction')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  appendSessionEvent(session, 'step/start', { turn: 1, step: 1 })
  appendSessionEvent(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'reply', role: 'assistant', content: [{ type: 'text', text: '原' }], source: { kind: 'model', provider: 'f', model: 'f' } } }, { surfaceOp: 'append', sourceEventSeqs: [] })
  appendSessionEvent(session, 'step/end', { turn: 1, step: 1 })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  appendSessionEvent(session, 'command/run', { commandId: 'cmd-1', name: 'compact', args: '', source: { kind: 'user' } })
  appendSessionEvent(session, 'compaction/start', { compactionId: 'c1', sourceCommandId: 'cmd-1', turn: null })
  const seq = session.surface.nodes.at(-1)
  const edit = () => replaceSessionSurface(session, 'assistant/message', { turn: 1, step: 1, message: { id: 'edit', role: 'assistant', content: [], source: { kind: 'model', provider: 'dsh-tavern', model: 'body-edit' } } },
    { start: seq, end: seq, sourceEventSeqs: [seq] })
  const before = session.snapshotEvents().length
  assert.throws(edit, /上下文正在压缩/)
  assert.throws(() => withSurfaceEditTurn(session, null, () => {}), /上下文正在压缩/)
  assert.equal(session.snapshotEvents().length, before, 'nothing is written while the compaction is open')
  appendSessionEvent(session, 'compaction/end', { compactionId: 'c1', sourceCommandId: 'cmd-1', turn: null, error: 'fixture' })
  edit()
  assert.deepEqual(session.snapshotEvents().filter(event => event.type === 'turn/start').map(event => event.data.turn), [1, 2])
})
