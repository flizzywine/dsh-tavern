import assert from 'node:assert/strict'
import test from 'node:test'

import { projectReplyHistory, projectReplyPresentation } from '../tavern-plugin/lib/domain/reply-presentation.js'

test('命运开场白把叙事正文与状态 HTML 分离', () => {
  const source = '叶天邪转身走进巷道。\n\n<style>.xt{color:#fff}</style>\n<details open><summary>邪天·状态面板</summary><div class="xt">Lv 1</div></details>'
  const result = projectReplyPresentation(source)

  assert.equal(result.bodyText, '叶天邪转身走进巷道。')
  assert.match(result.presentationHtml, /^<style>/)
  assert.match(result.presentationHtml, /邪天·状态面板/)
  assert.equal(result.warnings.length, 0)
})

test('完整 HTML 开场白全部进入展示状态', () => {
  const source = '<div style="text-align:center"><img src="https://example.com/a.png"><h1>人物卡</h1></div>'
  const result = projectReplyPresentation(source)

  assert.equal(result.bodyText, '')
  assert.equal(result.presentationHtml, source)
})

test('HTML 代码围栏从正文中移除但围栏不进入展示内容', () => {
  const source = '正文。\n\n```html\n<style>.status{color:red}</style><div class="status">状态</div>\n```'
  const result = projectReplyPresentation(source)

  assert.equal(result.bodyText, '正文。')
  assert.equal(result.presentationHtml, '<style>.status{color:red}</style><div class="status">状态</div>')
})

test('普通行内 HTML 和不完整标签不从正文中误删', () => {
  const inline = projectReplyPresentation('她强调了 <b>不要回头</b>。')
  const malformed = projectReplyPresentation('正文后出现了 <div class="status">未闭合')

  assert.equal(inline.bodyText, '她强调了 <b>不要回头</b>。')
  assert.equal(inline.presentationHtml, '')
  assert.equal(malformed.bodyText, '正文后出现了 <div class="status">未闭合')
  assert.equal(malformed.presentationHtml, '')
  assert.equal(malformed.warnings.length, 1)
})

test('历史回复使用原文重新投影，关闭正则后恢复原始展示', () => {
  const rule = {
    id: 'reference', name: '删除参考块', findRegex: '/<Reference_Example>[\\s\\S]*?<\\/Reference_Example>/g', replaceString: '',
    placement: [2], enabled: true, markdownOnly: true, promptOnly: false, runOnEdit: false
  }
  const source = '正文。\n\n<Reference_Example>辅助内容</Reference_Example>'
  const enabled = projectReplyHistory([
    { role: 'assistant', turn: 2, text: source }
  ], { regexScripts: [rule], placement: 2, isMarkdown: true })

  assert.deepEqual(enabled.projections, [{ turn: 2, text: '正文。' }])

  const disabled = projectReplyHistory([
    { role: 'assistant', turn: 2, text: '正文。', sourceText: source }
  ], { regexScripts: [], placement: 2, isMarkdown: true })

  assert.deepEqual(disabled.projections, [{ turn: 2, text: source }])
  assert.equal(disabled.presentation, null)
})
