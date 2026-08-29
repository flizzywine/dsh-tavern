import assert from 'node:assert/strict'
import test from 'node:test'

import { applyTavernSettingsPatch, presentTavernSettings, resolveSystemPrompt } from '../tavern-plugin/lib/domain/tavern-settings.js'

test('系统正文提示词默认使用内置内容，并可保存自定义覆盖', function () {
  const defaults = { story: '内置正文提示词' }
  assert.deepEqual(presentTavernSettings({}, defaults), {
    compatibilityMode: false,
    storyPrompt: '内置正文提示词',
    storyPromptCustomized: false
  })

  const saved = applyTavernSettingsPatch({ compatibilityMode: true, unknown: 1 }, { storyPrompt: '  用户正文提示词  ' })
  assert.equal(saved.unknown, 1)
  assert.equal(resolveSystemPrompt(saved, 'story', function () { return '默认' }), '用户正文提示词')
  assert.deepEqual(presentTavernSettings(saved, defaults), {
    compatibilityMode: true,
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
