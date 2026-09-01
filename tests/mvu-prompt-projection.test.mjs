import assert from 'node:assert/strict'
import test from 'node:test'
import { createMvuBackgroundTaskFrame, projectMvuBackgroundRequest, createMvuSettlementModule } from '../tavern-plugin/lib/domain/mvu-background-settlement.js'

const schema = { type: 'object', properties: { hp: { type: 'number', required: true, description: 'unique-schema-marker' } }, extensible: false }
const variables = { stat_data: { hp: 10, notes: '保留\n原文与空格  ' }, schema,
  display_data: { hp: '展示副本' }, delta_data: { hp: '差异副本' }, custom: { value: '自定义字段' }, initialized_lorebooks: ['book'] }
const input = { operationId: 'op', chatId: 'c', branchId: 'b', basedOnRevision: 1,
  sessionId: 's', messageId: 0, swipeId: 0, storyText: '体力减少一。', currentVariables: variables,
  updateRules: ['规则原文\n  缩进保留'] }

function sections(text) {
  return { variables: JSON.parse(text.split('【当前变量快照】\n')[1].split('\n【变量结构】')[0]),
    schema: JSON.parse(text.split('【变量结构】\n')[1].split('\n【人物卡变量更新规则】')[0]) }
}

test('后台只发送一份结构和真实状态，运行时 Frame、未知字段和规则原样保留', () => {
  const before = structuredClone(input)
  const frame = createMvuBackgroundTaskFrame(input)
  const request = projectMvuBackgroundRequest(frame)
  const parsed = sections(request.turnContext)
  assert.deepEqual(parsed.variables, { stat_data: variables.stat_data, custom: variables.custom, initialized_lorebooks: ['book'] })
  assert.deepEqual(parsed.schema, schema)
  assert.equal(request.turnContext.split('unique-schema-marker').length - 1, 1)
  assert(request.turnContext.includes(JSON.stringify(schema)), 'structure uses compact lossless JSON')
  assert(request.turnContext.includes(input.updateRules[0]))
  assert(request.turnContext.endsWith('否则跳过人物设计。'))
  assert.deepEqual(frame.authoritativeState.currentVariables, variables)
  assert.deepEqual(input, before)
})

test('人物设计提示不依赖固定人物库字段，也不注入 Skill 全文', () => {
  const request = projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({
    ...input,
    currentVariables: { stat_data: { 人物库: { $meta: { extensible: true } } } },
    updateRules: ['人物库允许预先设计人物；设计字段为性格和外貌，状态字段为位置和在场。']
  }))
  assert.match(request.turnContext, /【人物设计（按需）】/)
  assert.match(request.turnContext, /调用 skill 加载 tavern-character-design/)
  assert.match(request.turnContext, /新人物即将登场/)
  assert.match(request.turnContext, /提前设计可能登场的人物/)
  assert.match(request.turnContext, /参考当前人物卡的变量模板自行设计和提交/)
  assert.doesNotMatch(request.turnContext, /# 后台人物设计/)
})

test('没有人物库字段时仍然提示 Agent 按需设计人物', () => {
  const request = projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({
    ...input
  }))
  assert.match(request.turnContext, /人物设计（按需）/)
  assert.match(request.turnContext, /tavern-character-design/)
})

test('不按字段名误删扁平变量，不删除 stat_data 内同名游戏字段，显式结构优先', () => {
  const flat = { hp: 10, display_data: '游戏字段', delta_data: 4, schema: '剧情用词' }
  const override = { type: 'object', properties: { other: { type: 'boolean' } } }
  const projected = sections(projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({ ...input, currentVariables: flat, variableSchema: override })).turnContext)
  assert.deepEqual(projected.variables, flat)
  assert.deepEqual(projected.schema, override)
  const nested = { stat_data: flat, schema }
  assert.deepEqual(sections(projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({ ...input, currentVariables: nested })).turnContext).variables, { stat_data: flat })
})

test('失败重试反馈同样移除展示副本，不改变运行时输入、原始回执和保存结果', async () => {
  let calls = 0
  let checked = false
  const changedSchema = { ...schema, extensible: true }
  const after = { ...structuredClone(variables), schema: changedSchema }
  const module = createMvuSettlementModule({
    model: { async run(request) {
      await request.onToolCall({ name: 'posture_submit', arguments: { posture: '原地站立' } })
      const malformed = JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: {} }))
      assert.equal(malformed.retryable, true)
      assert.equal(malformed.currentVariables.schema, undefined)
      assert.equal(malformed.currentVariables.display_data, undefined)
      assert.deepEqual(malformed.currentVariables.stat_data, variables.stat_data)
      const failed = JSON.parse(await request.onToolCall({ name: 'mvu_submit_update', arguments: {
        operations: [{ op: 'delta', path: '/hp', value: -1 }] } }))
      assert.equal(failed.currentVariables.schema, undefined)
      assert.equal(failed.currentVariables.delta_data, undefined)
      assert.deepEqual(failed.variableSchema, changedSchema, 'changed validation structure still reaches the model')
      assert.match(JSON.stringify(failed.failures), /拒绝/)
      checked = true
      return { text: '{}' }
    } },
    runtime: { async settleMvuUpdate(request) {
      calls++
      const audit = request.validate({ before: variables, after: variables })
      assert.equal(audit.failures.length, 1)
      return { context: { messages: [{ variables: after }] }, rejected: true, retryable: true,
        validation: { changes: [], sideEffects: [], failures: [{ message: '拒绝本次操作' }] }, diagnostics: [] }
    } }
  })
  const result = await module.settleVariables(input)
  assert.equal(checked, true, 'all model-boundary assertions must run despite settlement error containment')
  assert.equal(calls, 1)
  assert.deepEqual(result.variables, after, 'runtime result retains the complete state')
  assert.deepEqual(result.frame.authoritativeState.currentVariables, variables)
})
