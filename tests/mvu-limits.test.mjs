import assert from 'node:assert/strict'
import test from 'node:test'

import { createMvuBackgroundTaskFrame, createMvuSettlementModule, projectMvuBackgroundRequest } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'
import { cardMvuLimits, mvuLimitViolations, validateMvuLimits } from '../tavern-plugin/lib/domain/mvu-limits.js'
import { checkMvuCard } from '../tavern-plugin/lib/domain/mvu-card-check.js'

// Limits sit in $meta next to extensible, where the card already describes its variables' structure.
const initial = { 机构: { 混沌: 0, $meta: { limits: { 混沌: { min: 0 } } } },
  成长: { 已标: { 职能: 0, 现实: 0, $meta: { extensible: false, limits: { '*': { min: 0, max: 30 } } } } },
  阶段: 0, $meta: { strictSet: true, limits: { 阶段: { values: [0, 1, 2, 3] } } } }
const card = { spec: 'chara_card_v3', data: { first_mes: '开场。\n<initvar>\n' + JSON.stringify(initial) + '\n</initvar>' } }

test('card limits: read from $meta in the initial values (opening, else the [initvar] entry); malformed rules reported by the card check', () => {
  assert.deepEqual(cardMvuLimits(card).map(limit => limit.path), ['/阶段', '/机构/混沌', '/成长/已标/*'])
  assert.deepEqual(cardMvuLimits({ first_mes: '开场', character_book: { entries: [{ comment: '[initvar]初值', enabled: false, content: JSON.stringify(initial) }] } }).length, 3)
  assert.equal(cardMvuLimits({ first_mes: '<initvar>{"hp":1}</initvar>' }), null)
  const { errors } = validateMvuLimits({ a: 1, b: 1, c: 1, d: 1, $meta: { limits: { a: { min: 3, max: 1 }, b: { values: [] }, c: {}, d: { min: '0' }, e: { min: 0 } } } })
  assert.deepEqual(errors.map(error => error.path), ['/$meta/limits/a', '/$meta/limits/b/values', '/$meta/limits/c', '/$meta/limits/d/min', '/$meta/limits/e'])
  const checked = checkMvuCard({ first_mes: '<initvar>{"机构":{"混沌":0,"$meta":{"limits":{"混沌":{"min":0},"秩序":{"min":0},"*":{"max":"nine"}}}}}</initvar>' })
  assert.deepEqual(checked.errors.map(error => error.path), ['/first_mes/机构/$meta/limits/秩序', '/first_mes/机构/$meta/limits/*/max'])
})

test('only values a write changed are checked: an old out-of-range value stays readable', () => {
  const limits = cardMvuLimits(card)
  const before = { 机构: { 混沌: -1 }, 成长: { 已标: { 职能: 29, 现实: 0 } }, 阶段: 0 }
  assert.deepEqual(mvuLimitViolations(before, { ...before, 阶段: 1 }, limits), [])
  const violations = mvuLimitViolations(before, { 机构: { 混沌: -1 }, 成长: { 已标: { 职能: 32, 现实: 0 } }, 阶段: 7 }, limits)
  assert.deepEqual(violations.map(item => item.path), ['/stat_data/阶段', '/stat_data/成长/已标/职能'])
  assert.match(violations[1].message, /应在 0 到 30 之间；这批操作执行后是 32（执行前 29）/)
  assert.match(violations[0].message, /只能是 0、1、2、3 之一/)
})

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

test('no declared limits: the prompt has no range section', () => {
  const frame = createMvuBackgroundTaskFrame({ operationId: 'o', chatId: 'c', branchId: 'b', basedOnRevision: 1, messageId: 0, swipeId: 0, storyText: '正文。', currentVariables: { stat_data: {} } })
  assert.doesNotMatch(projectMvuBackgroundRequest(frame).turnContext, /变量取值范围/)
})
