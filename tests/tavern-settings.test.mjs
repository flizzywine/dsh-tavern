import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { applyTavernSettingsPatch, presentTavernSettings, resolveSystemPrompt } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { SYSTEM_PROMPT_NAMES, prompt } from '../tavern-plugin/lib/prompt-catalog.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

// Exercise the real save/read call sites with durable storage, not a copied implementation.
async function settingsHarness(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-settings-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profileData = createProfileDataStore({ dataRoot: root })
  const context = {
    profileData, settingsPath: 'tavern-settings.json', tavernSettingsDocument: undefined,
    applyTavernSettingsPatch, presentTavernSettings,
    promptDefaults: () => ({ story: '默认正文' })
  }
  const start = serverSource.indexOf('async function readTavernSettings()')
  assert.ok(start >= 0)
  vm.runInNewContext(serverSource.slice(start, serverSource.indexOf('\n  function runtimePrompt', start)) +
    '; this.read = readTavernSettings; this.update = updateTavernSettings;', context)
  return { ...context, saved: () => profileData.readJson(context.settingsPath) }
}

test('新旧设置均固定信任人物卡，不再应用手动样式，也不改写原始文档', () => {
  for (const document of [undefined, null, {}, { trustedCardMode: false, styleEnvironment: {
    customCss: 'body {display:none}', extensionStyles: ['https://example.com/old.css']
  } }]) {
    const before = JSON.stringify(document)
    const result = presentTavernSettings(document, {})
    assert.equal(result.compatibilityMode, false)
    assert.equal(result.trustedCardMode, true)
    assert.equal(Object.hasOwn(result, 'styleEnvironment'), false)
    assert.equal(JSON.stringify(document), before)
  }
})

test('旧客户端的信任和样式修改不再生效，其他未知设置仍保留', () => {
  const initial = { unknown: { keep: true }, compatibilityMode: true, promptOverrides: { story: '自定义' } }
  const saved = applyTavernSettingsPatch(initial, { trustedCardMode: false, styleEnvironment: { customCss: 'body {}' } })
  assert.deepEqual(saved, initial)
  assert.deepEqual(applyTavernSettingsPatch(saved, { compatibilityMode: false }), { ...initial, compatibilityMode: false })
  assert.equal(presentTavernSettings(saved, {}).trustedCardMode, true)
})

test('联网搜索作为新游戏默认值持久化，默认关闭', () => {
  assert.equal(presentTavernSettings({}, {}).webSearchEnabled, false)
  const enabled = applyTavernSettingsPatch({ unknown: '保留' }, { webSearchEnabled: true })
  assert.equal(enabled.webSearchEnabled, true)
  assert.equal(enabled.unknown, '保留')
  assert.equal(presentTavernSettings(enabled, {}).webSearchEnabled, true)
  assert.equal(applyTavernSettingsPatch(enabled, { webSearchEnabled: false }).webSearchEnabled, false)
})

test('后台模型可以固定为独立 provider/model，也可以恢复为开局跟随前台', () => {
  assert.equal(presentTavernSettings({}, {}).backgroundModel, null)
  const fixed = applyTavernSettingsPatch({ unknown: true }, { backgroundModel: { provider: 'vertex', model: 'gemini-2.5-pro' } })
  assert.deepEqual(fixed.backgroundModel, { provider: 'vertex', model: 'gemini-2.5-pro' })
  assert.equal(fixed.unknown, true)
  assert.deepEqual(presentTavernSettings(fixed, {}).backgroundModel, { provider: 'vertex', model: 'gemini-2.5-pro' })
  assert.equal(applyTavernSettingsPatch(fixed, { backgroundModel: null }).backgroundModel, undefined)
  assert.throws(() => applyTavernSettingsPatch({}, { backgroundModel: { provider: '', model: 'x' } }), /配置无效/)
})

test('真实设置保存链路关闭兼容模式成功返回，旧关闭信任值不影响运行', async t => {
  const harness = await settingsHarness(t)
  await harness.profileData.writeJson(harness.settingsPath, {
    compatibilityMode: true, trustedCardMode: false, styleEnvironment: { customCss: 'body {}' }, unknown: '保留'
  })
  const result = await harness.update({ compatibilityMode: false })
  assert.equal(result.compatibilityMode, false)
  assert.equal(result.trustedCardMode, true)
  assert.equal(Object.hasOwn(result, 'styleEnvironment'), false)
  assert.equal((await harness.read()).compatibilityMode, false)
  // Retain legacy data on disk without letting it control the current runtime.
  assert.equal((await harness.saved()).unknown, '保留')
  assert.equal((await harness.saved()).trustedCardMode, false)
  for (const patch of [{ systemPrompt: { name: 'story', text: '修改正文' } },
    { systemPrompts: { story: '导入正文' } }, { resetSystemPrompts: true }]) {
    await harness.update(patch)
    assert.equal((await harness.read()).trustedCardMode, true)
    assert.equal(Object.hasOwn(await harness.read(), 'styleEnvironment'), false)
  }
})

test('设置界面只提供联网搜索与后台模型选择，不渲染兼容模式和旧样式选项', () => {
  const context = { SceneImageSettings: function SceneImageSettings() {}, React: {
    useState: initial => [initial, () => {}],
    useEffect() {},
    createElement: (type, props, ...children) => ({ type, props, children })
  } }
  const start = clientSource.indexOf('function TavernSettingsSection()')
  vm.runInNewContext(clientSource.slice(start, clientSource.indexOf('function SystemPromptSidebarTab()', start)) +
    '; this.render = TavernSettingsSection;', context)
  const root = context.render()
  const nodes = []
  function visit(node) {
    if (!node || typeof node !== 'object') return
    nodes.push(node)
    for (const child of node.children || []) visit(child)
  }
  visit(root)
  const inputs = nodes.filter(node => node.type === 'input')
  assert.deepEqual(inputs.map(input => input.props['aria-label']), ['开启联网搜索'])
  const select = nodes.find(node => node.type === 'select' && node.props['aria-label'] === '后台模型')
  assert.ok(select)
  assert.match(JSON.stringify(select), /跟随前台（开局时）/)
  assert.equal(nodes.some(node => node.type === 'textarea' || node.type === 'details'), false)
  assert.doesNotMatch(JSON.stringify(root), /兼容模式|受信任人物卡模式|SillyTavern 样式环境|Custom CSS/)
})

test('联网搜索开关保存为以后新游戏的默认值', async t => {
  const harness = await settingsHarness(t)
  let state = { webSearchEnabled: false }
  const events = []
  const context = {
    setState: updater => { state = updater(state) },
    rpc: async (_method, args) => ({ settings: await harness.update(args.patch) }),
    window: { dispatchEvent: event => events.push(event.type) },
    CustomEvent: class { constructor(type) { this.type = type } }
  }
  const start = clientSource.indexOf('async function setWebSearchEnabled(enabled)')
  assert.ok(start >= 0)
  vm.runInNewContext(clientSource.slice(start, clientSource.indexOf('\n\t\t\treturn React.createElement', start)) +
    '; this.toggle = setWebSearchEnabled;', context)
  await context.toggle(true)
  assert.equal(state.webSearchEnabled, true)
  assert.equal((await harness.read()).webSearchEnabled, true)
  assert.deepEqual(events, ['dsh-tavern-settings-changed', 'dsh-tavern-data-changed'])
})

test('后台模型选择保存为以后新游戏的默认值', async t => {
  const harness = await settingsHarness(t)
  let state = { backgroundModel: null }
  const events = []
  const context = {
    setState: updater => { state = updater(state) },
    rpc: async (_method, args) => ({ settings: await harness.update(args.patch) }),
    window: { dispatchEvent: event => events.push(event.type) },
    CustomEvent: class { constructor(type) { this.type = type } }
  }
  const start = clientSource.indexOf('async function setBackgroundModel(value)')
  assert.ok(start >= 0)
  vm.runInNewContext(clientSource.slice(start, clientSource.indexOf('\n\t\t\treturn React.createElement', start)) +
    '; this.choose = setBackgroundModel;', context)
  await context.choose(JSON.stringify({ provider: 'worker', model: 'stable' }))
  assert.deepEqual(state.backgroundModel, { provider: 'worker', model: 'stable' })
  assert.deepEqual((await harness.read()).backgroundModel, { provider: 'worker', model: 'stable' })
  await context.choose('')
  assert.equal(state.backgroundModel, null)
  assert.equal((await harness.read()).backgroundModel, null)
  assert.deepEqual(events, ['dsh-tavern-settings-changed', 'dsh-tavern-data-changed', 'dsh-tavern-settings-changed', 'dsh-tavern-data-changed'])
})

test('后台对话框以只读标签显示实际模型，不替换前台模型选择器', () => {
  const context = {}
  const start = clientSource.indexOf('function backgroundModelLabel(selection, catalog)')
  assert.ok(start >= 0)
  vm.runInNewContext(clientSource.slice(start, clientSource.indexOf('\n\t\tfunction TavernBackgroundModelLabel', start)) +
    '; this.label = backgroundModelLabel;', context)
  assert.equal(context.label({ provider: 'vertex', model: 'gemini-flash' }, [{
    provider: 'vertex', providerName: 'Google', models: [{ id: 'gemini-flash', name: 'Gemini Flash' }]
  }]), 'Google: Gemini Flash')
  assert.equal(context.label({ provider: 'custom', model: 'local-model' }, []), 'custom: local-model')
  assert.match(clientSource, /slots\.inject\("conversation\.input\.right"[\s\S]*?id: "dsh-tavern-background-model"/)
  assert.match(clientSource, /identity\.label === "酒馆后台 Agent"/)
  assert.match(clientSource, /className: "dsh-tavern-background-model"/)
  assert.doesNotMatch(clientSource.slice(clientSource.indexOf('function TavernBackgroundModelLabel'), clientSource.indexOf('function TavernSettingsSection')), /React\.createElement\("button"/)
})

test('旧开启设置无效，接口拒绝重新开启，重新读取仍关闭且保留原始数据', async t => {
  const harness = await settingsHarness(t)
  const legacy = { compatibilityMode: true, unknown: '保留' }
  await harness.profileData.writeJson(harness.settingsPath, legacy)
  assert.equal((await harness.read()).compatibilityMode, false)
  await assert.rejects(harness.update({ compatibilityMode: true }), /兼容模式已停用/)
  assert.equal((await harness.read()).compatibilityMode, false)
  assert.deepEqual(await harness.saved(), legacy)
  assert.equal(presentTavernSettings(await harness.saved(), {}).compatibilityMode, false)
  assert.doesNotMatch(clientSource, /启用兼容模式|新开兼容对话|兼容（实验性）|什么是兼容模式/)
})

test('旧 play-mode 覆盖保留在数据中，但不再出现在可用提示词列表', () => {
  const saved = { promptOverrides: { 'play-mode': '旧游玩指令', story: '自定义正文规则' } }
  const before = JSON.stringify(saved)
  const defaults = Object.fromEntries(SYSTEM_PROMPT_NAMES.map(name => [name, prompt(name)]))
  const presented = presentTavernSettings(saved, defaults)
  assert.ok(!presented.systemPrompts.some(item => item.name === 'play-mode'))
  assert.equal(presented.storyPrompt, '自定义正文规则')
  assert.equal(JSON.stringify(saved), before)
})

test('系统正文提示词默认使用内置内容，并可保存自定义覆盖', function () {
  const defaults = { story: '内置正文提示词' }
  assert.deepEqual(presentTavernSettings({}, defaults), {
    compatibilityMode: false,
    webSearchEnabled: false,
    backgroundModel: null,
    trustedCardMode: true,
    systemPrompts: [{ name: 'story', text: '内置正文提示词', customized: false }],
    storyPrompt: '内置正文提示词',
    storyPromptCustomized: false
  })

  const saved = applyTavernSettingsPatch({ compatibilityMode: true, unknown: 1 }, { storyPrompt: '  用户正文提示词  ' })
  assert.equal(saved.unknown, 1)
  assert.equal(resolveSystemPrompt(saved, 'story', function () { return '默认' }), '用户正文提示词')
  assert.deepEqual(presentTavernSettings(saved, defaults), {
    compatibilityMode: false,
    webSearchEnabled: false,
    backgroundModel: null,
    trustedCardMode: true,
    systemPrompts: [{ name: 'story', text: '用户正文提示词', customized: true }],
    storyPrompt: '用户正文提示词',
    storyPromptCustomized: true
  })
})

test('恢复默认只删除正文覆盖并保留其他设置', function () {
  const saved = applyTavernSettingsPatch({
    compatibilityMode: true,
    promptOverrides: { story: '用户正文提示词', future: '保留' }
  }, { storyPrompt: null })

  assert.deepEqual(saved, {
    compatibilityMode: true,
    promptOverrides: { future: '保留' }
  })
  assert.equal(resolveSystemPrompt(saved, 'story', function (name) { return '默认:' + name }), '默认:story')
})

test('拒绝空白正文提示词', function () {
  assert.throws(function () {
    applyTavernSettingsPatch({}, { storyPrompt: '   ' })
  }, /不能为空/)
})

test('整套系统提示词可以导入覆盖并整体恢复默认', function () {
  const saved = applyTavernSettingsPatch({ compatibilityMode: true, unknown: 1 }, {
    systemPrompts: { story: '新正文', 'play-mode': '新游玩规则' }
  })
  assert.equal(resolveSystemPrompt(saved, 'story', function () { return '默认正文' }), '新正文')
  assert.equal(resolveSystemPrompt(saved, 'play-mode', function () { return '默认游玩' }), '新游玩规则')
  assert.equal(saved.unknown, 1)

  const reset = applyTavernSettingsPatch(saved, { resetSystemPrompts: ['story', 'play-mode'] })
  assert.equal(reset.promptOverrides, undefined)
  assert.equal(reset.compatibilityMode, true)
  assert.equal(reset.unknown, 1)
})

test('单项系统提示词保存和恢复不会影响其他项', function () {
  const saved = applyTavernSettingsPatch({ promptOverrides: { story: '正文', future: '保留' } }, {
    systemPrompt: { name: 'play-mode', text: '游玩规则' }
  })
  assert.deepEqual(saved.promptOverrides, { story: '正文', future: '保留', 'play-mode': '游玩规则' })
  const restored = applyTavernSettingsPatch(saved, { systemPrompt: { name: 'play-mode', text: null } })
  assert.deepEqual(restored.promptOverrides, { story: '正文', future: '保留' })
})
