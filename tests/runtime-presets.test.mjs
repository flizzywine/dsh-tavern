import assert from 'node:assert/strict'
import test from 'node:test'

import { createRuntimePresetModule } from "../tavern-plugin/lib/domain/runtime-presets.js"

function preset(path, entries, regexScripts = []) {
  const occurrences = new Map()
  return {
    path,
    title: path.split('/').pop().replace(/\.json$/i, ''),
    valid: true,
    recognized: true,
    entries: entries.map(function (entry, index) {
      const identifier = entry.identifier
      const occurrence = (occurrences.get(identifier) || 0) + 1
      occurrences.set(identifier, occurrence)
      return Object.assign({
        entryKey: identifier + '#' + String(occurrence),
        identifier,
        name: identifier,
        role: 'system',
        content: '',
        enabled: true,
        marker: false,
        ordered: true,
        injectable: true
      }, entry)
    }),
    regexScripts
  }
}

function harness() {
  const presets = new Map([
    ['presets/先导入.json', preset('presets/先导入.json', [
      { identifier: 'a', content: '第一段' },
      { identifier: 'empty', content: '', marker: true, injectable: false },
      { identifier: 'b', content: '第二段', enabled: false }
    ], [
      { id: 'status', name: '状态栏', findRegex: '/<status>(.*?)<\\/status>/s', replaceString: '<aside>$1</aside>', placement: [2], enabled: true },
      { id: 'status', name: '状态栏副本', findRegex: '/<info>(.*?)<\\/info>/s', replaceString: '<aside>$1</aside>', placement: [2], enabled: false }
    ])],
    ['presets/后导入.json', preset('presets/后导入.json', [
      { identifier: 'c', content: '第三段' }
    ])]
  ])
  let state
  let clock = 100
  let writes = 0
  const module = createRuntimePresetModule({
    listPaths: async () => Array.from(presets.keys()),
    readPreset: async (path) => presets.get(path),
    readState: async () => state === undefined ? undefined : structuredClone(state),
    updateState: async (updater) => {
      const next = await updater(state === undefined ? undefined : structuredClone(state))
      if (next !== undefined) { state = structuredClone(next); writes += 1 }
      return state === undefined ? undefined : structuredClone(state)
    },
    now: () => clock++
  })
  return { module, presets, getState: () => structuredClone(state), getWrites: () => writes }
}

test('失效预设修复后成功生成快照会清除持久错误', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.select('presets/先导入.json')
  value.presets.delete('presets/先导入.json')
  await assert.rejects(value.module.snapshot(), /预设注入失败/)
  value.presets.set('presets/先导入.json', preset('presets/先导入.json', [{ identifier: 'a', content: '已修复' }], [
    { id: 'status', name: '状态栏', findRegex: '/<status>(.*?)<\\/status>/s', replaceString: '<aside>$1</aside>', placement: [2], enabled: true }
  ]))

  assert.equal((await value.module.snapshot()).text, '已修复')
  assert.equal((await value.module.state()).lastError, null)
})
