import assert from 'node:assert/strict'
import test from 'node:test'
import * as surface from '../tavern-plugin/lib/domain/rollback-surface.js'

import { selectRegenerationTarget } from '../tavern-plugin/lib/domain/round-history.js'
const model = { kind: 'model', provider: 'test', model: 'test-model' }
const assistant = (seq, turn, source = model, content = [{ type: 'text', text: '正文' }]) => ({ seq, type: 'assistant/message', data: { turn, step: 1, message: { role: 'assistant', source, content } } })
const cleanup = (seq, turn) => assistant(seq, turn, { kind: 'plugin', plugin: 'dsh-tavern-failed-turn-cleanup' }, [])
const chat = { messages: [{ role: 'assistant', greeting: true, turn: 1 }, { role: 'user', text: '继续' }, { role: 'assistant', turn: 6, text: '已保存正文' }] }
test('同一句配对错误记录不同结构原因，不修改消息或暴露文本', () => {
  const cases = [
    [[{ role: 'assistant', greeting: true }], 'no-non-greeting-assistant'],
    [[{ role: 'assistant', turn: 2 }], 'assistant-at-start'],
    [[null, { role: 'assistant', turn: 2 }], 'previous-message-invalid'],
    [[{ role: 'user' }, { role: 'system' }, { role: 'assistant', turn: 2 }], 'previous-message-not-user']
  ]
  for (const [messages, reason] of cases) {
    for (const msg of messages) if (msg) msg.text = 'private-user-story-and-key'
    const before = structuredClone(messages)
    let evidence
    assert.throws(() => selectRegenerationTarget({messages}, {events:[],surface:{nodes:[]}}, value => { evidence = value }), /没有可重新生成/)
    assert.equal(evidence.reason, reason)
    assert.equal(evidence.chat.messageCount, messages.length)
    assert.doesNotMatch(JSON.stringify(evidence), /private-user-story-and-key/)
    assert.deepEqual(messages, before)
  }
})

test('原生轮次匹配失败和成功有独立记录，诊断观察者异常不改变结果', () => {
  let evidence
  assert.throws(() => selectRegenerationTarget(chat, {events: [assistant(0, 5)], surface:{nodes:[0]}}, value => {evidence=value}), /找不到/)
  assert.equal(evidence.reason, 'native-target-missing')
  assert.equal(evidence.selection.requestedTurn, 6)
  const session = {events:[assistant(0,6)], surface:{nodes:[0]}}
  selectRegenerationTarget(chat, session, value => {evidence=value})
  assert.equal(evidence.reason, 'selected')
  assert.equal(evidence.native.matchingSurfaceCount, 1)
  assert.equal(evidence.selection.nativeSeq, 0)
  assert.equal(selectRegenerationTarget(chat, session, () => {throw new Error('diagnostic failure')}).oldSeq, 0)
})

test('大量历史仅记录有限结构尾部，不收集内容或任意属性', () => {
  const messages = Array.from({length: 10000}, () => ({ role: 'assistant', greeting: true, text: 'secret', privateField: 'private' }))
  const session = {events: Array.from({length:1000}, (_, seq) => assistant(seq, 6)), surface:{nodes:Array.from({length:1000}, (_, i) => i)}}
  let evidence
  assert.throws(() => selectRegenerationTarget({messages}, session, value => {evidence=value}))
  assert.ok(evidence.chat.messages.length <= 17)
  assert.ok(evidence.native.surfaceTail.length <= 12)
  assert.ok(Buffer.byteLength(JSON.stringify(evidence)) < 16000)
  assert.doesNotMatch(JSON.stringify(evidence), /secret|privateField/)
})
function select(events, nodes) {
  const { oldSeq, oldTurn, oldSource, oldAssistantIndex } = selectRegenerationTarget(chat, { events, surface: { nodes } })
  return { oldSeq, oldTurn, oldSource, oldAssistantIndex }
}

test('失败清理节点不能被当作旧正文，重试定位权威剧情轮次', () => {
  const events = [assistant(0, 6), cleanup(1, 7)]
  const before = structuredClone(events)
  assert.deepEqual(select(events, [0, 1]), { oldSeq: 0, oldTurn: 6, oldSource: model, oldAssistantIndex: 2 })
  assert.deepEqual(events, before)
})

test('旧版空替换节点仍可作为连续重新生成目标，并跳过后来的失败清理', () => {
  const events = [assistant(0, 6), assistant(1, 8), assistant(2, 6, model, []), cleanup(3, 9)]
  assert.equal(select(events, [2, 3]).oldSeq, 2)
})

test('不能把其他轮次的模型消息误选为当前正文', () => {
  assert.equal(select([assistant(0, 6), assistant(1, 7)], [0, 1]).oldSeq, 0)
  assert.throws(() => select([assistant(0, 5), cleanup(1, 7)], [0, 1]), /找不到.*对应.*正文/)
})

test('普通正文定位保持不变，只有清理标记时不得开始重新生成', () => {
  assert.equal(select([assistant(0, 6)], [0]).oldSeq, 0)
  assert.throws(() => select([cleanup(0, 7)], [0]), /找不到/)
})

test('失败清理、重试成功、再次失败和再次重生成始终替换同一剧情轮次', () => {
  const events = [assistant(0, 6)]
  const nodes = [0]
  const session = {
    events,
    surface: { nodes },
    append(type, data, options = {}) {
      const seq = events.length
      events.push({ seq, type, data, ...options })
      if (options.surfaceOp === 'append') nodes.push(seq)
      else if (options.surfaceOp) {
        const start = nodes.indexOf(options.surfaceOp.start)
        const end = nodes.indexOf(options.surfaceOp.end)
        assert.ok(start >= 0 && end >= start)
        nodes.splice(start, end - start + 1, seq)
      }
      return seq
    }
  }
  let previous = 0
  for (const failedTurn of [7, 9]) {
    session.append('turn/start', { turn: failedTurn })
    session.append('assistant/message', assistant(0, failedTurn).data, { surfaceOp: 'append' })
    session.append('turn/end', { turn: failedTurn })
    assert.equal(surface.clearFailedTurnSurface({ session, turn: failedTurn }), 1)
    const target = select(events, nodes)
    assert.equal(target.oldSeq, previous)
    const eventStart = events.length
    session.append('user/message', { content: '重新生成' }, { surfaceOp: 'append' })
    session.append('assistant/message', assistant(0, failedTurn + 1).data, { surfaceOp: 'append' })
    const plan = surface.planRegenerationSurface({ events, nodes, oldAssistantSeq: target.oldSeq, eventStart })
    assert.deepEqual(plan.shadowedSeqs, nodes)
    previous = session.append('assistant/message', assistant(0, target.oldTurn, target.oldSource, []).data, {
      surfaceOp: { op: 'replace', start: plan.start, end: plan.end },
      sourceEventSeqs: plan.shadowedSeqs
    })
    assert.deepEqual(nodes, [previous])
    assert.equal(select(events, nodes).oldTurn, 6)
  }
})

test('不完整的轮次不能退回到任意旧正文，事件序号可以不连续', () => {
  for (const turn of [undefined, null, 0, -1, 1.5, 'bad']) {
    assert.equal(surface.locateRegenerationSurface({ events: [assistant(0, 6)], nodes: [0], turn }), null)
  }
  assert.equal(select([assistant(42, 6), cleanup(50, 7)], [42, 50]).oldSeq, 42)
})
