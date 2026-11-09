import assert from 'node:assert/strict'
import test from 'node:test'

import { projectReplyLayers, projectProcessedReply, createReplyHistoryProjector } from "../tavern-plugin/lib/domain/reply-presentation.js"

test('refresh preserves provider-processed prose without running the active preset regex again', () => {
  const project = createReplyHistoryProjector()
  const message = { role: 'assistant', turn: 2, sourceText: '已处理正文', projectionText: '已处理正文', bodyRegenerationProcessed: true }
  const options = { regexScripts: [{ id: 'twice', findRegex: '/正文/g', replaceString: '正文正文', placement: [2], markdownOnly: true }] }
  assert.equal(project([message], options).projections[0].text, '已处理正文')
  assert.equal(project([message], options).projections[0].text, '已处理正文')
})

test('provider-final reply uses matching template formatting without replaying the preset regex', () => {
  const project = createReplyHistoryProjector()
  const sourceText = '正文\n<options>\n<option>继续</option>\n</options>'
  const formattingText = '正文\n```html\n<section class="options">已转换选项</section>\n```'
  const message = {
    role: 'assistant', turn: 2, sourceText, projectionText: sourceText, bodyRegenerationProcessed: true,
    tavernPluginData: { template_display: { source: sourceText, swipe: 0, formattingText } }
  }
  const options = { regexScripts: [{ id: 'twice', findRegex: '/正文/g', replaceString: '正文正文', placement: [2], markdownOnly: true }] }
  const projection = project([message], options).projections[0]
  assert.equal(projection.text, formattingText)
  assert.ok(projection.parts.some(part => part.kind === 'html' && part.content.includes('已转换选项')))
  assert.doesNotMatch(projection.text, /正文正文/)
})

test('provider final output keeps HTML templates and identity/state macros literal', () => {
  const text = '  <div>{{ item.name }} {{user}}</div>\n{{setvar::x::changed}}\n<user>\n'
  const projected = projectProcessedReply(text)
  for (const field of ['sourceText', 'projectionText', 'sessionText', 'displayText']) assert.equal(projected[field], text)
  assert.equal(projected.displayMode, 'html')
})

function script(name, findRegex, replaceString, flags = {}) {
  return {
    id: name,
    name,
    findRegex,
    replaceString,
    trimStrings: [],
    placement: [2],
    enabled: true,
    markdownOnly: flags.markdownOnly === true,
    promptOnly: flags.promptOnly === true,
    runOnEdit: false,
    minDepth: null,
    maxDepth: null
  }
}

test('损坏规则只产生目标诊断，后续规则继续执行', () => {
  const result = projectReplyLayers('进入校园', {
    regexScripts: [
      script('损坏规则', '/[/', '坏'),
      script('可用规则', '校园', '学院')
    ],
    placement: 2
  })

  assert.equal(result.sessionText, '进入学院')
  assert.equal(result.displayText, '进入学院')
  assert.match(result.warnings.join('\n'), /Session：损坏规则/)
  assert.match(result.warnings.join('\n'), /展示：损坏规则/)
})

for (const block of [
  '<UpdateVariable>secret</UpdateVariable>',
  '<INITVAR>secret\r\nsecond</INITVAR>',
  '<initvar format="yaml">secret</initvar>',
  '<UpdateVariable><initvar>secret</initvar></UpdateVariable>',
  '<initvar><initvar>secret</initvar>secret</initvar>'
]) test('变量控制块不作为正文展示：' + block.split('>')[0], () => {
  const source = '之前\r\n' + block + '\r\n之后'
  const result = projectReplyLayers(source)
  assert.equal(result.sourceText, source)
  assert.equal(result.sessionText, source)
  assert.deepEqual(result.displayParts, [{ kind: 'markdown', text: '之前\r\n' }, { kind: 'markdown', text: '\r\n之后' }])
})
