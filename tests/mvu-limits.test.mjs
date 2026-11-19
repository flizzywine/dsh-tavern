import assert from 'node:assert/strict'
import test from 'node:test'

import { createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { cardMvuLimits } from '../tavern-plugin/lib/domain/mvu-limits.js'

// Limits sit in $meta next to extensible, where the card already describes its variables' structure.
const initial = { 机构: { 混沌: 0, $meta: { limits: { 混沌: { min: 0 } } } },
  成长: { 已标: { 职能: 0, 现实: 0, $meta: { extensible: false, limits: { '*': { min: 0, max: 30 } } } } },
  阶段: 0, $meta: { strictSet: true, limits: { 阶段: { values: [0, 1, 2, 3] } } } }
const card = { spec: 'chara_card_v3', data: { first_mes: '开场。\n<initvar>\n' + JSON.stringify(initial) + '\n</initvar>' } }

test('settlement: an out-of-range delta rolls back with the reason, the corrected batch is saved, the prompt lists the ranges', async () => {
  const currentVariables = { stat_data: { 机构: { 混沌: 2 } }, schema: {} }
  const feedback = [], saved = []
  let prompt
  const module = createMvuSettlementModule({
    model: { async run(request) {
      prompt = request.turnContext
      for (const valueJson of ['-5', '-2']) feedback.push(JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [{ op: 'delta', path: '/stat_data/机构/混沌', valueJson }] } })))
      return { text: '' }
    } },
    // Like the real transaction: MVU adds the delta, then the host's validate decides whether the draft is kept.
    runtime: { async settleMvuUpdate(request) {
      const [operation] = JSON.parse(request.command.match(/<JSONPatch>([\s\S]*?)<\/JSONPatch>/)[1])
      const after = { ...currentVariables, stat_data: { 机构: { 混沌: currentVariables.stat_data.机构.混沌 + operation.value } } }
      const validation = request.validate({ before: currentVariables, after })
      if (validation.failures.length) return { updated: false, rejected: true, retryable: true, validation, context: { messages: [{ variables: currentVariables }] } }
      saved.push(after.stat_data.机构.混沌)
      return { updated: true, validation, variables: after }
    } }
  })
  const result = await module.settleVariables({ operationId: 'limits', chatId: 'c', branchId: 'b', basedOnRevision: 1, sessionId: 's', messageId: 0, swipeId: 0,
    storyText: '异常花掉了两点混沌。', currentVariables, variableLimits: cardMvuLimits(card), backgroundTasks: { posture: false } })
  assert.equal(feedback[0].ok, false)
  assert.equal(feedback[0].retryable, true)
  assert.equal(feedback[0].rolledBack, true)
  assert.match(feedback[0].failures[0].message, /\/stat_data\/机构\/混沌 应不小于 0；这批操作执行后是 -3（执行前 2）/)
  assert.deepEqual(feedback[0].rejectedOperations, [{ operation: 'delta', path: '/stat_data/机构/混沌', submittedJson: '-5', observedJson: '2' }])
  assert.equal(feedback[1].ok, true)
  assert.deepEqual(saved, [0])
  assert.equal(result.receipt.status, 'updated')
  assert.match(prompt, /<variable_limits>\n[\s\S]*\/stat_data\/机构\/混沌：应不小于 0\n\/stat_data\/成长\/已标\/\*：应在 0 到 30 之间/)
})
