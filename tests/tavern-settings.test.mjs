import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

import { applyTavernSettingsPatch, presentTavernSettings, resolveSystemPrompt } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { SYSTEM_PROMPT_NAMES, prompt } from '../tavern-plugin/lib/prompt-catalog.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'

const emptyStyle = { themeVariables: {}, customCss: '', extensionStyles: [] }
const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
const clientSource = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

// Exercise the real save/read call sites, including post-save cache warming.
async function settingsHarness(t, warm = async () => []) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'tavern-settings-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profileData = createProfileDataStore({ dataRoot: root })
  const warnings = []
  const context = {
    profileData, settingsPath: 'tavern-settings.json', tavernSettingsDocument: undefined,
    applyTavernSettingsPatch, presentTavernSettings,
    promptDefaults: () => ({ story: '默认正文' }), tavernStaticResources: { warm },
    console: { warn: (...args) => warnings.push(args) }
  }
  const start = serverSource.indexOf('async function readTavernSettings()')
  assert.ok(start >= 0)
  vm.runInNewContext(serverSource.slice(start, serverSource.indexOf('\n  function runtimePrompt', start)) +
    '; this.read = readTavernSettings; this.update = updateTavernSettings;', context)
  return { ...context, warnings, saved: () => profileData.readJson(context.settingsPath) }
}

test('缺失或旧版设置返回完整安全默认值，不修改原始文档', () => {
  for (const document of [undefined, null, {}, { styleEnvironment: null }]) {
    const before = JSON.stringify(document)
    const result = presentTavernSettings(document, {})
    assert.equal(result.compatibilityMode, false)
    assert.equal(result.trustedCardMode, true)
    assert.deepEqual(result.styleEnvironment, emptyStyle)
    assert.equal(JSON.stringify(document), before)
  }
})

test('受信任模式及样式设置可保存读取，局部修改保留其他设置', () => {
  const initial = { unknown: { keep: true }, compatibilityMode: true, promptOverrides: { story: '自定义' } }
  const before = JSON.stringify(initial)
  const saved = applyTavernSettingsPatch(initial, { trustedCardMode: false, styleEnvironment: {
    themeVariables: { '--color': 'red', invalid: 'drop' }, customCss: '.test {}',
    extensionStyles: ['https://example.com/test.css', 'http://example.com/no.css', 'https://example.com/test.css']
  } })
  assert.equal(JSON.stringify(initial), before)
  assert.equal(saved.trustedCardMode, false)
  assert.deepEqual(saved.styleEnvironment, {
    themeVariables: { '--color': 'red' }, customCss: '.test {}', extensionStyles: ['https://example.com/test.css']
  })
  const toggled = applyTavernSettingsPatch(saved, { compatibilityMode: false })
  assert.deepEqual(toggled, { ...saved, compatibilityMode: false })
  assert.equal(presentTavernSettings(toggled, {}).trustedCardMode, false)
  assert.deepEqual(presentTavernSettings(toggled, {}).styleEnvironment, saved.styleEnvironment)
  assert.equal(applyTavernSettingsPatch(saved, { trustedCardMode: true }).trustedCardMode, true)
  assert.deepEqual(applyTavernSettingsPatch(saved, { styleEnvironment: null }).styleEnvironment, emptyStyle)
})

test('真实设置保存链路关闭兼容模式成功返回，重读仍关闭', async t => {
  const warmed = []
  const harness = await settingsHarness(t, async urls => { warmed.push(urls); return [] })
  await harness.profileData.writeJson(harness.settingsPath, { compatibilityMode: true, unknown: '保留' })
  const result = await harness.update({ compatibilityMode: false })
  assert.equal(result.compatibilityMode, false)
  assert.deepEqual(result.styleEnvironment, emptyStyle)
  assert.equal((await harness.read()).compatibilityMode, false)
  assert.equal((await harness.saved()).unknown, '保留')
  assert.deepEqual(warmed, [[]])
  await harness.update({ trustedCardMode: false, styleEnvironment: { customCss: 'body {}' } })
  assert.equal((await harness.read()).trustedCardMode, false)
  assert.equal((await harness.read()).styleEnvironment.customCss, 'body {}')
  for (const patch of [{ systemPrompt: { name: 'story', text: '修改正文' } },
    { systemPrompts: { story: '导入正文' } }, { resetSystemPrompts: true }]) {
    await harness.update(patch)
    assert.equal((await harness.read()).styleEnvironment.customCss, 'body {}')
    assert.equal((await harness.read()).trustedCardMode, false)
  }
})

for (const mode of ['throw', 'reject', 'pending']) {
  test(`资源预热 ${mode} 不影响设置保存和返回`, async t => {
    const harness = await settingsHarness(t, () => {
      if (mode === 'throw') throw new Error('cache unavailable')
      if (mode === 'reject') return Promise.reject(new Error('cache unavailable'))
      return new Promise(() => {})
    })
    assert.equal((await harness.update({ compatibilityMode: false })).compatibilityMode, false)
    assert.equal((await harness.saved()).compatibilityMode, false)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(harness.warnings.length, mode === 'pending' ? 0 : 1)
  })
}

test('前端开关保存后更新状态并通知侧栏；真正写入失败才显示失败', async t => {
  const harness = await settingsHarness(t)
  let state = { compatibilityMode: true, trustedCardMode: true }
  const events = []
  const context = {
    setState: updater => { state = updater(state) },
    rpc: async (_method, args) => ({ settings: await harness.update(args.patch) }),
    window: { dispatchEvent: event => events.push(event.type) },
    CustomEvent: class { constructor(type) { this.type = type } }
  }
  const start = clientSource.indexOf('async function setCompatibilityMode(enabled)')
  assert.ok(start >= 0)
  vm.runInNewContext(clientSource.slice(start, clientSource.indexOf('async function saveStyleEnvironment()', start)) +
    '; this.toggle = setCompatibilityMode; this.trust = setTrustedCardMode;', context)
  await context.toggle(false)
  assert.equal(state.error, '')
  assert.equal(state.compatibilityMode, false)
  assert.deepEqual(events, ['dsh-tavern-settings-changed', 'dsh-tavern-data-changed'])
  await context.trust(false)
  assert.equal(state.trustedCardMode, false)
  // The frozen real store is kept intact; inject a failing RPC to exercise UI recovery.
  context.rpc = async () => { throw new Error('磁盘写入失败') }
  await context.toggle(true)
  assert.equal(state.compatibilityMode, false)
  assert.equal(state.busy, false)
  assert.equal(state.error, '磁盘写入失败')
  assert.equal(events.length, 4)
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
    trustedCardMode: true,
    styleEnvironment: emptyStyle,
    systemPrompts: [{ name: 'story', text: '内置正文提示词', customized: false }],
    storyPrompt: '内置正文提示词',
    storyPromptCustomized: false
  })

  const saved = applyTavernSettingsPatch({ compatibilityMode: true, unknown: 1 }, { storyPrompt: '  用户正文提示词  ' })
  assert.equal(saved.unknown, 1)
  assert.equal(resolveSystemPrompt(saved, 'story', function () { return '默认' }), '用户正文提示词')
  assert.deepEqual(presentTavernSettings(saved, defaults), {
    compatibilityMode: true,
    trustedCardMode: true,
    styleEnvironment: emptyStyle,
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
