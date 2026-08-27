import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isRuntimePresetBoundaryMessage,
  projectRuntimePresetRequest,
  projectRuntimePresetRequestMessages,
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

test('最终请求把前后投影到 messages 绝对边界，并清除旧 Session 残留', () => {
  const snapshot = {
    front: { entries: [
      { role: 'system', content: '新前一' },
      { role: 'user', content: '新前二' }
    ] },
    back: { entries: [
      { role: 'assistant', content: '新后一' },
      { role: 'system', content: '新后二' }
    ] }
  }
  const messages = [
    phaseMessage('front', '旧前'),
    { role: 'system', content: [{ type: 'text', text: 'DSH 系统上下文' }] },
    { role: 'assistant', content: [{ type: 'text', text: '历史正文' }] },
    phaseMessage('middle', '中段'),
    { role: 'user', content: [{ type: 'text', text: '本轮输入' }] },
    phaseMessage('back', '旧后')
  ]
  const projected = projectRuntimePresetRequestMessages(messages, snapshot, { scope: 'foreground', turn: 5, step: 1 })
  const text = projected.map(function (message) { return message.content[0].text })
  assert.deepEqual(text, ['新前一', '新前二', 'DSH 系统上下文', '历史正文', '中段', '本轮输入', '新后一', '新后二'])
  assert.deepEqual(projected.map(function (message) { return message.role }), [
    'system', 'user', 'system', 'assistant', 'system', 'user', 'assistant', 'system'
  ])
  assert.equal(projected.slice(0, 2).every(isRuntimePresetBoundaryMessage), true)
  assert.equal(projected.slice(-2).every(isRuntimePresetBoundaryMessage), true)
  assert.equal(projected.slice(2, -2).some(isRuntimePresetBoundaryMessage), false)
})

test('没有前后和旧残留时保持原 messages 引用', () => {
  const messages = [{ role: 'user', content: [{ type: 'text', text: '输入' }] }]
  assert.equal(projectRuntimePresetRequestMessages(messages, null), messages)
})

test('激活前段时把 DSH system 移入 messages，并按 strict_tools 归一化中途 system 与相邻角色', () => {
  const snapshot = {
    front: { entries: [
      { role: 'user', content: '前段：林岚，29 岁，与其他角色无亲属关系。' },
      { role: 'system', content: '前段约束' }
    ] },
    back: { entries: [{ role: 'system', content: '后段约束' }] }
  }
  const request = {
    provider: 'test',
    model: 'scripted',
    system: 'DSH 内置系统提示',
    messages: [
      { role: 'assistant', content: [{ type: 'text', text: '历史' }] },
      { role: 'user', content: [{ type: 'text', text: '本轮任务' }] }
    ]
  }
  const projected = projectRuntimePresetRequest(request, snapshot, { scope: 'background', turn: 2, step: 1 })
  assert.notEqual(projected, request)
  assert.equal(request.system, 'DSH 内置系统提示')
  assert.equal(projected.system, '')
  assert.deepEqual(projected.messages.map(function (message) { return [message.role, message.content[0].text] }), [
    ['user', '前段：林岚，29 岁，与其他角色无亲属关系。\n\n前段约束\n\nDSH 内置系统提示'],
    ['assistant', '历史'],
    ['user', '本轮任务\n\n后段约束']
  ])
  assert.deepEqual(projected.messages[0].source.sections.map(function (section) { return section.name }), [
    'tavern:runtime-preset-front',
    'tavern:runtime-preset-front',
    'tavern:dsh-system'
  ])
  assert.deepEqual(projected.messages[2].source.sections.map(function (section) { return section.name }), [
    'tavern:runtime-preset-back'
  ])
  assert.equal(projected.messages.slice(1).some(function (message) { return message.role === 'system' }), false)
})

test('没有激活前段时不改写 DSH 顶层 system', () => {
  const request = { system: 'DSH 系统', messages: [{ role: 'user', content: [{ type: 'text', text: '输入' }] }] }
  assert.equal(projectRuntimePresetRequest(request, null), request)
})

test('角色归一化不合并或破坏 DSH 工具消息', () => {
  const toolCalls = [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }]
  const request = {
    system: 'DSH 系统',
    messages: [
      { role: 'assistant', content: [{ type: 'text', text: '准备调用' }], tool_calls: toolCalls },
      { role: 'assistant', content: [{ type: 'text', text: '普通补充' }] },
      { role: 'tool', tool_call_id: 'call-1', content: [{ type: 'text', text: '结果' }] },
      { role: 'system', content: [{ type: 'text', text: '中途约束' }] }
    ]
  }
  const projected = projectRuntimePresetRequest(request, {
    front: { entries: [{ role: 'user', content: '前段' }] },
    back: { entries: [] }
  })

  assert.deepEqual(projected.messages.map(function (message) { return message.role }), [
    'user', 'assistant', 'assistant', 'tool', 'user'
  ])
  assert.deepEqual(projected.messages[1].tool_calls, toolCalls)
  assert.equal(projected.messages[3].tool_call_id, 'call-1')
  assert.equal(request.messages[3].role, 'system')
})
