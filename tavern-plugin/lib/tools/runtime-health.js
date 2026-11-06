import { defineTool } from '@deepseek-ai/dsh-tools'

export function registerRuntimeHealthTool({ chatForSession, runtimeHealth, tools }) {
  // Tavern itself, not a card: slow requests and where the time went, recent Tavern errors, the runtime.
  tools.register(defineTool({
    name: 'tavern_read_runtime_health',
    description: '读取酒馆自身的运行状况（不是人物卡）：最近页面请求的服务端耗时与慢请求的阶段分解、酒馆最近的警告和报错、版本与运行环境。用于排查“太卡太慢”、报错或功能异常是否出在酒馆本身。不含模型生成耗时和浏览器渲染卡顿。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { report: { type: 'string', required: true } } },
      render: function (_args, value) { return [{ type: 'text', text: value.report }] }
    },
    isConcurrencySafe: function () { return true },
    async execute(_args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const editorChat = await chatForSession(sessionId)
      if (editorChat === undefined || (editorChat.mode || 'story') !== 'card') throw new Error('酒馆运行状况只能在卡片工作台中读取')
      return { report: JSON.stringify(runtimeHealth(), null, 2) }
    }
  }))
}
