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
  assert(request.turnContext.endsWith(input.updateRules[0]))
  assert.deepEqual(frame.authoritativeState.currentVariables, variables)
  assert.deepEqual(input, before)
})

test('人物卡可明确授权人物设计，但剧情状态仍只能依据正文', () => {
  const request = projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({
    ...input,
    currentVariables: { stat_data: { 人物库: { $meta: { extensible: true } } } },
    characterDesignSkill: '# 后台人物设计\n设计字段可以创作；状态字段必须依据正文。',
    updateRules: ['人物库允许预先设计人物；设计字段为性格和外貌，状态字段为位置和在场。']
  }))
  assert.match(request.turnContext, /【后台人物设计 Skill】/)
  assert.match(request.turnContext, /# 后台人物设计/)
  assert.match(request.system, /在场、位置、关系进展/)
  assert.match(request.system, /正文[^。]*确认/)
})

test('没有当前对话人物库时不加载人物设计 Skill', () => {
  const request = projectMvuBackgroundRequest(createMvuBackgroundTaskFrame({
    ...input,
    characterDesignSkill: '# 不应出现的人物设计 Skill'
  }))
  assert.doesNotMatch(request.turnContext, /后台人物设计 Skill/)
  assert.doesNotMatch(request.turnContext, /不应出现/)
})

test('结算模块从内置配置自动向人物库任务加载 Skill', async () => {
  let turnContext = ''
  const currentVariables = { stat_data: { 人物库: { $meta: { extensible: true } } } }
  const module = createMvuSettlementModule({
    characterDesignSkill: '# 独立人物设计 Skill',
    model: { async run(request) {
      turnContext = request.turnContext
      await request.onToolCall({ name: 'posture_submit', arguments: { posture: '原地站立' } })
      await request.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [] } })
      return { text: '' }
    } },
    runtime: { async settleMvuUpdate(request) {
      return { context: { messages: [{ variables: currentVariables }] }, validation: request.validate({ before: currentVariables, after: currentVariables }), diagnostics: [] }
    } }
  })
  await module.settleVariables({ ...input, currentVariables })
  assert.match(turnContext, /【后台人物设计 Skill】\n# 独立人物设计 Skill/)
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
