import assert from 'node:assert/strict'
import test from 'node:test'

import { createCompatibilityPresetState } from '../tavern-plugin/lib/domain/compatibility-preset-state.js'

function preset(path = 'presets/demo.json') {
  return {
    path,
    valid: true,
    recognized: true,
    entries: [
      { entryKey: 'on#1', ordered: true, enabled: true, content: '默认开启' },
      { entryKey: 'off#1', ordered: true, enabled: false, content: '默认关闭' },
      { entryKey: 'loose#1', ordered: false, enabled: true, content: '未编排' }
    ]
  }
}

function harness() {
  const presets = new Map([['presets/demo.json', preset()]])
  let stored
  const module = createCompatibilityPresetState({
    readPreset: async function (path) { return presets.get(path) },
    readState: async function () { return stored },
    updateState: async function (updater) {
      const next = await updater(stored)
      if (next !== undefined) stored = structuredClone(next)
      return stored
    },
    now: function () { return 123 }
  })
  return { module, presets, stored: function () { return stored } }
}

test('兼容开关缺省继承酒馆 prompt_order 且不会修改原预设', async () => {
  const value = harness()
  const source = value.presets.get('presets/demo.json')
  const applied = await value.module.apply('presets/demo.json', source)

  assert.deepEqual(applied.entries.map(function (entry) { return [entry.entryKey, entry.enabled, entry.compatibilityInherited] }), [
    ['on#1', true, true],
    ['off#1', false, true],
    ['loose#1', true, true]
  ])
  assert.deepEqual(source.entries.map(function (entry) { return entry.enabled }), [true, false, true])
})

test('兼容开关独立覆盖酒馆状态并同时保存开启和关闭', async () => {
  const value = harness()
  await value.module.toggle({ path: 'presets/demo.json', entryKey: 'on#1', enabled: false })
  await value.module.toggle({ path: 'presets/demo.json', entryKey: 'off#1', enabled: true })

  const applied = await value.module.apply('presets/demo.json')
  assert.deepEqual(applied.entries.map(function (entry) { return [entry.entryKey, entry.enabled, entry.compatibilityInherited] }), [
    ['on#1', false, false],
    ['off#1', true, false],
    ['loose#1', true, true]
  ])
  assert.deepEqual(value.stored().entries['presets/demo.json'], { 'on#1': false, 'off#1': true })
})

test('未编排条目不可设置兼容开关，重命名和删除同步维护状态', async () => {
  const value = harness()
  await assert.rejects(value.module.toggle({ path: 'presets/demo.json', entryKey: 'loose#1', enabled: false }), /prompt_order/)
  await value.module.toggle({ path: 'presets/demo.json', entryKey: 'on#1', enabled: false })
  await value.module.rename('presets/demo.json', 'presets/renamed.json')
  assert.deepEqual(value.stored().entries['presets/renamed.json'], { 'on#1': false })
  await value.module.remove('presets/renamed.json')
  assert.deepEqual(value.stored().entries, {})
})
