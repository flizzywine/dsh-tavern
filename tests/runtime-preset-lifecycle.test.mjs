import assert from 'node:assert/strict'
import test from 'node:test'

import { projectRuntimePresetRequest } from '../tavern-plugin/lib/domain/runtime-preset-lifecycle.js'

for (const phase of ['front', 'back']) test(`V3 native system remains system with ${phase} preset`, () => {
  const nativeSystem = { id: 'native-system', role: 'system', content: [{ type: 'text', text: '固定人物背景' }], source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' } }
  const request = { messages: [
    { role: 'user', content: [{ type: 'text', text: '开场种子' }] },
    { role: 'assistant', content: [{ type: 'text', text: '开场白' }] },
    nativeSystem,
    { role: 'user', content: [{ type: 'text', text: '继续' }] }
  ] }
  const before = structuredClone(request)
  const projected = projectRuntimePresetRequest(request, { [phase]: { entries: [{ role: 'system', content: '预设要求' }] } })
  assert.equal(projected.messages[0].role, 'system')
  assert.ok(projected.messages[0].content.some(b => b.text.includes('固定人物背景')))
  assert.equal(projected.messages.filter(m => JSON.stringify(m.content).includes('固定人物背景')).length, 1)
  assert.equal(projected.messages.filter(m => m.role === 'system').length, 1)
  assert.deepEqual(request, before)
  assert.equal(projectRuntimePresetRequest(request, null), request)
})

for (const native of [false, true]) test(`附加指令在外部预设之前且只保留一份（${native ? 'V3 消息' : '顶层 system'}）`, () => {
  const instruction = '用户附加指令\n第二行'
  const system = instruction + '\n\n内置系统上下文'
  const nativeSystem = { role: 'system', content: [{ type: 'text', text: system }], source: {
    kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', sections: [
      { name: 'tavern:system-append', text: instruction }, { name: 'persona', text: '内置系统上下文' }
    ]
  } }
  const request = { ...(native ? {} : { system }), messages: [
    ...(native ? [nativeSystem] : []), { role: 'user', content: [{ type: 'text', text: '本轮输入' }] }
  ] }
  const before = structuredClone(request)
  const snapshot = { front: { entries: [{ role: 'system', content: '外部预设前段' }] }, back: { entries: [{ role: 'system', content: '外部预设后段' }] } }
  const result = projectRuntimePresetRequest(request, snapshot, { systemAppend: instruction })
  assert.deepEqual(result.messages.map(m => [m.role, m.content[0].text]), [
    ['system', instruction + '\n\n外部预设前段\n\n内置系统上下文'], ['user', '本轮输入\n\n外部预设后段']
  ])
  assert.equal(result.messages[0].source.sections[0].name, 'tavern:system-append')
  assert.equal(result.messages[0].source.sections.filter(s => s.name === 'tavern:system-append').length, 1)
  assert.deepEqual(request, before)
  assert.equal(projectRuntimePresetRequest(request, null, { systemAppend: instruction }), request)
})

test('同一轮工具循环里，预设后置段固定在本轮输入之后，第 2 步不改写第 1 步的前缀', async () => {
  const { projectRuntimePresetRequest } = await import('../tavern-plugin/lib/domain/runtime-preset-lifecycle.js')
  const snapshot = { front: null, back: { entries: [{ role: 'user', content: '重要！！！状态栏' }] } }
  const input = { role: 'user', content: [{ type: 'text', text: '玩家输入' }], source: { kind: 'user' } }
  const frame = { role: 'user', content: [{ type: 'text', text: '本轮帧' }], source: { kind: 'plugin:dsh-tavern', form: 'foreground-frame' } }
  const history = [{ role: 'user', content: [{ type: 'text', text: '旧输入' }], source: { kind: 'user' } },
    { role: 'assistant', content: [{ type: 'text', text: '旧正文' }], source: { kind: 'model' } }]
  const step1 = projectRuntimePresetRequest({ messages: [...history, input, frame] }, snapshot, { turn: 2, step: 1 }).messages
  const call = { role: 'assistant', content: [{ type: 'reasoning', text: '' }, { type: 'tool-call', id: 't1', name: 'worldbook_search', arguments: '{}' }], source: { kind: 'model' } }
  const result = { role: 'tool', content: [{ type: 'tool-result', id: 't1', text: '结果' }], source: { kind: 'tool' } }
  const step2 = projectRuntimePresetRequest({ messages: [...history, input, frame, call, result] }, snapshot, { turn: 2, step: 2 }).messages
  const text = message => JSON.stringify(message.content)
  // 第 1 步：后置段在末尾（并入本轮输入）。第 2 步：留在原处，工具调用之前。
  assert.match(text(step1.at(-1)), /重要！！！状态栏/)
  const before = step2.slice(0, step2.indexOf(step2.find(message => message.role === 'assistant' && message.content.some(block => block.type === 'tool-call'))))
  assert.deepEqual(before.map(text), step1.map(text), '工具调用之前的内容与第 1 步完全一致')
  assert.doesNotMatch(text(step2.at(-1)), /重要！！！状态栏/)
})

test('后台任务工具循环：预设后置段固定在当前任务输入与 step-1 回复之间，front 保留在系统区', () => {
  const snapshot = {
    front: { entries: [{ role: 'system', content: '后台前段设定' }] },
    back: { entries: [{ role: 'user', content: '后台后段约束' }] }
  }
  const middle = {
    role: 'system',
    content: [{ type: 'text', text: '后台中段要求' }],
    source: { kind: 'plugin:dsh-tavern', form: 'snapshot', sections: [{ name: 'tavern:runtime-preset-middle', text: '后台中段要求' }] }
  }
  const taskInput = {
    role: 'user',
    content: [{ type: 'text', text: '<recent_task>结算本轮状态</recent_task>' }],
    source: { kind: 'plugin:dsh-tavern' }
  }
  const history = [
    { role: 'user', content: [{ type: 'text', text: '上一轮任务' }], source: { kind: 'plugin:dsh-tavern' } },
    { role: 'assistant', content: [{ type: 'text', text: '上一轮结果' }], source: { kind: 'model' } }
  ]
  const step1 = projectRuntimePresetRequest(
    { system: '后台任务系统指令', messages: [...history, middle, taskInput] },
    snapshot,
    { scope: 'background', turn: 3, step: 1 }
  ).messages
  const call = {
    role: 'assistant',
    content: [{ type: 'tool-call', id: 'c1', name: 'tavern_read_source', arguments: '{"sourceId":"story","turn":2}' }],
    source: { kind: 'model' }
  }
  const result = {
    role: 'tool',
    content: [{ type: 'tool-result', id: 'c1', text: '原文' }],
    source: { kind: 'tool' }
  }
  const step2 = projectRuntimePresetRequest(
    { system: '后台任务系统指令', messages: [...history, middle, taskInput, call, result] },
    snapshot,
    { scope: 'background', turn: 3, step: 2 }
  ).messages
  const text = m => JSON.stringify(m.content)
  assert.equal(step1[0].role, 'system')
  assert.match(text(step1[0]), /后台前段设定[\s\S]*后台任务系统指令/)
  assert.match(text(step1.at(-1)), /后台后段约束/)
  const beforeCall = step2.slice(0, step2.findIndex(m => m.role === 'assistant' && m.content.some(b => b.type === 'tool-call')))
  assert.deepEqual(beforeCall.map(text), step1.map(text), '工具调用前的前缀（含 front / middle / task / back）在 step 2 保持完全一致')
  assert.doesNotMatch(text(step2.at(-1)), /后台后段约束/)
})

