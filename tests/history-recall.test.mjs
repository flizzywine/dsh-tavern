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

test('重复调用计入预算且耗尽后不再返回正文或搜索结果', () => {
  const recall = createHistoryRecall()
  const scope = {}
  for (let i = 0; i < 6; i++) recall.recall({ chat: chat(), turn: 2, scope })
  const result = recall.recall({ chat: chat(), query: '北门', scope })
  assert.equal(result.matches.length, 0)
  assert.match(renderHistoryRecall(result), /预算已用尽/)
})

test('完整正文冷却持续十轮并可从存档恢复，摘要不触发冷却', () => {
  const source = chat()
  const read = (chat, args) => createHistoryRecall().recall({ chat, trackCooldown: true, ...args })
  read(source, { query: '北门' })
  assert.equal(source.historyRecallCooldowns, undefined)
  assert.equal(read(source, { turn: 2, radius: 0 }).rounds.length, 1)
  const restored = JSON.parse(JSON.stringify(source))
  assert.equal(read(restored, { turn: 2, radius: 0 }).rounds.length, 0)
  assert.equal(read(restored, { query: '北门' }).matches.length, 0)
  restored.messages.push({role:'assistant', turn:13, text:'十轮后'})
  assert.equal(read(restored, { turn: 2, radius: 0 }).rounds.length, 0)
  restored.messages.push({role:'assistant', turn:14, text:'冷却结束'})
  assert.equal(read(restored, { turn: 2, radius: 0 }).rounds.length, 1)
})
