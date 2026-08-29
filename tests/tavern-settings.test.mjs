import assert from 'node:assert/strict'
import test from 'node:test'

import { applyTavernSettingsPatch, presentTavernSettings, resolveSystemPrompt } from '../tavern-plugin/lib/domain/tavern-settings.js'

test('系统正文提示词默认使用内置内容，并可保存自定义覆盖', function () {
  const defaults = { story: '内置正文提示词' }
  assert.deepEqual(presentTavernSettings({}, defaults), {
    compatibilityMode: false,
    systemPrompts: [{ name: 'story', text: '内置正文提示词', customized: false }],
    storyPrompt: '内置正文提示词',
    storyPromptCustomized: false
  })

  const saved = applyTavernSettingsPatch({ compatibilityMode: true, unknown: 1 }, { storyPrompt: '  用户正文提示词  ' })
  assert.equal(saved.unknown, 1)
  assert.equal(resolveSystemPrompt(saved, 'story', function () { return '默认' }), '用户正文提示词')
  assert.deepEqual(presentTavernSettings(saved, defaults), {
    compatibilityMode: true,
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
