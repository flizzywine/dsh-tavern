import assert from 'node:assert/strict'
import test from 'node:test'

import { createRuntimePresetModule, resolveRuntimePresetMacros } from '../tavern-plugin/lib/domain/runtime-presets.js'

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

test('请求投影保留绑定路径，正则开关可在旧对话中实时解析', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.select('presets/先导入.json')

  const snapshot = await value.module.snapshot()

  assert.equal(snapshot.text, '第一段')
  assert.equal(snapshot.presetPath, 'presets/先导入.json')
  assert.deepEqual((await value.module.regexScriptsFor(snapshot)).map(function (script) { return script.regexKey }), ['status#1'])

  await value.module.toggleRegex({ path: 'presets/先导入.json', regexKey: 'status#2', enabled: true })
  const enabled = await value.module.regexScriptsFor(snapshot)
  assert.equal(enabled.length, 2)
  assert.equal(enabled[1].name, '状态栏副本')
  assert.equal(enabled[1].enabled, true)
  assert.equal(snapshot.text, '第一段')

  await value.module.toggleRegex({ path: 'presets/先导入.json', regexKey: 'status#2', enabled: false })
  assert.deepEqual((await value.module.regexScriptsFor(snapshot)).map(function (script) { return script.regexKey }), ['status#1'])
})

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

test('可以选择不启用外部预设，同时保留内部勾选配置', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.select('presets/先导入.json')
  assert.equal((await value.module.snapshot()).text, '第一段')

  await value.module.select('')

  assert.equal(await value.module.snapshot(), null)
  assert.equal((await value.module.view('presets/先导入.json')).entries[0].runtimeEnabled, true)
})

test('预设中段、后段的 random/roll 按本轮种子展开，前段保持原文', () => {
  const raw = {
    front: { entries: [{ id: 'f', role: 'system', content: '前段 {{roll::1d20}}' }] },
    middle: { entries: [{ id: 'm', role: 'system', content: '中段 {{random::甲::乙::丙}} {{roll: 2d6+1}}' }] },
    back: { entries: [{ id: 'b', role: 'system', content: '后段 {{roll::1d1000}} {{user}}' }] }
  }
  const one = resolveRuntimePresetMacros(raw, { randomSeed: 'seed-1' }).snapshot
  assert.equal(one.front.entries[0].content, '前段 {{roll::1d20}}')
  assert.match(one.middle.entries[0].content, /^中段 [甲乙丙] \d+$/)
  const sum = Number(one.middle.entries[0].content.split(' ')[2])
  assert.ok(sum >= 3 && sum <= 13)
  assert.match(one.back.entries[0].content, /^后段 \d+ 你$/)
  assert.deepEqual(resolveRuntimePresetMacros(raw, { randomSeed: 'seed-1' }).snapshot.back, one.back, '同一种子结果一致')
  const backs = new Set(['a', 'b', 'c', 'd', 'e'].map(seed => resolveRuntimePresetMacros(raw, { randomSeed: seed }).snapshot.back.entries[0].content))
  assert.ok(backs.size > 1, '不同种子重新抽取')
  assert.equal(resolveRuntimePresetMacros(raw).snapshot.back.entries[0].content, '后段 {{roll::1d1000}} 你', '没有种子时不展开')
})
