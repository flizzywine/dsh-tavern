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
        const base = '/extensions/regex_scripts/' + index
        return { regexKey: String(script.id || 'regex-' + (index + 1)) + '#1', edit: {
          scriptNamePath: base + '/scriptName',
          findRegexPath: base + '/findRegex',
          replaceStringPath: base + '/replaceString',
          disabledPath: base + '/disabled'
        } }
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

 test('同一预设的并发条目和原文修改都保留，失败修改不阻塞后续保存', async () => {
  const run = harness({ prompts: [{ identifier: 'a', content: 'old A' }, { identifier: 'b', content: 'old B' }] })
  const results = await Promise.allSettled([
    run.editor.updateEntry('presets/test.json', 'a#1', { content: 'NEW A' }),
    run.editor.updateEntry('presets/test.json', 'b#1', { unknown: true }),
    run.editor.update('presets/test.json', [{ op: 'set', path: '/prompts/1/content', value: 'NEW B' }])
  ])
  assert.deepEqual(results.map(row => row.status), ['fulfilled', 'rejected', 'fulfilled'])
  assert.deepEqual(run.document().prompts.map(row => row.content), ['NEW A', 'NEW B'])
})

 test('同一预设的并发条目和原文修改都保留，失败修改不阻塞后续保存', async () => {
  const run = harness({ prompts: [{ identifier: 'a', content: 'old A' }, { identifier: 'b', content: 'old B' }] })
  const results = await Promise.allSettled([
    run.editor.updateEntry('presets/test.json', 'a#1', { content: 'NEW A' }),
    run.editor.updateEntry('presets/test.json', 'b#1', { unknown: true }),
    run.editor.update('presets/test.json', [{ op: 'set', path: '/prompts/1/content', value: 'NEW B' }])
  ])
  assert.deepEqual(results.map(row => row.status), ['fulfilled', 'rejected', 'fulfilled'])
  assert.deepEqual(run.document().prompts.map(row => row.content), ['NEW A', 'NEW B'])
})
