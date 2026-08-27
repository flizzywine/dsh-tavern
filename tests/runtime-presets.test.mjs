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

test('首次导入沿用酒馆预设自己的条目和正则默认状态', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')

  const view = await value.module.view('presets/先导入.json')

  assert.equal(view.enabledCount, 1)
  assert.deepEqual(view.entries.map(function (entry) { return entry.runtimeEnabled }), [true, false, false])
  assert.equal(view.entries[0].enabled, true)
  assert.equal(view.entries[2].enabled, false)
  assert.equal(view.enabledRegexCount, 1)
  assert.deepEqual(view.regexScripts.map(function (script) { return [script.regexKey, script.runtimeEnabled] }), [
    ['status#1', true],
    ['status#2', false]
  ])
  await value.module.select('presets/先导入.json')
  const snapshot = await value.module.snapshot()
  assert.equal(snapshot.front.text, '第一段')
  assert.equal(snapshot.middle.text, '')
  assert.equal(snapshot.back.text, '')
  assert.equal(snapshot.regexScripts[0].regexKey, 'status#1')
})

test('整份预设快照每次读取源文件的原始启用状态，不依赖条目选择副本', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.select('presets/先导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: false })
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'b#1', enabled: true })

  let snapshot = await value.module.fullSnapshot()
  assert.equal(snapshot.presetPath, 'presets/先导入.json')
  assert.equal(snapshot.front.text, '第一段')
  assert.deepEqual(snapshot.regexScripts.map(function (script) { return script.regexKey }), ['status#1'])

  value.presets.get('presets/先导入.json').entries[0].content = '编辑后立即生效'
  value.presets.get('presets/先导入.json').entries[2].enabled = true
  snapshot = await value.module.fullSnapshot()
  assert.equal(snapshot.front.text, '编辑后立即生效\n\n第二段')
})

test('提示词只维护一套开启状态，不再叠加酒馆默认开关', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'b#1', enabled: true })
  await value.module.select('presets/先导入.json')

  const view = await value.module.view('presets/先导入.json')
  const snapshot = await value.module.snapshot()

  assert.deepEqual(view.entries.map(function (entry) { return [entry.entryKey, entry.runtimeIncluded, entry.runtimeEnabled] }), [
    ['a#1', true, true],
    ['empty#1', false, false],
    ['b#1', true, true]
  ])
  assert.equal(view.includedCount, 2)
  assert.equal(view.enabledCount, 2)
  assert.equal(snapshot.front.text, '第一段\n\n第二段')
  assert.deepEqual(snapshot.front.entries.map(function (entry) { return [entry.id, entry.role] }), [['a#1', 'system'], ['b#1', 'system']])
})

test('一次请求按前中后顺序解析酒馆宏并返回新的变量状态', () => {
  const raw = {
    text: '{{setvar::rule::校规}}{{user}}遵守{{getvar::rule}}；{{char}}在场；{{future::macro}}',
    sources: [],
    regexScripts: [],
    regexSources: [],
    digest: 'raw',
    createdAt: 1
  }

  const resolved = resolveRuntimePresetMacros(raw, {
    charName: '段莹莹',
    macroState: { userName: '陈锋', local: {}, global: {} }
  })

  assert.equal(resolved.snapshot.text, '陈锋遵守校规；段莹莹在场；{{future::macro}}')
  assert.deepEqual(resolved.macroState, { userName: '陈锋', local: { rule: '校规' }, global: {} })
  assert.notEqual(resolved.snapshot.digest, raw.digest)
  assert.equal(raw.text, '{{setvar::rule::校规}}{{user}}遵守{{getvar::rule}}；{{char}}在场；{{future::macro}}')
})

test('DSH 转换稿按前中后分别生成快照，并按顺序共享宏变量状态', async () => {
  const value = harness()
  const converted = preset('presets/三段.json', [])
  converted.dshPreset = {
    front: [{ id: 'front#1', name: '前', role: 'system', content: '{{setvar::rule::守则}}前：{{user}}', enabled: true, source: { identifier: 'front' } }],
    middle: [{ id: 'middle#1', name: '中', role: 'system', content: '中：{{getvar::rule}}', enabled: true, source: { identifier: 'middle' } }],
    back: [{ id: 'back#1', name: '后', role: 'system', content: '后：{{char}}', enabled: true, source: { identifier: 'back' } }]
  }
  value.presets.set('presets/三段.json', converted)

  await value.module.register('presets/三段.json')
  await value.module.toggle({ path: 'presets/三段.json', entryKey: 'front#1', enabled: true })
  await value.module.toggle({ path: 'presets/三段.json', entryKey: 'middle#1', enabled: true })
  await value.module.toggle({ path: 'presets/三段.json', entryKey: 'back#1', enabled: true })
  await value.module.select('presets/三段.json')
  const raw = await value.module.snapshot()
  const resolved = resolveRuntimePresetMacros(raw, {
    charName: '阿芙拉',
    macroState: { userName: '陈锋', local: {}, global: {} }
  })

  assert.equal(resolved.snapshot.front.text, '前：陈锋')
  assert.equal(resolved.snapshot.middle.text, '中：守则')
  assert.equal(resolved.snapshot.back.text, '后：阿芙拉')
  assert.deepEqual(resolved.snapshot.sources.map(function (source) { return [source.entryKey, source.phase] }), [
    ['front#1', 'front'],
    ['middle#1', 'middle'],
    ['back#1', 'back']
  ])
})

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

test('已绑定对话可按路径重新读取修改后的提示词，不受当前全局选择影响', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.register('presets/后导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.select('presets/后导入.json')

  value.presets.get('presets/先导入.json').entries[0].content = '修改后的第一段'
  const snapshot = await value.module.snapshot('presets/先导入.json')

  assert.equal(snapshot.presetPath, 'presets/先导入.json')
  assert.equal(snapshot.front.text, '修改后的第一段')
})

test('没有 prompts、只有正则的预设也能独立管理', async () => {
  const value = harness()
  const regexOnly = preset('presets/纯正则.json', [], [
    { id: 'panel', name: '面板', findRegex: '/<panel>(.*?)<\\/panel>/s', replaceString: '<aside>$1</aside>', placement: [2], enabled: true }
  ])
  regexOnly.recognized = false
  value.presets.set('presets/纯正则.json', regexOnly)

  await value.module.register('presets/纯正则.json')
  await value.module.toggleRegex({ path: 'presets/纯正则.json', regexKey: 'panel#1', enabled: true })
  await value.module.select('presets/纯正则.json')

  const view = await value.module.view('presets/纯正则.json')
  assert.equal(view.runtimeManaged, true)
  assert.equal(view.enabledRegexCount, 1)
  assert.equal((await value.module.snapshot()).regexScripts[0].name, '面板')
})

test('同一时间只启用一个预设，切换时保留各自内部勾选', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.register('presets/后导入.json')
  await value.module.toggle({ path: 'presets/后导入.json', entryKey: 'c#1', enabled: true })
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'b#1', enabled: true })
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.select('presets/后导入.json')

  assert.equal((await value.module.snapshot()).text, '第三段')

  await value.module.select('presets/先导入.json')
  const snapshot = await value.module.snapshot()

  assert.equal(snapshot.text, '第一段\n\n第二段')
  assert.deepEqual(snapshot.sources.map(function (source) { return [source.path, source.entryKey] }), [
    ['presets/先导入.json', 'a#1'],
    ['presets/先导入.json', 'b#1']
  ])
  assert.equal(typeof snapshot.digest, 'string')
  assert.ok(snapshot.digest.length > 10)
})

test('空条目不可开启，已开启条目失效时快照明确失败且不静默跳过', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await assert.rejects(
    value.module.toggle({ path: 'presets/先导入.json', entryKey: 'empty#1', enabled: true }),
    /不存在|不可注入/
  )
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.select('presets/先导入.json')
  value.presets.delete('presets/先导入.json')

  await assert.rejects(value.module.snapshot(), /预设注入失败.*先导入/)
  assert.match((await value.module.state()).lastError.message, /预设注入失败/)
})

test('关闭全部条目后清除错误并恢复为无预设快照', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.select('presets/先导入.json')
  value.presets.delete('presets/先导入.json')
  await assert.rejects(value.module.snapshot(), /预设注入失败/)
  value.presets.set('presets/先导入.json', preset('presets/先导入.json', [{ identifier: 'a', content: '第一段' }]))

  await value.module.disablePreset('presets/先导入.json')

  assert.equal(await value.module.snapshot(), null)
  assert.equal((await value.module.state()).lastError, null)
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

test('重命名和删除预设同步迁移或清除全局开关', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.select('presets/先导入.json')
  value.presets.set('presets/已改名.json', preset('presets/已改名.json', [{ identifier: 'a', content: '第一段' }], [
    { id: 'status', name: '状态栏', findRegex: '/<status>(.*?)<\\/status>/s', replaceString: '<aside>$1</aside>', placement: [2], enabled: true }
  ]))
  value.presets.delete('presets/先导入.json')

  await value.module.rename('presets/先导入.json', 'presets/已改名.json')
  assert.equal((await value.module.snapshot()).text, '第一段')
  assert.deepEqual(value.getState().presetOrder, ['presets/已改名.json'])
  assert.equal(value.getState().activePreset, 'presets/已改名.json')

  await value.module.remove('presets/已改名.json')
  assert.equal(await value.module.snapshot(), null)
  assert.deepEqual(value.getState().presetOrder, [])
  assert.equal(value.getState().activePreset, '')
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

test('重复注册已存在的预设不重写全局状态', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  const before = value.getState()
  const writes = value.getWrites()

  await value.module.register('presets/先导入.json')

  assert.deepEqual(value.getState(), before)
  assert.equal(value.getWrites(), writes)
})

test('预设配置方案保存当前勾选，并可一键恢复重复使用', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.toggleRegex({ path: 'presets/先导入.json', regexKey: 'status#1', enabled: true })
  await value.module.select('presets/先导入.json')

  const saved = await value.module.savePlan({ name: '常用配置' })
  assert.equal(saved.name, '常用配置')
  assert.equal(saved.presetPath, 'presets/先导入.json')
  assert.deepEqual(saved.entryKeys, ['a#1'])
  assert.deepEqual(saved.regexKeys, ['status#1'])
  assert.equal(saved.valid, true)

  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: false })
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'b#1', enabled: true })
  await value.module.toggleRegex({ path: 'presets/先导入.json', regexKey: 'status#1', enabled: false })
  await value.module.select('presets/后导入.json')

  const applied = await value.module.applyPlan(saved.id)
  assert.equal(applied.id, saved.id)
  assert.equal(value.getState().activePreset, 'presets/先导入.json')
  assert.deepEqual(value.getState().entries['presets/先导入.json'], { 'a#1': true })
  assert.deepEqual(value.getState().regexes['presets/先导入.json'], { 'status#1': true })
})

test('配置方案可以覆盖、重命名和删除', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.select('presets/先导入.json')
  const saved = await value.module.savePlan({ name: '旧名称' })

  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'b#1', enabled: true })
  const overwritten = await value.module.savePlan({ id: saved.id, name: saved.name })
  assert.deepEqual(overwritten.entryKeys, ['a#1', 'b#1'])

  const renamed = await value.module.renamePlan(saved.id, '新名称')
  assert.equal(renamed.name, '新名称')
  assert.deepEqual((await value.module.plans()).map(function (plan) { return plan.name }), ['新名称'])

  await value.module.removePlan(saved.id)
  assert.deepEqual(await value.module.plans(), [])
})

test('方案引用的预设内容失效时明确拒绝应用', async () => {
  const value = harness()
  await value.module.register('presets/先导入.json')
  await value.module.toggle({ path: 'presets/先导入.json', entryKey: 'a#1', enabled: true })
  await value.module.select('presets/先导入.json')
  const saved = await value.module.savePlan({ name: '待失效' })
  value.presets.set('presets/先导入.json', preset('presets/先导入.json', [{ identifier: 'b', content: '第二段' }]))

  const listed = await value.module.plans()
  assert.equal(listed[0].valid, false)
  assert.match(listed[0].error, /a#1/)
  await assert.rejects(value.module.applyPlan(saved.id), /配置方案失效.*a#1/)
})
