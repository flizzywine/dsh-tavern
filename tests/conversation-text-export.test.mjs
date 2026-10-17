import assert from 'node:assert/strict'
import test from 'node:test'

import { createConversationMarkdownExport, conversationStoryTurns } from '../tavern-plugin/lib/domain/conversation-text-export.js'

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

test('玩家输入为引用，配图以相对链接插在对应正文之后', () => {
  const chat = { title: '雨夜', messages: [
    { role: 'assistant', greeting: true, text: '开场' },
    { role: 'user', text: '推门\n进去' },
    { role: 'assistant', turn: 2, text: '屋里很暗' },
    { role: 'user', text: '点灯' },
    { role: 'assistant', turn: 3, text: '灯亮了' }
  ] }
  assert.deepEqual(conversationStoryTurns(chat), [1, 2, 3])
  const result = createConversationMarkdownExport(chat, { images: new Map([[2, 'images/002.png']]) })
  assert.equal(result.filename, '雨夜.md')
  assert.equal(result.text, '# 雨夜\n\n开场\n\n---\n\n> 推门\n> 进去\n\n---\n\n屋里很暗\n\n![第 2 轮配图](images/002.png)\n\n---\n\n> 点灯\n\n---\n\n灯亮了\n')
})
