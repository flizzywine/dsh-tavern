import assert from 'node:assert/strict'
import test from 'node:test'

import { createPresetEditor } from '../tavern-plugin/lib/domain/preset-editor.js'

function harness(document) {
  let text = JSON.stringify(document)
  let writes = 0
  const editor = createPresetEditor({
    normalizePath: function (value, kind) {
      assert.equal(kind, 'preset')
      if (!String(value).startsWith('presets/')) throw new Error('bad path')
      return String(value)
    },
    readText: async function () { return text },
    writeText: async function (_path, next) { text = next; writes += 1 },
    inspectRegexScripts: function (_inspected, source) {
      return (source.extensions && source.extensions.regex_scripts || []).map(function (script, index) {
        return { regexKey: String(script.id || 'regex-' + (index + 1)) + '#1', edit: { disabledPath: '/extensions/regex_scripts/' + index + '/disabled' } }
      })
    }
  })
  return { editor, document: function () { return JSON.parse(text) }, writes: function () { return writes } }
}

test('预设编辑器按 JSON Pointer 分段读取并保留未知字段', async () => {
  const run = harness({ prompts: [{ identifier: 'main', content: '正文' }], extension_data: { custom: 42 } })
  const result = await run.editor.read('presets/写作.json', { pointer: '/prompts/0', limit: 1000 })

  assert.equal(result.pointer, '/prompts/0')
  assert.match(result.text, /"content": "正文"/)
  assert.equal(result.done, true)
})

test('预设编辑器只提交确认后的最小路径操作并重新校验结构', async () => {
  const run = harness({ prompts: [{ identifier: 'main', content: '旧正文' }], prompt_order: [], extension_data: { custom: 42 } })
  const result = await run.editor.update('presets/写作.json', [
    { op: 'set', path: '/prompts/0/content', value: '新正文' }
  ])

  assert.equal(run.document().prompts[0].content, '新正文')
  assert.equal(run.document().extension_data.custom, 42)
  assert.equal(run.writes(), 1)
  assert.equal(result.valid, true)
  assert.deepEqual(result.changed, ['/prompts/0/content'])
})

test('预设编辑器拒绝根节点删除和不存在的父路径', async () => {
  const run = harness({ prompts: [] })

  await assert.rejects(run.editor.update('presets/写作.json', [{ op: 'delete', path: '' }]), /根节点/)
  await assert.rejects(run.editor.update('presets/写作.json', [{ op: 'set', path: '/missing/value', value: 1 }]), /路径不存在/)
  assert.equal(run.writes(), 0)
})

test('条目表单同步修改 prompts 与 prompt_order 的默认状态', async () => {
  const run = harness({
    prompts: [{ identifier: 'main', name: '旧名称', role: 'system', content: '旧正文', enabled: true, unknown: 42 }],
    prompt_order: [{ order: [{ identifier: 'main', enabled: true }] }],
    extension_data: { custom: '保留' }
  })

  const result = await run.editor.updateEntry('presets/写作.json', 'main#1', {
    name: '新名称', role: 'assistant', content: '新正文', enabled: false
  })

  assert.deepEqual(result.changed, [
    '/prompts/0/name',
    '/prompts/0/role',
    '/prompts/0/content',
    '/prompts/0/enabled',
    '/prompt_order/0/order/0/enabled'
  ])
  assert.deepEqual(run.document(), {
    prompts: [{ identifier: 'main', name: '新名称', role: 'assistant', content: '新正文', enabled: false, unknown: 42 }],
    prompt_order: [{ order: [{ identifier: 'main', enabled: false }] }],
    extension_data: { custom: '保留' }
  })
})

test('条目表单拒绝未知字段与非法角色', async () => {
  const run = harness({ prompts: [{ identifier: 'main', content: '正文' }] })

  await assert.rejects(run.editor.updateEntry('presets/写作.json', 'main#1', { identifier: 'other' }), /不支持修改/)
  await assert.rejects(run.editor.updateEntry('presets/写作.json', 'main#1', { role: 'developer' }), /角色必须/)
  assert.equal(run.writes(), 0)
})

test('正则开关直接写回预设自身并保留其他字段', async () => {
  const run = harness({
    prompts: [],
    extensions: { regex_scripts: [{ id: 'cleanup', disabled: false, findRegex: 'x', custom: 42 }] }
  })

  const result = await run.editor.updateRegex('presets/写作.json', 'cleanup#1', false)

  assert.deepEqual(result.changed, ['/extensions/regex_scripts/0/disabled'])
  assert.equal(run.document().extensions.regex_scripts[0].disabled, true)
  assert.equal(run.document().extensions.regex_scripts[0].custom, 42)
})
