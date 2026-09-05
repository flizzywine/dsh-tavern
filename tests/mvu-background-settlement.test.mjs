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
        modelCalls.push(structuredClone({ messages: input.messages, turnContext: input.turnContext, rewindTo: input.rewindTo, webSearchEnabled: input.webSearchEnabled }))
        await input.onToolCall({ name: 'posture_submit', arguments: { posture: '扶墙站立' } })
        await input.onToolCall({
          name: 'mvu_submit_update',
          arguments: { operations: [{ op: 'delta', path: '/stat_data/体力', value: -1 }] }
        })
        return { text: '', traceSessionId: 'background-1', traceBoundary: 12 }
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
    storyText: '她受伤后扶墙站立。', selection: { provider: 'test', model: 'test' }, webSearchEnabled: true,
    currentVariables: { stat_data: { 体力: 10 }, schema: { type: 'object' } }
  })

  assert.equal(modelCalls[0].rewindTo, -1)
  assert.equal(modelCalls[0].webSearchEnabled, true)
  assert.equal(modelCalls[0].messages.length, 1)
  assert.equal(runtimeCalls.length, 1)
  assert.match(runtimeCalls[0].command, /"op": "delta"/)
  assert.equal(result.receipt.status, 'updated')
  assert.equal(result.posture, '扶墙站立')
  assert.equal(result.receipt.summary, '')
  assert.deepEqual(result.receipt.changes, [{ operation: 'set', path: '/stat_data/体力', before: '10', after: '9' }])
})

test('MVU 后台 Agent 在同一回合加载人物设计工具后继续完成姿势和变量结算', async function () {
  const designCalls = []
  const module = createMvuSettlementModule({
    characterDesign: {
      async execute(chatId, call) {
        designCalls.push({ chatId, name: call.name })
        return JSON.stringify({ ok: true })
      }
    },
    model: { async run(input) {
      assert.deepEqual(input.tools.map(tool => tool.name), ['posture_submit', 'character_design_read', 'character_design_save', 'mvu_submit_update'])
      await input.onToolCall({ name: 'character_design_read', arguments: {} })
      await input.onToolCall({ name: 'character_design_save', arguments: completeDesignFixture() })
      await input.onToolCall({ name: 'posture_submit', arguments: { posture: '站在门边' } })
      await input.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [] } })
      return { text: '' }
    } },
    runtime: { async settleMvuUpdate() { return { context: { messages: [{ variables: { hp: 10 } }] } } } }
  })
  const result = await module.settleVariables({
    operationId: 'operation-design', chatId: 'chat-design', branchId: 'branch-1', basedOnRevision: 1,
    sessionId: 'session-1', messageId: 0, swipeId: 0, storyText: '她走进门内。', currentVariables: { hp: 10 }
  })
  assert.deepEqual(designCalls, [
    { chatId: 'chat-design', name: 'character_design_read' },
    { chatId: 'chat-design', name: 'character_design_save' }
  ])
  assert.equal(result.posture, '站在门边')
  assert.equal(result.receipt.status, 'unchanged')
})

test('MVU 工具提交在进入官方运行时前解析姿势和变量值中的名字宏', async function () {
  const module = createMvuSettlementModule({
    model: { async run(input) {
      await input.onToolCall({
        name: 'posture_submit',
        arguments: { posture: '{{char}}经过 {{ user }} 身侧后走远。' }
      })
      await input.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [{
        op: 'replace', path: '/stat_data/祝南枝/动作体位', value: '经过 {{user}} 身侧后走远。'
      }] } })
      return { text: '' }
    } },
    runtime: { async settleMvuUpdate(input) {
      assert.match(input.command, /经过 陈锋 身侧后走远/)
      assert.doesNotMatch(input.command, /\{\{\s*user\s*\}\}/i)
      return { context: { messages: [{ variables: { stat_data: { 祝南枝: { 动作体位: '经过 陈锋 身侧后走远。' } } } }] } }
    } }
  })

  const result = await module.settleVariables({
    operationId: 'operation-macro', chatId: 'chat-macro', branchId: 'branch-1', basedOnRevision: 1,
    sessionId: 'session-1', messageId: 0, swipeId: 0, storyText: '她从玩家身侧走过。',
    charName: '祝南枝', macroState: { userName: '陈锋', local: {}, global: {} },
    currentVariables: { stat_data: { 祝南枝: { 动作体位: '站在窗边。' } } }
  })

  assert.equal(result.posture, '祝南枝经过 陈锋 身侧后走远。')
  assert.equal(result.receipt.status, 'updated')
  assert.equal(result.variables.stat_data.祝南枝.动作体位, '经过 陈锋 身侧后走远。')
})

function completeDesignFixture() {
  return {
    name: '林岚', identity: '镇上的邮差', narrativeRole: '持续传递线索的人物', coreMotivation: '找到失踪的同伴',
    innerConflict: '职责与私人追寻彼此冲突', personality: '谨慎而执着', appearance: '高挑，短黑发，左眉有浅疤',
    behaviorStyle: '先观察出口再交谈', speechStyle: '措辞简短而准确', relationships: '与镇民保持克制友善',
    defaultPresentation: '深蓝邮差制服和旧皮靴', plotPotential: '失踪同伴留下的信件可牵出后续冲突'
  }
}

test('深模块逐项核验提交结果并把人物卡脚本联动与失败操作分开记录', async function () {
  const module = createMvuSettlementModule({
    maxAttempts: 1,
    model: {
      async run(input) {
        await input.onToolCall({ name: 'posture_submit', arguments: { posture: '走向石门' } })
        await input.onToolCall({
          name: 'mvu_submit_update',
          arguments: {
            operations: [
              { op: 'replace', path: '/本尊/行踪/当前区域', value: '古殿·幽暗长廊' },
              { op: 'replace', path: '/当前处境', value: '正走向石门' }
            ]
          }
        })
        return { text: '' }
      }
    },
    runtime: {
      async settleMvuUpdate() {
        return {
          updated: true,
          context: {
            messages: [{
              variables: {
                stat_data: {
                  本尊: { 行踪: { 当前区域: '古殿·幽暗长廊' } },
                  当前处境: '',
                  $宗门推断: { 当前域: '归墟' }
                }
              }
            }]
          }
        }
      }
    }
  })
  const result = await module.settleVariables({
    operationId: 'operation-partial', chatId: 'chat-1', branchId: 'branch-1', basedOnRevision: 5,
    sessionId: 'session-1', messageId: 0, swipeId: 0, storyText: '他走入长廊，望见石门。',
    currentVariables: {
      stat_data: {
        本尊: { 行踪: { 当前区域: '未知之地' } },
        当前处境: '',
        $宗门推断: { 当前域: '' }
      }
    }
  })

  assert.equal(result.receipt.status, 'partial')
  assert.deepEqual(result.receipt.changes, [{
    operation: 'set', path: '/stat_data/本尊/行踪/当前区域', before: '未知之地', after: '古殿·幽暗长廊'
  }])
  assert.deepEqual(result.receipt.failures, [{
    operation: 'replace', path: '/当前处境', message: '未观察到对应变量变化；请通过“日志”导出执行记录'
  }])
  assert.deepEqual(result.receipt.sideEffects, [{
    operation: 'set', path: '/stat_data/$宗门推断/当前域', before: '', after: '归墟'
  }])
})

test('深模块把有效空 Patch 记录为 unchanged，把漏调用工具记录为失败', async function () {
  const unchanged = createMvuSettlementModule({
    maxAttempts: 1,
    model: {
      async run(input) {
        await input.onToolCall({ name: 'posture_submit', arguments: { posture: '原地站立' } })
        await input.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [] } })
        return { text: '' }
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
  assert.equal(frame.outputContract.singleCommit, true)
  assert.equal(frame.outputContract.maxToolCalls, 3)
  assert.equal(request.messages.length, 1)
  assert.equal(request.messages[0].role, 'assistant')
  assert.match(suppliedContext, /突破失败/)
  assert.doesNotMatch(suppliedContext, /尝试突破|隐藏思考|旧轮正文/)
  assert.deepEqual(request.tools.map(function (tool) { return tool.name }), [
    'posture_submit', 'character_design_read', 'character_design_save', 'mvu_submit_update'
  ])
  const mvuTool = request.tools.find(function (tool) { return tool.name === 'mvu_submit_update' })
  assert.deepEqual(mvuTool.parameters.required, ['operations'])
  assert.equal(Object.hasOwn(mvuTool.parameters.properties, 'analysis'), false)
})

test('空 operations 是有效的明确结算结果，旧 analysis 输入被兼容忽略', function () {
  const value = normalizeMvuToolSubmission({ analysis: '旧格式说明', operations: [] })
  assert.deepEqual(value.operations, [])
  assert.equal(Object.hasOwn(value, 'analysis'), false)
  assert.match(formatMvuUpdateCommand(value), /<JSONPatch>\n\[\]\n<\/JSONPatch>/)
  assert.doesNotMatch(formatMvuUpdateCommand(value), /<Analyze>/)
})

test('发给官方 MVU 前把 DSH 绝对变量路径转为 stat_data 内的相对路径', function () {
  const command = formatMvuUpdateCommand({ operations: [
    { op: 'delta', path: '/stat_data/祝南枝/对主角的好感度', value: 1 },
    { op: 'move', from: '/stat_data/祝南枝/旧位置', path: '/stat_data/祝南枝/当前位置' },
    { op: 'replace', path: '/世界/当前时间', value: '10时38分' }
  ] })
  const patch = JSON.parse(command.match(/<JSONPatch>\n([\s\S]*?)\n<\/JSONPatch>/)[1])

  assert.deepEqual(patch, [
    { op: 'delta', path: '/祝南枝/对主角的好感度', value: 1 },
    { op: 'move', from: '/祝南枝/旧位置', path: '/祝南枝/当前位置' },
    { op: 'replace', path: '/世界/当前时间', value: '10时38分' }
  ])
})

test('工具拒绝任意 JavaScript、非法路径和无效 delta', function () {
  assert.throws(function () {
    normalizeMvuToolSubmission({ operations: [{ op: 'eval', path: '/hp', value: 'process.exit()' }] })
  }, /不受支持/)
  assert.throws(function () {
    normalizeMvuToolSubmission({ operations: [{ op: 'replace', path: 'hp', value: 9 }] })
  }, /JSON Pointer/)
  assert.throws(function () {
    normalizeMvuToolSubmission({ operations: [{ op: 'delta', path: '/hp', value: '1' }] })
  }, /有限数字/)
})
