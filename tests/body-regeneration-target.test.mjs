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

function select(events, nodes) {
  const { oldSeq, oldTurn, oldSource, oldAssistantIndex } = selectRegenerationTarget(chat, { events, surface: { nodes } })
  return { oldSeq, oldTurn, oldSource, oldAssistantIndex }
}

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

test('投影出来的正文借了编辑回合的编号时，用存档正文找回这一轮', () => {
  // A regeneration replaces the round's node with one written into an edit turn
  // (6), and older releases did not record the story turn: the save says 4, the
  // only node that still holds the body says 6.
  const events = [assistant(0, 1), assistant(9, 6, model, [{ type: 'text', text: '重写后的正文' }])]
  assert.equal(surface.locateRegenerationSurface({ events, nodes: [0, 9], turn: 4 }), null)
  const found = surface.locateRegenerationSurface({ events, nodes: [0, 9], turn: 4, texts: ['重写后的正文'] })
  assert.equal(found.assistantSeq, 9)
  assert.equal(found.turn, 4)
  // 正文对不上就不能认：宁可报错，也不要替换到别的楼层。
  assert.equal(surface.locateRegenerationSurface({ events, nodes: [0, 9], turn: 4, texts: ['另一段正文'] }), null)
  // 空白差异不算不同版本。
  const spaced = [assistant(0, 1), assistant(9, 6, model, [{ type: 'text', text: '第一段\n第二段' }])]
  assert.equal(surface.locateRegenerationSurface({ events: spaced, nodes: [0, 9], turn: 4, texts: ['第一段 第二段'] })?.assistantSeq, 9)
})

test('失败轮的占位行不是重新生成目标：回落到上一条已提交正文', () => {
  const messages = [
    { role: 'user', text: '开场' },
    { role: 'assistant', turn: 6, text: '正文' },
    { role: 'user', text: '这一轮失败了' },
    { role: 'assistant', turn: 7, placeholder: true }
  ]
  const { oldAssistantIndex, oldTurn } = selectRegenerationTarget({ messages }, { events: [assistant(3, 6)], surface: { nodes: [3] } })
  // The target is the last round that actually has text, not the failed placeholder.
  assert.equal(oldAssistantIndex, 1)
  assert.equal(oldTurn, 6)
})
