import test from 'node:test'
import assert from 'node:assert/strict'
import { installTavernTokenMeter } from '../tavern-plugin/lib/domain/tavern-token-meter.js'
const source = { kind: 'model', provider: 'fixture', model: 'text' }
const reply = seq => ({ seq, type: 'assistant/message', data: { message: { id: String(seq), source } }, surfaceOp: 'append' })
const edit = seq => ({ ...reply(seq), surfaceOp: { op: 'replace', start: 0, end: 0 }, sourceEventSeqs: [0] })
function fixture(events, compact = false) {
  let reads = 0, snapshots = 0
  const session = { header: { agentPreset: 'other' }, eventAt(seq) { reads++; return events[seq] }, snapshotEvents() { snapshots++; return events.slice() } }
  const results = []
  let pendingState, pendingRows
  const meter = compact ? {
    states: new WeakMap(),
    _foldEvent(state, event) { results.push(event.type) },
    _sync(session, useProjection = true) {
      assert.equal(useProjection, false, 'Tavern must bypass the native measurement projection')
      const state = this.states.get(session) ?? pendingState
      this.states.set(session, state)
      for (const row of pendingRows) {
        state.consumedEvents = row.seq
        this._foldEvent(state, session.eventAt(row.seq))
        state.consumedEvents++
      }
    },
  } : { _foldEvent(session, state, event) { results.push(event.type) } }
  const dispose = installTavernTokenMeter(meter)
  const fold = (state, rows) => {
    if (!compact) return rows.forEach(row => meter._foldEvent(session, state, row))
    pendingState = state
    pendingRows = rows
    // A replacement fold state represents host cache invalidation/replay.
    if (meter.states.get(session) !== state) meter.states.delete(session)
    return meter._sync(session)
  }
  return { session, fold, results, dispose, counts: () => ({ reads, snapshots }) }
}
for (const compact of [false, true]) {
  test(`长会话冷启动及增量统计无全量快照 (${compact ? '双参数' : '三参数'})`, () => {
    const events = Array.from({ length: 52317 }, (_, seq) => seq % 100 === 99 ? edit(seq) : reply(seq))
    events[1] = { seq: 1, type: 'agent-preset/selected', data: { agentPreset: 'tavern' } }
    const h = fixture(events, compact), state = { surface: [0] }
    h.fold(state, events)
    assert.equal(h.counts().snapshots, 0)
    // Compact hosts now read every row through eventAt, in addition to the
    // bounded preset-prefix and replacement-reference lookups.
    assert.ok(h.counts().reads < events.length * (compact ? 3 : 2))
    const previousReads = h.counts().reads
    events.push(edit(events.length)); h.fold(state, events.slice(-1))
    assert.ok(h.counts().reads - previousReads < 100)
    assert.equal(h.results.at(-1), 'user/message')
    h.dispose()
  })
  test(`预设切换、回放倒退和新计量状态保持历史归属 (${compact})`, () => {
    const events = [reply(0), { seq: 1, type: 'agent-preset/selected', data: { agentPreset: 'tavern' } }, edit(2), { seq: 3, type: 'agent-preset/selected', data: { agentPreset: 'other' } }, edit(4)]
    const h = fixture(events, compact), state = { surface: [0] }
    h.fold(state, [events[2], events[4], events[2]])
    h.fold({ surface: [0] }, [events[4]])
    assert.deepEqual(h.results, ['user/message', 'assistant/message', 'user/message', 'assistant/message'])
    assert.equal(h.counts().snapshots, 0)
    h.dispose()
  })
}
