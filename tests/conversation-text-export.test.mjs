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
