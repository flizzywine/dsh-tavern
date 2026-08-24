import assert from 'node:assert/strict'
import test from 'node:test'

import { displayModeOf, projectReplyHistory, projectReplyLayers } from '../tavern-plugin/lib/domain/reply-presentation.js'

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

test('没有正则时三层回复保持原文，HTML 只影响展示分类', () => {
  const source = '正文。\n\n<details><summary>状态</summary><!-- HP: 10 --></details>'
  const result = projectReplyLayers(source)

  assert.equal(result.sourceText, source)
  assert.equal(result.sessionText, source)
  assert.equal(result.displayText, source)
  assert.equal(result.displayMode, 'html')
  assert.match(result.displayHtml, /<details><summary>状态<\/summary><!-- HP: 10 --><\/details>/)
  assert.deepEqual(result.applied, { session: [], display: [] })
})

test('markdownOnly 只改变展示投影并保持替换位置', () => {
  const source = '海风吹过。\n<status>体力 90</status>\n她继续向前。'
  const result = projectReplyLayers(source, {
    regexScripts: [script('状态展示', '/<status>(.*?)<\\/status>/s', '<aside>$1</aside>', { markdownOnly: true })],
    placement: 2
  })

  assert.equal(result.sourceText, source)
  assert.equal(result.sessionText, source)
  assert.equal(result.displayText, '海风吹过。\n<aside>体力 90</aside>\n她继续向前。')
  assert.equal(result.displayMode, 'html')
  assert.deepEqual(result.applied.session, [])
  assert.deepEqual(result.applied.display.map(item => item.name), ['状态展示'])
})

test('promptOnly 只改变 Session 投影', () => {
  const source = '<draft_notes>思考过程</draft_notes>\n正文。'
  const result = projectReplyLayers(source, {
    regexScripts: [script('移除思考', '/<draft_notes>[\\s\\S]*?<\\/draft_notes>\\s*/', '', { promptOnly: true })],
    placement: 2
  })

  assert.equal(result.sessionText, '正文。')
  assert.equal(result.displayText, source)
  assert.equal(result.displayMode, 'html')
})

test('两个 flag 都启用时分别改变 Session 和展示投影', () => {
  const result = projectReplyLayers('进入校园', {
    regexScripts: [script('双投影', '校园', '<b>校园</b>', { markdownOnly: true, promptOnly: true })],
    placement: 2
  })

  assert.equal(result.sessionText, '进入<b>校园</b>')
  assert.equal(result.displayText, '进入<b>校园</b>')
  assert.equal(result.applied.session.length, 1)
  assert.equal(result.applied.display.length, 1)
})

test('两个 flag 都未启用时执行酒馆永久替换语义但保留原始留档', () => {
  const result = projectReplyLayers('进入校园', {
    regexScripts: [script('普通规则', '校园', '学院')],
    placement: 2
  })

  assert.equal(result.sourceText, '进入校园')
  assert.equal(result.sessionText, '进入学院')
  assert.equal(result.displayText, '进入学院')
})

test('完整 HTML、HTML 注释和 details 均留在原位置，不转换也不搬运', () => {
  const source = '正文。\n\n<details><summary>后台日志</summary>\n<!-- <script>alert("x")</script> -->\n</details>\n\n尾声。'
  const result = projectReplyLayers(source)

  assert.equal(result.sessionText, source)
  assert.equal(result.displayText, source)
  assert.match(result.displayText, /<!-- <script>alert\("x"\)<\/script> -->/)
  assert.equal(result.displayMode, 'html')
})

test('HTML 代码围栏仍是 Markdown 代码，不触发 HTML frame', () => {
  const source = '示例：\n\n```html\n<div>只展示源码</div>\n```'
  assert.equal(displayModeOf(source), 'markdown')
})

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

test('历史投影从原文重算，关闭展示正则后恢复原始消息', () => {
  const rule = script('删除参考块', '/<Reference_Example>[\\s\\S]*?<\\/Reference_Example>/g', '', { markdownOnly: true })
  const source = '正文。\n\n<Reference_Example>辅助内容</Reference_Example>'
  const enabled = projectReplyHistory([
    { role: 'assistant', turn: 2, text: source, sourceText: source }
  ], { regexScripts: [rule], placement: 2 })

  assert.deepEqual(enabled.projections.map(({ turn, text, mode }) => ({ turn, text, mode })), [
    { turn: 2, text: '正文。\n\n', mode: 'markdown' }
  ])

  const disabled = projectReplyHistory([
    { role: 'assistant', turn: 2, text: '正文。', sourceText: source }
  ], { regexScripts: [], placement: 2 })

  assert.deepEqual(disabled.projections.map(({ turn, text, mode }) => ({ turn, text, mode })), [
    { turn: 2, text: source, mode: 'html' }
  ])
  assert.equal(disabled.presentation, null)
})
