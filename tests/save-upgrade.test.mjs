import test from 'node:test'
import assert from 'node:assert/strict'
import { createSaveUpgrade, detachSaveSessions, saveSessionIds } from '../tavern-plugin/lib/domain/save-upgrade.js'

test('a background or undo session that cannot be upgraded is let go; the foreground one still blocks', async () => {
  const chat = { id: 'old', sessionId: 'front', candidateAgent: { sessionId: 'bad-bg' },
    timeline: { participants: { background: { role: 'background', lifetime: 'chat', sessionId: 'bad-bg', status: 'bound', boundary: 3 } },
      checkpoints: [{ participants: { background: { sessionId: 'bad-bg', boundary: 2 } } }, { participants: { background: { sessionId: 'ok-bg', boundary: 1 } } }] },
    rollbackUndo: { foreground: { sessionId: 'undo-front' }, background: [{ sessionId: 'bad-bg' }] } }
  const detached = detachSaveSessions(structuredClone(chat), ['bad-bg'])
  assert.equal(detached.timeline.participants.background.status, 'needs-session')
  assert.equal(detached.timeline.participants.background.sessionId, '')
  assert.equal(detached.candidateAgent, null)
  assert.deepEqual(detached.timeline.checkpoints.map(checkpoint => Object.keys(checkpoint.participants)), [[], ['background']])
  assert.equal(detached.rollbackUndo, undefined)
  assert.equal(detachSaveSessions(structuredClone(chat), ['unrelated']), undefined)
  assert.throws(() => detachSaveSessions(structuredClone(chat), ['front']), /前台/)

  let current = structuredClone(chat), version = 'journal:old'
  const unready = () => saveSessionIds(current).filter(id => id === 'bad-bg')
  const service = createSaveUpgrade({
    inspectSessions: async value => unready().length ? { ready: false, error: '无法升级', detachable: unready() } : { ready: true, version: 4 },
    detachSessions: async (id, ids) => { current = detachSaveSessions(current, ids) || current },
    store: { version: async () => version, readSessionState: async () => current,
      upgradeStorage: async (id, options) => { await options.assertCanMigrate(current); version = 'native:new'; return { status: 'native' } } },
  })
  assert.equal((await service.status('old')).phase, 'idle', 'a game blocked only by detachable sessions can migrate')
  service.start('old'); await service.dispose()
  assert.equal((await service.status('old')).phase, 'completed')
  assert.equal(current.timeline.participants.background.status, 'needs-session')
})
