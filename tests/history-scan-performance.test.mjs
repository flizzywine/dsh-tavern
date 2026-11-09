import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './fixtures/history-scan-session.mjs'
import { restoreSurface } from '../tavern-plugin/lib/domain/surface-restoration.js'
test('批量恢复共享事件索引，不逐条全量快照', () => {
  const { session, snapshots } = fixture(1000)
  session.surface.nodes = []
  restoreSurface(session, Array.from({ length: 1000 }, (_, i) => i))
  assert.ok(snapshots() <= 2, `snapshots: ${snapshots()}`)
  assert.deepEqual(session.surface.nodes.map(seq => session.events[seq].data.id), Array.from({ length: 1000 }, (_, i) => 'm'+i))
})
