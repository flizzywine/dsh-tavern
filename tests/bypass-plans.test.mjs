import assert from 'node:assert/strict'
import test from 'node:test'

import { createBypassPlanModule } from '../tavern-plugin/lib/domain/bypass-plans.js'

function harness() {
  const presets = new Map([['presets/demo.json', {
    valid: true,
    recognized: true,
    title: '外部演示',
    entries: [
      { entryKey: 'main#1', identifier: 'main', name: '主提示词', role: 'system', content: '破限正文', enabled: true, ordered: true, injectable: true },
      { entryKey: 'chatHistory#1', identifier: 'chatHistory', name: '历史', role: 'system', content: '', enabled: true, ordered: true, injectable: false, marker: true },
      { entryKey: 'tail#1', identifier: 'tail', name: '尾部', role: 'assistant', content: '尾部指令', enabled: false, ordered: true, injectable: true }
    ],
    dshPreset: {
      front: [{ id: 'main#1' }], middle: [], back: [{ id: 'tail#1' }]
    },
    regexScripts: []
  }]])
  const documents = new Map([['presets/demo.json', {
    personality_format: '性格：{{personality}}',
    prompts: [{ identifier: 'main' }],
    prompt_order: [],
    extensions: { regex_scripts: [
      { id: 'panel', scriptName: '面板', findRegex: '/<panel>(.*?)<\\/panel>/s', replaceString: '<aside>$1</aside>', disabled: false },
      { id: 'hidden', scriptName: '默认关闭', findRegex: '/x/g', replaceString: 'y', disabled: true }
    ] }
  }]])
  let state
  let clock = 100
  const module = createBypassPlanModule({
    readPreset: async function (path) { return presets.get(path) },
    readPresetDocument: async function (path) { return documents.get(path) },
    runtimeRegexScripts: function (_preset, document) {
      return document.extensions.regex_scripts.map(function (script, index) {
        return {
          regexKey: script.id + '#1', id: script.id, name: script.scriptName,
          findRegex: script.findRegex, replaceString: script.replaceString,
          enabled: script.disabled !== true, placement: [2]
        }
      })
    },
    readState: async function () { return state === undefined ? undefined : structuredClone(state) },
    updateState: async function (updater) {
      const next = await updater(state === undefined ? undefined : structuredClone(state))
      if (next !== undefined) state = structuredClone(next)
      return structuredClone(state)
    },
    now: function () { return clock++ }
  })
  return { module, presets, documents, getState: function () { return structuredClone(state) } }
}

test('从外部预设抽取自包含方案，正则默认完整迁移并继承原状态', async function () {
  const value = harness()
  const plan = await value.module.extract({ sourcePresetPath: 'presets/demo.json', name: '演示破限', entryKeys: ['main#1'] })

  assert.equal(plan.name, '演示破限')
  assert.deepEqual(plan.entries.map(function (entry) { return [entry.entryKey, entry.enabled, entry.systemManaged, entry.phase] }), [
    ['main#1', true, false, 'front'],
    ['chatHistory#1', true, true, 'front']
  ])
  assert.deepEqual(plan.regexScripts.map(function (script) { return [script.regexKey, script.enabled] }), [
    ['panel#1', true],
    ['hidden#1', false]
  ])
  assert.deepEqual(plan.compatibilitySettings, { personality_format: '性格：{{personality}}' })
  assert.equal(plan.enabledCount, 1)
  assert.equal(plan.enabledRegexCount, 1)
})

test('删除来源外部预设后方案仍可激活、生成投影和读取正则', async function () {
  const value = harness()
  const plan = await value.module.extract({ sourcePresetPath: 'presets/demo.json', name: '独立方案', entryKeys: ['main#1', 'tail#1'] })
  await value.module.activate(plan.id)
  value.presets.delete('presets/demo.json')
  value.documents.delete('presets/demo.json')

  const snapshot = await value.module.snapshot()
  assert.equal(snapshot.planId, plan.id)
  assert.equal(snapshot.front.text, '破限正文')
  assert.equal(snapshot.back.text, '尾部指令')
  assert.deepEqual((await value.module.regexScriptsFor(plan.id)).map(function (script) { return script.regexKey }), ['panel#1'])
})

test('方案条目和正则可以独立开关，来源预设不被修改', async function () {
  const value = harness()
  const plan = await value.module.extract({ sourcePresetPath: 'presets/demo.json', name: '可编辑方案', entryKeys: ['main#1', 'tail#1'] })
  await value.module.activate(plan.id)
  await value.module.toggleEntry({ id: plan.id, entryKey: 'tail#1', enabled: false })
  await value.module.toggleRegex({ id: plan.id, regexKey: 'hidden#1', enabled: true })

  const snapshot = await value.module.snapshot()
  assert.equal(snapshot.back.text, '')
  assert.deepEqual(snapshot.regexScripts.map(function (script) { return script.regexKey }), ['panel#1', 'hidden#1'])
  assert.equal(value.presets.get('presets/demo.json').entries[2].enabled, false)
})

test('删除激活方案会恢复为不使用破限方案', async function () {
  const value = harness()
  const plan = await value.module.extract({ sourcePresetPath: 'presets/demo.json', name: '临时方案', entryKeys: ['main#1'] })
  await value.module.activate(plan.id)
  await value.module.remove(plan.id)

  assert.equal((await value.module.state()).activePlanId, '')
  assert.equal(await value.module.snapshot(), null)
})

test('可以从旧对话快照导入不依赖来源文件的迁移方案', async function () {
  const value = harness()
  const plan = await value.module.importPlan({
    name: '旧对话迁移',
    source: { presetName: '已删除来源', presetPath: 'presets/missing.json', presetDigest: '' },
    entries: [{ entryKey: 'legacy#1', identifier: 'legacy', name: '旧提示词', role: 'system', content: '保留下来', enabled: true, phase: 'front', injectable: true }],
    regexScripts: [{ regexKey: 'legacy-regex#1', id: 'legacy-regex', name: '旧正则', findRegex: '/x/g', replaceString: 'y', enabled: true }]
  })
  value.presets.clear(); value.documents.clear()

  assert.equal((await value.module.snapshot(plan.id)).front.text, '保留下来')
  assert.equal((await value.module.regexScriptsFor(plan.id))[0].name, '旧正则')
})
