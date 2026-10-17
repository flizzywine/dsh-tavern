import assert from 'node:assert/strict'
import test from 'node:test'

import { createHistoryRecall, renderHistoryRecall } from '../tavern-plugin/lib/domain/history-recall.js'

function chat() {
  return {
    id: 'chat-memory',
    _storageRevision: 7,
    messages: [
      { role: 'assistant', greeting: true, turn: 1, text: '雨夜里，林遥第一次抵达白塔。', sourceText: '不应采用的开场原文' },
      { role: 'user', text: '我把银钥匙交给守门人。' },
      { role: 'assistant', turn: 2, text: '守门人收下银钥匙，承诺在钟响三次后打开北门。', displayText: '不应检索的状态栏', swipes: ['旧分支提到南门', '当前分支'] },
      { role: 'tool', text: '隐藏工具结果' },
      { role: 'assistant', turn: 3, text: '林遥和玩家离开白塔，前往河港。' },
      { role: 'user', text: '这个输入尚未形成完整 Round，不应被检索。' }
    ]
  }
}

test('工具结果把禁止重复演绎的提醒放在召回正文之前', () => {
  const result = createHistoryRecall().recall({ chat: chat(), turn: 2, radius: 0 })
  const rendered = renderHistoryRecall(result)

  assert.ok(rendered.startsWith('【历史回忆资料】'))
  assert.match(rendered, /不得当作当前场景继续输出，不得重复演绎/)
  assert.match(rendered, /【第 2 轮】/)
})
