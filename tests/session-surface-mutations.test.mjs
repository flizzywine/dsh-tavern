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
