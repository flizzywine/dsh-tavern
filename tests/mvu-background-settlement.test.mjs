import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMvuBackgroundTaskFrame,
  extractMvuStoryText,
  formatMvuUpdateCommand,
  normalizeMvuToolSubmission,
  projectMvuBackgroundRequest
} from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

test('变量结算正文只保留本轮剧情，不包含控制协议和状态栏 HTML', function () {
  const source = [
    '她推开门，确认屋内无人。',
    '<UpdateVariable><JSONPatch>[{"op":"replace","path":"/hp","value":9}]</JSONPatch></UpdateVariable>',
    '<visual_cards>[{"name":"她"}]</visual_cards>',
    '<StatusPlaceHolderImpl/>',
    '```html',
    '<section>状态栏</section>',
    '```',
    '门外的雨声仍未停。'
  ].join('\n\n')

  assert.equal(extractMvuStoryText(source), '她推开门，确认屋内无人。\n\n门外的雨声仍未停。')
})

test('变量结算 Frame 明确隔离用户输入、旧轮正文和隐藏思考', function () {
  const frame = createMvuBackgroundTaskFrame({
    operationId: 'agent-1', chatId: 'chat-1', branchId: 'branch-1', basedOnRevision: 9,
    messageId: 4, swipeId: 0, storyDigest: 'story-hash', storyText: '突破失败，他跌回原地。',
    currentVariables: { stat_data: { 修为: 10 }, schema: { type: 'object' } },
    updateRules: ['只记录正文已经发生的变化。']
  })
  const request = projectMvuBackgroundRequest(frame)
  const suppliedContext = JSON.stringify({ messages: request.messages, turnContext: request.turnContext })

  assert.equal(frame.trigger.messageId, 4)
  assert.equal(frame.outputContract.exactlyOnce, true)
  assert.equal(request.messages.length, 1)
  assert.equal(request.messages[0].role, 'assistant')
  assert.match(suppliedContext, /突破失败/)
  assert.doesNotMatch(suppliedContext, /尝试突破|隐藏思考|旧轮正文/)
  assert.deepEqual(request.tools.map(function (tool) { return tool.name }), ['mvu_submit_update'])
})

test('空 operations 是有效的明确结算结果', function () {
  const value = normalizeMvuToolSubmission({ analysis: '本轮没有可记录变化', operations: [] })
  assert.deepEqual(value.operations, [])
  assert.match(formatMvuUpdateCommand(value), /<JSONPatch>\n\[\]\n<\/JSONPatch>/)
})

test('工具拒绝任意 JavaScript、非法路径和无效 delta', function () {
  assert.throws(function () {
    normalizeMvuToolSubmission({ analysis: '', operations: [{ op: 'eval', path: '/hp', value: 'process.exit()' }] })
  }, /不受支持/)
  assert.throws(function () {
    normalizeMvuToolSubmission({ analysis: '', operations: [{ op: 'replace', path: 'hp', value: 9 }] })
  }, /JSON Pointer/)
  assert.throws(function () {
    normalizeMvuToolSubmission({ analysis: '', operations: [{ op: 'delta', path: '/hp', value: '1' }] })
  }, /有限数字/)
})
