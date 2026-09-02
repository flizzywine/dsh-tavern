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
import { CHARACTER_DESIGN_READ_TOOL_NAME, CHARACTER_DESIGN_SAVE_TOOL_NAME } from '../tavern-plugin/lib/domain/character-design-document.js'

const fullCharacterDesign = {
  name: '鹿野栞', identity: '高二 S 班风纪委员', narrativeRole: '持续推动校园秩序线的重要盟友',
  coreMotivation: '守住秩序并证明温和也能坚定', innerConflict: '渴望亲近他人却担心失去公正',
  personality: '温和细致，原则问题上异常执拗', appearance: '身高约 164 厘米，深棕低马尾，灰褐眼睛',
  behaviorStyle: '先观察再介入，思考时整理袖口', speechStyle: '礼貌精确，以连续追问代替提高音量',
  relationships: '与教师合作稳定，对同学保留善意和审慎',
  defaultPresentation: '白色制服外套、深灰百褶裙、黑色及膝袜与棕色乐福鞋',
  plotPotential: '会在制度责任与同伴信任冲突时推动选择'
}

const characterVariableSchema = {
  type: 'object',
  properties: {
    在场女生: {
      type: 'object', extensible: true,
      template: { 姓名: '', 性格: '未明确', 袜子: '未明确', 鞋子: '未明确', 内衣裤: '未明确', 在场: false }
    }
  }
}

const fullCharacterMvuFields = {
  姓名: '鹿野栞', 性格: '温和细致，原则问题上异常执拗',
  袜子: '黑色及膝袜', 鞋子: '棕色乐福鞋', 内衣裤: '白色棉质内衣裤', 在场: false
}

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
    storyText: '她受伤后扶墙站立。', selection: { provider: 'test', model: 'test' },
    currentVariables: { stat_data: { 体力: 10 }, schema: { type: 'object' } }
  })

  assert.equal(modelCalls[0].rewindTo, -1)
  assert.equal(modelCalls[0].messages.length, 1)
  assert.equal(runtimeCalls.length, 1)
  assert.match(runtimeCalls[0].command, /"op": "delta"/)
  assert.equal(result.receipt.status, 'updated')
  assert.equal(result.posture, '扶墙站立')
  assert.equal(result.receipt.summary, '')
  assert.deepEqual(result.receipt.changes, [{ operation: 'set', path: '/stat_data/体力', before: '10', after: '9' }])
})

test('人物完整档案先在结算内暂存，成功后与 MVU 投影一起返回给原子提交边界', async function () {
  const sourceDocument = { spec: 'dsh-tavern.character-design-document', version: 1, characters: [] }
  const module = createMvuSettlementModule({
    now: () => 100,
    model: { async run(input) {
      const index = JSON.parse(await input.onToolCall({ name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: {} }))
      assert.deepEqual(index.characters, [])
      const saved = JSON.parse(await input.onToolCall({
        name: CHARACTER_DESIGN_SAVE_TOOL_NAME,
        arguments: { ...fullCharacterDesign, mvuPath: '/在场女生/鹿野栞', mvuFields: fullCharacterMvuFields }
      }))
      assert.equal(saved.ok, true)
      await input.onToolCall({ name: 'posture_submit', arguments: { posture: '站在走廊尽头' } })
      await input.onToolCall({ name: 'mvu_submit_update', arguments: { operations: [] } })
      return { text: '' }
    } },
    runtime: { async settleMvuUpdate() { return { context: { messages: [{ variables: { stat_data: {} } }] } } } }
  })
  const result = await module.settleVariables({
    operationId: 'operation-design', chatId: 'chat-1', branchId: 'branch-1', basedOnRevision: 5,
    sessionId: 'session-1', messageId: 0, swipeId: 0, storyText: '走廊另一端传来脚步声。',
    currentVariables: { stat_data: {}, schema: characterVariableSchema },
    variableSchema: characterVariableSchema,
    characterDesignDocument: sourceDocument
  })
  assert.equal(result.characterDesignChanged, true)
  assert.equal(result.characterDesignDocument.characters[0].design.personality, fullCharacterDesign.personality)
  assert.deepEqual(result.characterDesignDocument.characters[0].mvuProjection, {
    path: '/在场女生/鹿野栞', fields: fullCharacterMvuFields
  })
  assert.deepEqual(sourceDocument.characters, [], 'task-local design must not mutate the persisted Chat before atomic commit')
})

test('人物设计必须覆盖当前 MVU 人物模板，残缺投影不能写入变量', async function () {
  const toolResults = []
  let runtimeCalls = 0
  const legacyDocument = {
    spec: 'dsh-tavern.character-design-document', version: 1,
    characters: [{ id: 'character-1', name: fullCharacterDesign.name, aliases: [], design: {
      identity: fullCharacterDesign.identity, narrativeRole: fullCharacterDesign.narrativeRole,
      coreMotivation: fullCharacterDesign.coreMotivation, innerConflict: fullCharacterDesign.innerConflict,
      personality: fullCharacterDesign.personality, appearance: fullCharacterDesign.appearance,
      behaviorStyle: fullCharacterDesign.behaviorStyle, speechStyle: fullCharacterDesign.speechStyle,
      relationships: fullCharacterDesign.relationships, defaultPresentation: fullCharacterDesign.defaultPresentation,
      plotPotential: fullCharacterDesign.plotPotential
    } }]
  }
  const incompleteFields = { ...fullCharacterMvuFields, 袜子: '未明确', 鞋子: '未明确', 内衣裤: '未明确' }
  const module = createMvuSettlementModule({
    maxAttempts: 3,
    now: () => 100,
    model: { async run(input) {
      const index = JSON.parse(await input.onToolCall({ name: CHARACTER_DESIGN_READ_TOOL_NAME, arguments: {} }))
      assert.equal(index.characters[0].mvuCoverage.status, 'incomplete')
      assert.match(index.characters[0].mvuCoverage.error, /袜子.*未明确/)
      await input.onToolCall({ name: 'posture_submit', arguments: { posture: '站在走廊尽头' } })
      const legacyRejected = JSON.parse(await input.onToolCall({
        name: 'mvu_submit_update', arguments: { operations: [] }
      }))
      toolResults.push(legacyRejected)
      assert.equal(legacyRejected.ok, false)
      assert.match(legacyRejected.error, /character_design_save/)

      const rejectedDesign = JSON.parse(await input.onToolCall({
        name: CHARACTER_DESIGN_SAVE_TOOL_NAME,
        arguments: {
          ...fullCharacterDesign,
          mvuPath: '/在场女生/鹿野栞',
          mvuFields: { ...fullCharacterMvuFields, 袜子: '未明确' }
        }
      }))
      toolResults.push(rejectedDesign)
      assert.equal(rejectedDesign.ok, false)
      assert.match(rejectedDesign.error, /袜子.*未明确/)

      const saved = JSON.parse(await input.onToolCall({
        name: CHARACTER_DESIGN_SAVE_TOOL_NAME,
        arguments: {
          ...fullCharacterDesign,
          mvuPath: '/在场女生/鹿野栞', mvuFields: fullCharacterMvuFields
        }
      }))
      assert.equal(saved.ok, true)

      const rejectedUpdate = JSON.parse(await input.onToolCall({
        name: 'mvu_submit_update',
        arguments: {
          operations: [{
            op: 'insert', path: '/在场女生/鹿野栞',
            value: { ...fullCharacterMvuFields, 内衣裤: '未明确' }
          }]
        }
      }))
      toolResults.push(rejectedUpdate)
      assert.equal(rejectedUpdate.ok, false)
      assert.equal(rejectedUpdate.retryable, true)
      assert.match(rejectedUpdate.error, /内衣裤.*未明确/)

      const accepted = JSON.parse(await input.onToolCall({
        name: 'mvu_submit_update',
        arguments: { operations: [{ op: 'insert', path: '/在场女生/鹿野栞', value: fullCharacterMvuFields }] }
      }))
      assert.equal(accepted.ok, true)
      return { text: '' }
    } },
    runtime: { async settleMvuUpdate() {
      runtimeCalls++
      return {
        context: { messages: [{ variables: {
          stat_data: { 在场女生: { 鹿野栞: fullCharacterMvuFields } }, schema: characterVariableSchema
        } }] }
      }
    } }
  })

  const result = await module.settleVariables({
    operationId: 'operation-design-complete', chatId: 'chat-1', branchId: 'branch-1', basedOnRevision: 5,
    sessionId: 'session-1', messageId: 0, swipeId: 0, storyText: '鹿野栞在走廊尽头停下脚步。',
    currentVariables: {
      stat_data: { 在场女生: { 鹿野栞: incompleteFields } }, schema: characterVariableSchema
    },
    variableSchema: characterVariableSchema,
    characterDesignDocument: legacyDocument
  })

  assert.equal(runtimeCalls, 1, '残缺投影必须在调用 MVU Runtime 前被拒绝')
  assert.equal(toolResults.length, 3)
  assert.equal(result.receipt.status, 'updated')
})

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
    'posture_submit', CHARACTER_DESIGN_READ_TOOL_NAME, CHARACTER_DESIGN_SAVE_TOOL_NAME, 'mvu_submit_update'
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
