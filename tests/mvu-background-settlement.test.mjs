import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createMvuBackgroundTaskFrame,
  createMvuSettlementModule,
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

test('深模块强制一次工具调用并以官方 Runtime 的实际差异生成回执', async function () {
  const modelCalls = []
  const runtimeCalls = []
  const module = createMvuSettlementModule({
    model: {
      async run(input) {
        modelCalls.push(structuredClone({ messages: input.messages, turnContext: input.turnContext, rewindTo: input.rewindTo }))
        await input.onToolCall({
          name: 'mvu_submit_update',
          arguments: { analysis: '正文确认体力下降', operations: [{ op: 'delta', path: '/stat_data/体力', value: -1 }] }
        })
        return { text: '{"posture":"扶墙站立"}', traceSessionId: 'background-1', traceBoundary: 12 }
      }
    },
    runtime: {
      async settleMvuUpdate(input) {
        runtimeCalls.push(input)
        return {
          updated: true,
          context: { messages: [{ variables: {} }, { variables: { stat_data: { 体力: 9 }, schema: { type: 'object' } } }] }
        }
      }
    }
  })

  const result = await module.settleVariables({
    operationId: 'operation-1', chatId: 'chat-1', branchId: 'branch-1', basedOnRevision: 5,
    sessionId: 'session-1', turn: 2, messageId: 1, swipeId: 0, expectedLifecycleRevision: 3,
    storyText: '她受伤后扶墙站立。', selection: { provider: 'test', model: 'test' },
    currentVariables: { stat_data: { 体力: 10 }, schema: { type: 'object' } }
  })

  assert.equal(modelCalls[0].rewindTo, -1)
  assert.equal(modelCalls[0].messages.length, 1)
  assert.equal(runtimeCalls.length, 1)
  assert.match(runtimeCalls[0].command, /"op": "delta"/)
  assert.equal(result.receipt.status, 'updated')
  assert.deepEqual(result.receipt.changes, [{ operation: 'set', path: '/stat_data/体力', before: '10', after: '9' }])
})

test('深模块把有效空 Patch 记录为 unchanged，把漏调用工具记录为失败', async function () {
  const unchanged = createMvuSettlementModule({
    maxAttempts: 1,
    model: {
      async run(input) {
        await input.onToolCall({ name: 'mvu_submit_update', arguments: { analysis: '无变化', operations: [] } })
        return { text: '{"posture":"原地站立"}' }
      }
    },
    runtime: {
      async settleMvuUpdate() { return { updated: true, context: { messages: [{ variables: { hp: 10 } }] } } }
    }
  })
  const input = {
    operationId: 'operation-2', chatId: 'chat-1', branchId: 'branch-1', basedOnRevision: 5,
    sessionId: 'session-1', messageId: 0, swipeId: 0, storyText: '他仍站在原地。', currentVariables: { hp: 10 }
  }
  assert.equal((await unchanged.settleVariables(input)).receipt.status, 'unchanged')

  const missing = createMvuSettlementModule({
    maxAttempts: 1,
    model: { async run() { return { text: '{}' } } },
    runtime: { async settleMvuUpdate() { throw new Error('不应执行') } }
  })
  await assert.rejects(function () { return missing.settleVariables(input) }, /未调用 mvu_submit_update/)
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
