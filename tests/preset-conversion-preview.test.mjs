import assert from 'node:assert/strict'
import test from 'node:test'

import { previewPresetConversion } from '../tavern-plugin/lib/domain/preset-conversion-preview.js'

test('按 prompt_order 把启用条目转换为前中后三段并保留 role 与 marker', () => {
  const result = previewPresetConversion(JSON.stringify({
    temperature: 1.1,
    prompts: [
      { identifier: 'front', name: '前置规则', role: 'system', content: '规则' },
      { identifier: 'charDescription', name: '角色描述', role: 'system', marker: true, content: '' },
      { identifier: 'depth', name: '近端提醒', role: 'user', content: '提醒', injection_position: 1, injection_depth: 2, injection_order: 7 },
      { identifier: 'chatHistory', name: '历史', marker: true, content: '' },
      { identifier: 'tail', name: '后置要求', role: 'assistant', content: '开头' },
      { identifier: 'off', name: '关闭项', role: 'system', content: '关闭' },
      { identifier: 'orphan', name: '未编排', content: '孤立' }
    ],
    prompt_order: [{
      character_id: 100001,
      order: [
        { identifier: 'front', enabled: true },
        { identifier: 'charDescription', enabled: true },
        { identifier: 'depth', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'tail', enabled: true },
        { identifier: 'off', enabled: false }
      ]
    }]
  }), '样例.json')

  assert.equal(result.status, 'ready')
  assert.deepEqual(result.phases.front.map(function (entry) { return entry.entryKey }), ['front#1', 'charDescription#1'])
  assert.deepEqual(result.phases.middle.map(function (entry) { return entry.entryKey }), ['depth#1'])
  assert.deepEqual(result.phases.back.map(function (entry) { return entry.entryKey }), ['tail#1'])
  assert.equal(result.phases.front[1].material, 'character.description')
  assert.equal(result.phases.middle[0].role, 'user')
  assert.equal(result.phases.back[0].role, 'assistant')
  assert.equal(result.dshPreset.schema, 'dsh.preset.draft/v1')
  assert.deepEqual(result.dshPreset.front.map(function (entry) { return entry.id }), ['front#1', 'charDescription#1'])
  assert.deepEqual(result.dshPreset.middle.map(function (entry) { return entry.id }), ['depth#1'])
  assert.deepEqual(result.dshPreset.back.map(function (entry) { return entry.id }), ['tail#1'])
  assert.equal(result.dshPreset.front[1].material, 'character.description')
  assert.deepEqual(result.dshPreset.middle[0].source, {
    identifier: 'depth',
    marker: false,
    injectionPosition: 1,
    injectionDepth: 2,
    injectionOrder: 7
  })
  assert.equal(result.sourceRows[3].type, 'history')
  assert.equal(result.excluded.disabled[0].entryKey, 'off#1')
  assert.equal(result.excluded.unordered[0].entryKey, 'orphan#1')
  assert.ok(result.diagnostics.some(function (item) { return item.code === 'TAVERN_DEPTH_COLLAPSED' }))
  assert.ok(result.diagnostics.some(function (item) { return item.code === 'ROOT_CONFIGURATION_NOT_APPLIED' }))
})

test('默认选择 100001 order，并允许按索引切换其他 order 组', () => {
  const source = JSON.stringify({
    prompts: [
      { identifier: 'a', content: 'A' },
      { identifier: 'b', content: 'B' }
    ],
    prompt_order: [
      { character_id: 100000, order: [{ identifier: 'a', enabled: true }] },
      { character_id: 100001, order: [{ identifier: 'b', enabled: true }] }
    ]
  })

  const defaultView = previewPresetConversion(source, '多组.json')
  assert.equal(defaultView.selectedOrderGroupIndex, 1)
  assert.deepEqual(defaultView.phases.front.map(function (entry) { return entry.entryKey }), ['b#1'])

  const selectedView = previewPresetConversion(source, '多组.json', { orderGroupIndex: 0 })
  assert.equal(selectedView.selectedOrderGroupIndex, 0)
  assert.deepEqual(selectedView.phases.front.map(function (entry) { return entry.entryKey }), ['a#1'])
})

test('宏、未知 marker 和缺失定义进入诊断，不被静默修正', () => {
  const result = previewPresetConversion(JSON.stringify({
    prompts: [
      { identifier: 'macro', content: '{{setvar::x::1}}正文{{getvar::x}}' },
      { identifier: 'customMarker', marker: true, content: '' }
    ],
    prompt_order: [{ order: [
      { identifier: 'macro', enabled: true },
      { identifier: 'customMarker', enabled: true },
      { identifier: 'missing', enabled: true }
    ] }]
  }), '异常.json')

  assert.equal(result.status, 'review-required')
  assert.equal(result.phases.front[0].content, '{{setvar::x::1}}正文{{getvar::x}}')
  assert.equal(result.phases.front[1].material, null)
  assert.deepEqual(result.diagnostics.filter(function (item) { return item.severity === 'error' }).map(function (item) { return item.code }), [
    'TAVERN_MACRO_UNSUPPORTED',
    'UNKNOWN_MARKER',
    'ORDER_ENTRY_MISSING'
  ])
})

test('没有 prompt_order 时按 prompts 原始顺序生成只读草稿', () => {
  const result = previewPresetConversion(JSON.stringify({
    prompts: [
      { identifier: 'one', content: '一', enabled: true },
      { identifier: 'chatHistory', marker: true },
      { identifier: 'two', content: '二', enabled: true }
    ]
  }), '无顺序.json')

  assert.equal(result.selectedOrderGroupIndex, null)
  assert.equal(result.selectedOrderGroupLabel, 'prompts 原始顺序')
  assert.deepEqual(result.phases.front.map(function (entry) { return entry.entryKey }), ['one#1'])
  assert.deepEqual(result.phases.back.map(function (entry) { return entry.entryKey }), ['two#1'])
})
