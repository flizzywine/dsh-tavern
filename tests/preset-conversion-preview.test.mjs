import assert from 'node:assert/strict'
import test from 'node:test'

import { previewPresetConversion } from '../tavern-plugin/lib/domain/preset-conversion-preview.js'

test('按 prompt_order 把全部条目转换为前中后三段，保留开关并忽略 DSH 原生材料 marker 与顶层参数', () => {
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
  assert.deepEqual(result.phases.front.map(function (entry) { return entry.entryKey }), ['front#1'])
  assert.deepEqual(result.phases.middle.map(function (entry) { return entry.entryKey }), ['depth#1'])
  assert.deepEqual(result.phases.back.map(function (entry) { return entry.entryKey }), ['tail#1', 'off#1'])
  assert.equal(result.phases.middle[0].role, 'user')
  assert.equal(result.phases.back[0].role, 'assistant')
  assert.equal(result.dshPreset.schema, 'dsh.preset.draft/v1')
  assert.deepEqual(result.dshPreset.front.map(function (entry) { return entry.id }), ['front#1'])
  assert.deepEqual(result.dshPreset.middle.map(function (entry) { return entry.id }), ['depth#1'])
  assert.deepEqual(result.dshPreset.back.map(function (entry) { return entry.id }), ['tail#1', 'off#1'])
  assert.equal(result.dshPreset.back[1].enabled, false)
  assert.deepEqual(result.excluded.nativeMaterials.map(function (entry) { return entry.entryKey }), ['charDescription#1'])
  assert.equal(result.summary.nativeMaterialRows, 1)
  assert.deepEqual(result.dshPreset.middle[0].source, {
    identifier: 'depth',
    marker: false,
    injectionPosition: 1,
    injectionDepth: 2,
    injectionOrder: 7
  })
  assert.equal(result.sourceRows[3].type, 'history')
  assert.equal(result.excluded.unordered[0].entryKey, 'orphan#1')
  assert.deepEqual(result.unconverted.prompts.map(function (entry) { return entry.entryKey }), ['orphan#1'])
  assert.equal(result.unconverted.rootConfiguration, undefined)
  assert.ok(result.diagnostics.some(function (item) { return item.code === 'TAVERN_DEPTH_COLLAPSED' }))
  assert.ok(!result.diagnostics.some(function (item) { return item.code === 'ROOT_CONFIGURATION_NOT_APPLIED' }))
  assert.ok(result.diagnostics.some(function (item) { return item.code === 'NATIVE_MATERIAL_MARKERS_IGNORED' }))
})

test('七类人物卡与世界书 marker 全部由 DSH 原生装配，不进入转换稿', () => {
  const identifiers = [
    'personaDescription',
    'charDescription',
    'charPersonality',
    'scenario',
    'dialogueExamples',
    'worldInfoBefore',
    'worldInfoAfter'
  ]
  const result = previewPresetConversion(JSON.stringify({
    prompts: identifiers.map(function (identifier) { return { identifier, marker: true, content: '' } }),
    prompt_order: [{ order: identifiers.map(function (identifier) { return { identifier, enabled: true } }) }]
  }), '原生材料.json')

  assert.deepEqual(result.dshPreset.front, [])
  assert.deepEqual(result.dshPreset.middle, [])
  assert.deepEqual(result.dshPreset.back, [])
  assert.deepEqual(result.excluded.nativeMaterials.map(function (entry) { return entry.identifier }), identifiers)
  assert.equal(result.summary.enabledRows, 0)
  assert.equal(result.summary.nativeMaterialRows, 7)
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

test('宏留待运行时解析，未知 marker 和缺失定义继续阻止直接使用', () => {
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
  assert.equal(result.phases.front.length, 1)
  assert.deepEqual(result.unconverted.prompts.map(function (entry) { return entry.entryKey }), ['missing#missing-3', 'customMarker#1'])
  assert.deepEqual(result.unconverted.prompts.map(function (entry) { return entry.unconvertedReason }), ['缺失 prompt 定义', '未知 marker'])
  assert.deepEqual(result.diagnostics.filter(function (item) { return item.severity === 'error' }).map(function (item) { return item.code }), [
    'UNKNOWN_MARKER',
    'ORDER_ENTRY_MISSING'
  ])
  assert.equal(result.diagnostics.find(function (item) { return item.code === 'TAVERN_MACRO_RUNTIME' }).severity, 'info')
})

test('正则进入 DSH 转换稿，顶层参数与其他扩展被忽略，未选择 order 组保留', () => {
  const result = previewPresetConversion(JSON.stringify({
    temperature: 0.8,
    prompts: [
      { identifier: 'main', content: '正文' },
      { identifier: 'charDescription', marker: true, content: '' }
    ],
    prompt_order: [
      { character_id: 100001, order: [{ identifier: 'main', enabled: true }] },
      { character_id: 100000, order: [{ identifier: 'charDescription', enabled: true }] }
    ],
    extensions: { SPreset: { RegexBinding: { regexes: [{ findRegex: '/x/g', replaceString: 'y' }] } }, custom: { value: 42 } }
  }), '完整报告.json')

  assert.equal(result.unconverted.rootConfiguration, undefined)
  assert.equal(result.unconverted.extensions, undefined)
  assert.equal(result.dshPreset.regex.length, 1)
  assert.equal(result.dshPreset.regex[0].findRegex, '/x/g')
  assert.equal(result.dshPreset.regex[0].replaceString, 'y')
  assert.equal(result.dshPreset.regex[0].enabled, true)
  assert.equal(result.unconverted.unselectedOrderGroups[0].label, '角色组 100000')
  assert.equal(result.unconverted.prompts.length, 0)
  assert.deepEqual(result.excluded.nativeMaterials.map(function (entry) { return entry.identifier }), ['charDescription'])
  assert.equal(result.summary.regexRows, 1)
  assert.equal(result.summary.enabledRegexRows, 1)
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
