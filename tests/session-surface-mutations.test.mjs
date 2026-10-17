import test from 'node:test'
import assert from 'node:assert/strict'
import { replaceSessionSurface, createSessionSurfaceMutator } from '../tavern-plugin/lib/domain/session-surface-mutations.js'

function fixture() {
  const events = [{seq: 0, type: 'assistant/message', data: {message: {id: 'old'}}}]
  return {events, surface: {nodes: [0]}, append(type, data, intent) {
    const event = {seq: events.length, type, data, ...intent}; events.push(event)
    this.surface.nodes = [event.seq]; return event
  }}
}
const data = {turn: 1, step: 1, message: {id: 'edit-1', role: 'assistant', content: [{type: 'text', text: '新正文'}]}}
const target = {start: 0, end: 0, sourceEventSeqs: [0]}
test('重复提交复用原事件，冲突及失效目标不产生任何追加', () => {
  const session = fixture()
  const first = replaceSessionSurface(session, 'assistant/message', data, target)
  assert.equal(replaceSessionSurface(session, 'assistant/message', structuredClone(data), target), first)
  assert.equal(session.events.length, 2)
  assert.throws(() => replaceSessionSurface(session, 'assistant/message', {...data, turn: 2}, target), /不同内容/)
  assert.throws(() => replaceSessionSurface(session, 'assistant/message', {...data, message: {...data.message, id: 'other'}}, target), /目标已变化/)
  assert.equal(session.events.length, 2)
})

test('同一恢复批次索引及时记录新事件，保留重试幂等与冲突校验', () => {
  const session = fixture()
  const mutations = createSessionSurfaceMutator(session)
  const placeholder = mutations.append('user/message', { id: 'placeholder', content: [] }, { surfaceOp: 'append' })
  const range = { start: placeholder.seq, end: placeholder.seq, sourceEventSeqs: [placeholder.seq, 0] }
  const first = mutations.replace('assistant/message', data, range)
  assert.equal(mutations.replace('assistant/message', structuredClone(data), range), first)
  assert.throws(() => mutations.replace('assistant/message', { ...data, turn: 9 }, range), /不同内容/)
  assert.throws(() => mutations.replace('assistant/message', { ...data, message: { ...data.message, id: 'other' } }, { start: first.seq, end: first.seq, sourceEventSeqs: [first.seq, 9999] }), /来源引用/)
  assert.equal(session.events.length, 3)
})

// Released V4 refuses a surface event outside an open step and the whole archive
// stops loading ("assistant/message does not match an open turn and step").
// A rewrite between rounds therefore opens a step of its own.
function turnFixture({ closeTurn = false } = {}) {
  const events = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'step/start', data: { turn: 1, step: 1 } },
    { seq: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: { id: 'old' } }, surfaceOp: 'append' },
    { seq: 3, type: 'step/end', data: { turn: 1, step: 1 } },
  ]
  if (closeTurn) events.push({ seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
  return {
    header: { version: 4 },
    events,
    surface: { nodes: [2] },
    append(type, data, intent) {
      const event = { seq: events.length, type, data, ...intent }
      events.push(event)
      if (type === 'assistant/message' && intent?.surfaceOp) this.surface.nodes = [event.seq]
      return event
    },
  }
}

const turnTarget = { start: 2, end: 2, sourceEventSeqs: [2] }

test('回合之间替换正文：自动开一个 step，事件落在其中并可按重试复用', () => {
  const session = turnFixture()
  const written = replaceSessionSurface(session, 'assistant/message', data, turnTarget)
  const [stepStart, replacement, stepEnd] = session.events.slice(-3)
  assert.equal(stepStart.type, 'step/start')
  assert.deepEqual(stepStart.data, { turn: 1, step: 2 })
  assert.equal(replacement, written)
  assert.equal(replacement.data.turn, 1)
  assert.equal(replacement.data.step, 2)
  assert.equal(stepEnd.type, 'step/end')
  assert.deepEqual(stepEnd.data, { turn: 1, step: 2 })
  // Retry with the caller's original placement still reuses the same event.
  assert.equal(replaceSessionSurface(session, 'assistant/message', structuredClone(data), turnTarget), written)
  assert.equal(session.events.length, 7)
})

test('回合已关闭时替换正文：自开专用回合并推进 idle Agent 的回合号', async () => {
  const { setAgentResolver } = await import('../tavern-plugin/lib/domain/agent-lookup.js')
  const agent = { phase: { kind: 'idle', lastTurn: 1 } }
  setAgentResolver(() => agent)
  try {
    const session = turnFixture({ closeTurn: true })
    const written = replaceSessionSurface(session, 'assistant/message', data, turnTarget)
    const tail = session.events.slice(-5)
    assert.equal(tail[0].type, 'turn/start')
    assert.equal(tail[0].data.turn, 2)
    assert.equal(tail[1].type, 'step/start')
    assert.equal(tail[2], written)
    assert.equal(written.data.turn, 2)
    assert.equal(written.data.step, 1)
    assert.equal(tail[3].type, 'step/end')
    assert.equal(tail[4].type, 'turn/end')
    assert.equal(agent.phase.lastTurn, 2)
  } finally { setAgentResolver(null) }
})
