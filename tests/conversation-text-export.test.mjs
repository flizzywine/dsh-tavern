import assert from 'node:assert/strict'
import test from 'node:test'

import { createConversationMarkdownExport } from '../tavern-plugin/lib/domain/conversation-text-export.js'

test('整轮 HTML 安全转换为可见正文，不执行或导出前端代码', () => {
  const result = createConversationMarkdownExport({
    title: '故事',
    messages: [{
      role: 'assistant', turn: 1,
      text: '<!doctype html><html><head><title>内部标题</title><style>.secret{display:none}</style><script>window.bad = true</script></head><body><maintext><p>第一段 &amp; 正文</p><p>第二段<br>继续</p></maintext><!-- 内部注释 --></body></html>'
    }]
  })

  assert.equal(result.text, '# 故事\n\n第一段 & 正文\n\n第二段\n继续\n')
  assert.doesNotMatch(result.text, /doctype|html|head|style|script|window\.bad|内部标题|内部注释|maintext|<|>/i)
})

test('故事正文省略每楼开头的人物卡标题，保留文档标题和正文', () => {
  const result = createConversationMarkdownExport({
    title: '雨夜酒馆',
    cardName: '阿芙拉',
    messages: [
      { role: 'assistant', greeting: true, text: '<h1>阿芙拉</h1><maintext>雨水敲着窗。</maintext>' },
      { role: 'user', text: '阿芙拉' },
      { role: 'assistant', text: '## 阿芙拉\n\n## 门后的脚步\n\n阿芙拉抬起头。' },
      { role: 'assistant', text: '<title>人物卡模板标题</title><p>门开了。</p>' },
      { role: 'assistant', text: '阿芙拉\n\n她向门口望去。' }
    ]
  })

  assert.equal(result.filename, '雨夜酒馆.md')
  assert.equal(result.messageCount, 5)
  assert.equal(result.text, '# 雨夜酒馆\n\n雨水敲着窗。\n\n---\n\n> 阿芙拉\n\n---\n\n## 门后的脚步\n\n阿芙拉抬起头。\n\n---\n\n门开了。\n\n---\n\n她向门口望去。\n')
})
