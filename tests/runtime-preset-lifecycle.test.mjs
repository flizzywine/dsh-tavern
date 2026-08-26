import assert from 'node:assert/strict'
import test from 'node:test'
import { adoptSessionEvent } from '../tavern-plugin/node_modules/@deepseek-ai/dsh-session/lib/index.js'

import {
  clearRuntimePresetBoundaryMessages,
  isRuntimePresetBoundaryMessage,
  runtimePresetPhaseMessages
} from '../tavern-plugin/lib/domain/runtime-preset-lifecycle.js'

function phaseMessage(phase, text) {
  return runtimePresetPhaseMessages({ [phase]: { entries: [{ role: 'system', content: text }] } }, phase, { scope: 'foreground', turn: 4, step: 1 })[0]
}

test('前中后保留原角色，只有前后属于请求边界消息', () => {
  const snapshot = {
    front: { entries: [{ role: 'system', content: '前' }] },
    middle: { entries: [{ role: 'user', content: '中' }] },
    back: { entries: [{ role: 'assistant', content: '后' }] }
  }
  const front = runtimePresetPhaseMessages(snapshot, 'front', { scope: 'foreground', turn: 2, step: 1 })[0]
  const middle = runtimePresetPhaseMessages(snapshot, 'middle', { scope: 'foreground', turn: 2, step: 1 })[0]
  const back = runtimePresetPhaseMessages(snapshot, 'back', { scope: 'foreground', turn: 2, step: 1 })[0]
  assert.deepEqual([front.role, middle.role, back.role], ['system', 'user', 'assistant'])
  assert.equal(isRuntimePresetBoundaryMessage(front), true)
  assert.equal(isRuntimePresetBoundaryMessage(middle), false)
  assert.equal(isRuntimePresetBoundaryMessage(back), true)
})

test('真实请求形成后只遮蔽前后，不遮蔽中段和普通消息', () => {
  const events = [
    { type: 'user/message', data: phaseMessage('front', '前') },
    { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '普通输入' }] } },
    { type: 'user/message', data: phaseMessage('middle', '中') },
    { type: 'user/message', data: phaseMessage('back', '后') }
  ]
  const appended = []
  const session = {
    events,
    surface: { nodes: [0, 1, 2, 3] },
    append(type, data, options) { appended.push({ type, data, options }) }
  }
  assert.equal(clearRuntimePresetBoundaryMessages(session, { turn: 2, step: 1, source: { kind: 'model', provider: 'test', model: 'scripted' } }), 2)
  assert.equal(appended.length, 2)
  assert.deepEqual(appended.map(function (item) { return item.options.sourceEventSeqs }), [[0], [3]])
  assert.deepEqual(appended.map(function (item) { return item.options.surfaceOp }), [
    { op: 'replace', start: 0, end: 0 },
    { op: 'replace', start: 3, end: 3 }
  ])
  assert.deepEqual(appended.map(function (item) { return item.data.message.source }), [
    { kind: 'model', provider: 'test', model: 'scripted' },
    { kind: 'model', provider: 'test', model: 'scripted' }
  ])
  for (let index = 0; index < appended.length; index += 1) {
    assert.doesNotThrow(function () {
      adoptSessionEvent({ seq: 10 + index, time: 100 + index, type: appended[index].type, data: appended[index].data, ...appended[index].options })
    })
  }
})

test('兼容带 message 包裹的旧 Session 事件', () => {
  const wrapped = phaseMessage('front', '旧前缀')
  const appended = []
  const session = {
    events: [{ type: 'user/message', data: { message: wrapped } }],
    surface: { nodes: [0] },
    append(type, data, options) { appended.push({ type, data, options }) }
  }

  assert.equal(clearRuntimePresetBoundaryMessages(session), 1)
  assert.deepEqual(appended[0].options.sourceEventSeqs, [0])
})
