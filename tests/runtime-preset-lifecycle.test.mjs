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
