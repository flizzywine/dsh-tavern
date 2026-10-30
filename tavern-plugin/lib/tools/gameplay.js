import { HISTORY_RECALL_OUTPUT_SCHEMA, HISTORY_RECALL_TOOL, renderHistoryRecall } from '../domain/history-recall.js'
import { createDiceTool } from './dice.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshParameterFields } from '../domain/dsh-tool-schema.js'

export function registerGameplayTools({
  authorizeMod,
  activeTurnOf,
  chatForSession,
  isBackground,
  cardResponseTest,
  foregroundRecallScopes,
  recallHistoryForSession,
  tools,
}) {
  tools.register(defineTool(createDiceTool({ activeTurnOf, chatForSession, isBackground, authorizeMod })))
  tools.register(defineTool({
    name: 'tavern_test_response',
    description: '用正式游玩 API 为已保存人物卡创建独立测试存档，按保存的案例逐轮调用模型并检查拒绝信号。configure 保存案例，start 启动，status 查询（最多等待 10 秒），cancel 停止。最长 5 分钟；真实调用产生费用。不支持浏览器脚本卡。未发现拒绝不等于内容合规。',
    parameters: {
      action: { type: 'string', enum: ['configure', 'start', 'status', 'cancel'], required: true },
      name: { type: 'string', description: 'configure 必填，案例名称。' },
      caseId: { type: 'string', description: 'start 必填，configure 返回的案例 ID。' },
      sourceCard: { type: 'string', description: 'configure 必填，库中人物卡文件名，不含 cards/。' },
      provider: { type: 'string', description: 'configure 必填，用户指定的 provider。' },
      model: { type: 'string', description: 'configure 必填，用户指定的模型。' },
      reasoningEffort: { type: 'string' },
      steps: { type: 'array', description: 'configure 必填，1 至 10 轮。首轮 input；后续可 input 或 inputFrom 二选一。candidates 表示本轮后生成候选项。', items: { type: 'object', additionalProperties: false, properties: {
        input: { type: 'string' },
        inputFrom: { type: 'object', additionalProperties: false, properties: { candidate: { type: 'integer', required: true }, type: { type: 'string', enum: ['action', 'scene'] } } },
        candidates: { type: 'boolean' }
      } } },
      sessionId: { type: 'string', description: 'status/cancel 必填，start 返回的测试会话 ID。' }
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
      render: function (_args, value) { return [{ type: 'text', text: value.report }] }
    },
    isConcurrencySafe: function () { return false },
    async execute(args, exec) {
      return { report: JSON.stringify(await cardResponseTest.execute(exec?.agent?.session?.id || '', args), null, 2) }
    }
  }))
  tools.register(defineTool({
    name: HISTORY_RECALL_TOOL.name,
    description: HISTORY_RECALL_TOOL.description,
    parameters: dshParameterFields(HISTORY_RECALL_TOOL.parameters),
    output: {
      schema: HISTORY_RECALL_OUTPUT_SCHEMA,
      render: function (_args, value) { return [{ type: 'text', text: renderHistoryRecall(value) }] }
    },
    isConcurrencySafe: function () { return true },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const session = exec?.agent?.session
      const turn = activeTurnOf(exec)
      let scope
      if (session && turn > 0) {
        scope = foregroundRecallScopes.get(session)
        if (!scope || scope.turn !== turn) {
          scope = { turn }
          foregroundRecallScopes.set(session, scope)
        }
      }
      return await recallHistoryForSession(sessionId, args, scope, 'foreground')
    }
  }))
}
