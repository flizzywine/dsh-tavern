import assert from 'node:assert/strict'
import test from 'node:test'

import { editableReplyParts, projectReplyLayers } from "../tavern-plugin/lib/domain/reply-presentation.js"

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
  '<initvar><initvar>secret</initvar>secret</initvar>',
  '<Variables>{"version":1}</Variables>',
  '<update_variable>{"op":"replace"}</update_variable>',
  '<jsonpatch>[{"op":"replace"}]</jsonpatch>',
  '<mvu_update>{"hp":1}</mvu_update>',
  '<ta_hub>{"version":1,"source":"preset fallback"}</ta_hub>'
]) test('变量控制块不作为正文展示：' + block.split('>')[0], () => {
  const source = '之前\r\n' + block + '\r\n之后'
  const result = projectReplyLayers(source)
  assert.equal(result.sourceText, source)
  assert.equal(result.sessionText, source)
  assert.deepEqual(result.displayParts, [{ kind: 'markdown', text: '之前\r\n' }, { kind: 'markdown', text: '\r\n之后' }])
  assert.equal(editableReplyParts(source).map(part => part.text).join(''), source)
})

// 剥离标记块的正则吃掉 `</thinking>` 之后，整条回复曾被当作未闭合的隐藏协议连正文一起吞掉。
test('未闭合的思考标签只隐藏标签本身，正文照常显示', () => {
  const source = '\n<thinking>\n规划：先置入三个标记块再衔接正文\n客厅里死寂得只剩下布料摩挲的细碎声响。\n'
  const result = projectReplyLayers(source)
  assert.equal(result.sourceText, source)
  const shown = result.displayParts.map(part => part.text || part.content || '').join('')
  assert.match(shown, /客厅里死寂/)
  assert.ok(!shown.includes('<thinking>'))
})
