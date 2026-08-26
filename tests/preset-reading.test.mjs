import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectPreset, nativeRegexScriptsOf } from '../tavern-plugin/lib/domain/preset-reading.js'

test('按 SillyTavern prompt_order 还原条目顺序和启用状态', () => {
  const result = inspectPreset(JSON.stringify({
    temperature: 1.1,
    prompts: [
      { identifier: 'main', name: '主提示词', role: 'system', content: '保持角色一致。', enabled: false, forbid_overrides: true },
      { identifier: 'charDescription', name: 'Persona Description', role: 'user', marker: true, content: '' },
      { identifier: 'extra', name: '未编排条目', role: 'assistant', content: '补充内容', enabled: true }
    ],
    prompt_order: [{
      character_id: 100001,
      order: [
        { identifier: 'charDescription', enabled: true },
        { identifier: 'main', enabled: true }
      ]
    }]
  }), '测试预设.json')

  assert.equal(result.valid, true)
  assert.equal(result.recognized, true)
  assert.equal(result.title, '测试预设')
  assert.equal(result.promptCount, 3)
  assert.equal(result.enabledCount, 3)
  assert.deepEqual(result.entries.map(function (entry) { return entry.identifier }), ['charDescription', 'main', 'extra'])
  assert.equal(result.entries[0].marker, true)
  assert.equal(result.entries[0].enabled, true)
  assert.equal(result.entries[1].enabled, true)
  assert.equal(result.entries[1].forbidOverrides, true)
  assert.equal(result.entries[2].ordered, false)
  assert.deepEqual(result.entries[1].edit, {
    promptPath: '/prompts/0',
    enabledPaths: ['/prompts/0/enabled', '/prompt_order/0/order/1/enabled']
  })
  assert.deepEqual(result.entries[2].edit, {
    promptPath: '/prompts/2',
    enabledPaths: ['/prompts/2/enabled']
  })
})

test('兼容缺少 prompt_order 和合法但未知的 JSON', () => {
  const unordered = inspectPreset(JSON.stringify({ prompts: [{ name: '单条', content: '正文' }] }), '无顺序.json')
  assert.equal(unordered.recognized, true)
  assert.equal(unordered.entries.length, 1)
  assert.equal(unordered.entries[0].identifier, 'prompt-1')
  assert.equal(unordered.entries[0].entryKey, 'prompt-1#1')
  assert.equal(unordered.entries[0].injectable, true)
  assert.equal(unordered.entries[0].role, 'system')

  const unknown = inspectPreset('{"custom_format":true}', '其他预设.json')
  assert.equal(unknown.valid, true)
  assert.equal(unknown.recognized, false)
  assert.deepEqual(unknown.rootKeys, ['custom_format'])
  assert.match(unknown.warning, /尚未识别/)
})

test('重复 identifier 获得稳定且互不冲突的条目标识', () => {
  const result = inspectPreset(JSON.stringify({
    prompts: [
      { identifier: 'same', content: '第一条' },
      { identifier: 'same', content: '第二条' },
      { identifier: 'placeholder', marker: true, content: '' }
    ]
  }), '重复标识.json')

  assert.deepEqual(result.entries.map(function (entry) { return entry.entryKey }), ['same#1', 'same#2', 'placeholder#1'])
  assert.deepEqual(result.entries.map(function (entry) { return entry.injectable }), [true, true, false])
})

test('只有 prompt_order 的占位条目只开放开关状态', () => {
  const result = inspectPreset(JSON.stringify({ prompts: [], prompt_order: [{ order: [{ identifier: 'missing', enabled: true }] }] }))

  assert.deepEqual(result.entries[0].edit, {
    promptPath: null,
    enabledPaths: ['/prompt_order/0/order/0/enabled']
  })
})

test('损坏 JSON 返回可展示错误而不抛出解析异常', () => {
  const result = inspectPreset('{bad json', '损坏.json')
  assert.equal(result.valid, false)
  assert.equal(result.recognized, false)
  assert.match(result.error, /JSON/)
})

test('读取 SPreset RegexBinding 正则脚本及其运行条件', () => {
  const result = inspectPreset(JSON.stringify({
    prompts: [],
    extensions: {
      SPreset: {
        RegexBinding: {
          regexes: [{
            id: 'regex-1',
            scriptName: '折叠摘要',
            findRegex: '/<summary>([\\s\\S]*?)<\\/summary>/gi',
            replaceString: '<details>$1</details>',
            trimStrings: ['trim-me'],
            placement: [1, 2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0,
            minDepth: 2,
            maxDepth: 10
          }]
        }
      }
    }
  }), '带正则预设.json')

  assert.equal(result.regexCount, 1)
  assert.equal(result.enabledRegexCount, 1)
  assert.deepEqual(result.regexScripts, [{
    id: 'regex-1',
    name: '折叠摘要',
    findRegex: '/<summary>([\\s\\S]*?)<\\/summary>/gi',
    replaceString: '<details>$1</details>',
    trimStrings: ['trim-me'],
    placement: [1, 2],
    enabled: true,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    minDepth: 2,
    maxDepth: 10
  }])
})

test('兼容运行时单独读取原生 regex_scripts，不采用 SPreset 编辑器副本', () => {
  const document = {
    extensions: {
      regex_scripts: [{ id: 'native', scriptName: '原生', findRegex: 'x', replaceString: 'y' }],
      SPreset: { RegexBinding: { regexes: [
        { id: 'copy-1', scriptName: '编辑器副本一', findRegex: 'x', replaceString: 'a' },
        { id: 'copy-2', scriptName: '编辑器副本二', findRegex: 'x', replaceString: 'b' }
      ] } }
    }
  }
  const runtime = nativeRegexScriptsOf(document)
  const editor = inspectPreset(JSON.stringify(Object.assign({ prompts: [] }, document)), '双份正则.json')

  assert.deepEqual(runtime.map(function (script) { return script.id }), ['native'])
  assert.deepEqual(editor.regexScripts.map(function (script) { return script.id }), ['copy-1', 'copy-2'])
})
