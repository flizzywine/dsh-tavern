import assert from 'node:assert/strict'
import test from 'node:test'
import * as surface from '../tavern-plugin/lib/domain/rollback-surface.js'

import { selectRegenerationTarget } from '../tavern-plugin/lib/domain/round-history.js'
const model = { kind: 'model', provider: 'test', model: 'test-model' }
const assistant = (seq, turn, source = model, content = [{ type: 'text', text: '正文' }]) => ({ seq, type: 'assistant/message', data: { turn, step: 1, message: { role: 'assistant', source, content } } })
const cleanup = (seq, turn) => assistant(seq, turn, { kind: 'plugin', plugin: 'dsh-tavern-failed-turn-cleanup' }, [])
const chat = { messages: [{ role: 'assistant', greeting: true, turn: 1 }, { role: 'user', text: '继续' }, { role: 'assistant', turn: 6, text: '已保存正文' }] }
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

test('连续重新生成允许同一剧情轮次的空模型替换节点，跳过后来的失败清理', () => {
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
