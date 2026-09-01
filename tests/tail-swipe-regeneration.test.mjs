import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from '../tavern-plugin/node_modules/@deepseek-ai/dsh-session/lib/index.js'

import { projectTailSwipeView, synchronizeTailSwipeSurface } from '../tavern-plugin/lib/domain/tail-swipe-regeneration.js'

function fixture() {
  const source = { kind: 'model', provider: 'test', model: 'test' }
  const events = [
    { seq: 0, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', source, content: [{ type: 'text', text: '开场' }] } } },
    { seq: 1, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '继续' }] } },
    { seq: 2, type: 'assistant/message', data: { turn: 2, step: 1, message: { role: 'assistant', source, content: [{ type: 'text', text: '正文2' }] } } }
  ]
  const session = {
    events,
    surface: { nodes: [0, 1, 2] },
    append(type, data, options) {
      const seq = events.length
      events.push({ seq, type, data, ...options })
      const start = session.surface.nodes.indexOf(options.surfaceOp.start)
      const end = session.surface.nodes.indexOf(options.surfaceOp.end)
      session.surface.nodes.splice(start, end - start + 1, seq)
      return seq
    }
  }
  const chat = {
    messages: [
      { role: 'assistant', greeting: true, turn: 1, text: '开场' },
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 2, text: '正文1', sessionText: '正文1', swipeId: 0, swipes: ['正文1', '正文2'] }
    ]
  }
  return { chat, session }
}

test('发送前只把最终选中的尾部 Swipe 固化到模型消息面，并保持重复同步幂等', () => {
  const run = fixture()

  const first = synchronizeTailSwipeSurface({ chat: run.chat, session: run.session, id: () => 'selected-tail' })
  assert.equal(first.updated, true)
  assert.deepEqual(run.session.events.at(-1).data.message.content, [{ type: 'text', text: '正文1' }])
  assert.deepEqual(run.session.events.at(-1).surfaceOp, { op: 'replace', start: 2, end: 2 })
  assert.deepEqual(run.session.events.at(-1).sourceEventSeqs, [2])

  const eventCount = run.session.events.length
  const second = synchronizeTailSwipeSurface({ chat: run.chat, session: run.session, id: () => 'unused' })
  assert.equal(second.updated, false)
  assert.equal(run.session.events.length, eventCount)
})

test('只有最后一条助手正文可以作为 Swipe 固化目标', () => {
  const run = fixture()
  run.chat.messages.push({ role: 'user', text: '已经开始下一轮' })

  assert.throws(() => synchronizeTailSwipeSurface({ chat: run.chat, session: run.session }), /最后一条正文/)
})

test('界面只为最后一条助手正文提供 Swipe 控件', () => {
  const run = fixture()
  run.chat.messages[0].swipes = ['开场甲', '开场乙']

  assert.deepEqual(projectTailSwipeView(run.chat), [{ messageId: 2, turn: 2, swipeId: 0, count: 2 }])
})

test('开场白切换后也会在第一轮发送前固化当前 Swipe', () => {
  const run = fixture()
  run.chat.messages = [{
    role: 'assistant', greeting: true, turn: 1, text: '开场乙', sessionText: '开场乙',
    swipeId: 1, swipes: ['开场甲', '开场乙']
  }]
  run.session.events.splice(1)
  run.session.surface.nodes = [0]

  const result = synchronizeTailSwipeSurface({ chat: run.chat, session: run.session, id: () => 'selected-opening' })

  assert.equal(result.updated, true)
  assert.deepEqual(run.session.events.at(-1).data.message.content, [{ type: 'text', text: '开场乙' }])
  assert.deepEqual(run.session.events.at(-1).surfaceOp, { op: 'replace', start: 0, end: 0 })
})

test('真实 DSH Session 下一轮只看见最终选中的正文', () => {
  const source = { kind: 'model', provider: 'test', model: 'test' }
  const session = Session.create('tail-swipe-native')
  session.append('assistant/message', {
    turn: 1, step: 1,
    message: { id: 'opening', role: 'assistant', source, content: [{ type: 'text', text: '开场' }] }
  }, { surfaceOp: 'append' })
  session.append('user/message', {
    id: 'user', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }]
  }, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 2, step: 1,
    message: { id: 'old-tail', role: 'assistant', source, content: [{ type: 'text', text: '未选中的正文' }] }
  }, { surfaceOp: 'append' })
  const chat = {
    messages: [
      { role: 'assistant', greeting: true, turn: 1, text: '开场' },
      { role: 'user', text: '继续' },
      { role: 'assistant', turn: 2, text: '选中的正文', sessionText: '选中的正文', swipeId: 1, swipes: ['未选中的正文', '选中的正文'] }
    ]
  }

  synchronizeTailSwipeSurface({ chat, session, id: () => 'selected-tail' })

  const visible = JSON.stringify(session.deriveMessages())
  assert.match(visible, /选中的正文/)
  assert.doesNotMatch(visible, /未选中的正文/)
})
