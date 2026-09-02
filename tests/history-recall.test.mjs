import assert from 'node:assert/strict'
import test from 'node:test'

import { parameterSchemaSpecToJsonSchema } from '../tavern-plugin/node_modules/@deepseek-ai/dsh-tools/lib/index.js'
import { dshParameterFields } from '../tavern-plugin/lib/domain/dsh-tool-schema.js'
import { createHistoryRecall, renderHistoryRecall } from '../tavern-plugin/lib/domain/history-recall.js'
import { HISTORY_RECALL_TOOL } from '../tavern-plugin/lib/domain/history-recall.js'

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

test('历史检索的标准 JSON Schema 可适配为 DSH 工具参数字段', () => {
  const fields = dshParameterFields(HISTORY_RECALL_TOOL.parameters)
  const schema = parameterSchemaSpecToJsonSchema(fields)

  assert.equal(schema.type, 'object')
  assert.deepEqual(Object.keys(schema.properties), ['query', 'turn', 'radius', 'limit'])
  assert.equal('minLength' in schema.properties.query, false)
  assert.equal('minimum' in schema.properties.turn, false)
})

test('按关键词检索正式 Session 正文，不读取展示层、原始层、旧 Swipe 或未提交输入', () => {
  const recall = createHistoryRecall()
  const result = recall.recall({ chat: chat(), query: '银钥匙 北门' })

  assert.equal(result.found, true)
  assert.equal(result.revision, 7)
  assert.deepEqual(result.matches.map(function (item) { return item.turn }), [2])
  assert.match(result.matches[0].excerpt, /银钥匙/)
  for (const forbidden of ['状态栏', '开场原文', '旧分支', '隐藏工具', '尚未形成']) {
    assert.doesNotMatch(JSON.stringify(result), new RegExp(forbidden))
  }
})

test('按轮次渐进读取相邻完整 Round，并包含开场白', () => {
  const result = createHistoryRecall().recall({ chat: chat(), turn: 2, radius: 1 })

  assert.equal(result.found, true)
  assert.deepEqual(result.rounds.map(function (round) { return round.turn }), [1, 2, 3])
  assert.deepEqual(result.rounds[1].messages.map(function (message) { return message.role }), ['user', 'assistant'])
  assert.match(result.rounds[1].messages[0].text, /银钥匙/)
})

test('查询接口拒绝同时提供或同时省略 query 与 turn', () => {
  const recall = createHistoryRecall()
  assert.throws(function () { recall.recall({ chat: chat() }) }, /必须且只能提供/)
  assert.throws(function () { recall.recall({ chat: chat(), query: '白塔', turn: 2 }) }, /必须且只能提供/)
})

test('工具结果把禁止重复演绎的提醒放在召回正文之前', () => {
  const result = createHistoryRecall().recall({ chat: chat(), turn: 2, radius: 0 })
  const rendered = renderHistoryRecall(result)

  assert.ok(rendered.startsWith('【历史回忆资料】'))
  assert.match(rendered, /不得当作当前场景继续输出，不得重复演绎/)
  assert.match(rendered, /【第 2 轮】/)
})

test('重新生成和回退无需维护索引，检索结果直接服从最新 Chat', () => {
  const recall = createHistoryRecall()
  const original = chat()
  const regenerated = structuredClone(original)
  regenerated.messages[2].text = '守门人退还银钥匙，北门仍然关闭。'

  assert.equal(recall.recall({ chat: original, query: '承诺' }).found, true)
  assert.equal(recall.recall({ chat: regenerated, query: '承诺' }).found, false)
  assert.equal(recall.recall({ chat: regenerated, query: '退还' }).found, true)

  const rolledBack = structuredClone(regenerated)
  rolledBack.messages = rolledBack.messages.slice(0, 1)
  assert.equal(recall.recall({ chat: rolledBack, query: '退还' }).found, false)
})
