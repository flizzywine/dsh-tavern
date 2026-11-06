import { defineTool } from '@deepseek-ai/dsh-tools'
import { preserveRuntimeSource, projectAgentContent } from '../domain/runtime-content-projection.js'

export function registerScriptTool({
  chatForSession,
  readScript,
  scriptContinuity,
  str,
  tools,
}) {
  const scriptOutput = {
    type: 'object', additionalProperties: false,
    properties: {
      found: { type: 'boolean', required: true },
      message: { type: 'string', required: true },
      title: { type: 'string', required: true },
      totalChunks: { type: 'integer', required: true },
      from: { type: 'integer', required: true },
      to: { type: 'integer', required: true },
      cursor: { type: 'integer', required: true },
      chunks: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            number: { type: 'integer', required: true },
            text: { type: 'string', required: true }
          }
        }
      }
    }
  }
  tools.register(defineTool({
    name: 'tavern_read_script',
    description: '按需读取已绑定剧本。剧本游玩中优先读取当前游标附近；卡片设定中可检索整本剧本。',
    parameters: {
      path: { type: 'string', description: '卡片工作台中可指定剧本相对路径；游玩模式省略并读取当前人物卡绑定剧本' },
      query: { type: 'string', description: '可选关键词；剧本游玩只检索当前游标前后 10 块' },
      offset: { type: 'integer', description: '可选的 1 起始块号' },
      limit: { type: 'integer', description: '连续读取块数；游玩最多 21，卡片设定最多 6' }
    },
    output: {
      schema: scriptOutput,
      render: function (_args, value) {
        if (!value.found) return [{ type: 'text', text: value.message }]
        const body = value.chunks.map(function (chunk) { return '[' + chunk.id + ' · 第 ' + chunk.number + ' 块]\n' + chunk.text }).join('\n\n')
        return [{ type: 'text', text: '剧本《' + value.title + '》第 ' + value.from + '~' + value.to + ' 块 / 共 ' + value.totalChunks + ' 块\n\n' + body }]
      }
    },
    isConcurrencySafe: function () { return true },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined) return { found: false, message: '尚未选择人物卡。', title: '', totalChunks: 0, from: 0, to: 0, cursor: 0, chunks: [] }
      const mode = chat.mode || 'story'
      if (mode !== 'script' && mode !== 'card') throw new Error('当前模式不能读取剧本')
      const requestedPath = str(args.path).trim()
      const resourcePath = mode === 'card' && requestedPath !== '' ? requestedPath : str(chat.cardPath)
      if (resourcePath === '') return { found: false, message: '当前工作台尚未指定人物卡或剧本。', title: '', totalChunks: 0, from: 0, to: 0, cursor: 0, chunks: [] }
      const script = await readScript(resourcePath)
      if (script === undefined || !Array.isArray(script.chunks) || script.chunks.length === 0) return { found: false, message: '当前人物卡没有绑定剧本。', title: '', totalChunks: 0, from: 0, to: 0, cursor: 0, chunks: [] }
      const windowResult = scriptContinuity.inspect({
        script,
        state: chat.scriptState,
        request: { kind: mode === 'script' ? 'play' : 'read', query: args.query, offset: args.offset, limit: args.limit }
      })
      if (windowResult.notFound === true || windowResult.chunks.length === 0) {
        return {
          found: false,
          message: windowResult.notFound === true ? '没有找到包含该关键词的剧本分块。' : '剧本分块为空。',
          title: str(windowResult.title), totalChunks: Number(windowResult.total) || 0,
          from: 0, to: 0, cursor: Number(windowResult.cursor) || 0, chunks: []
        }
      }
          return {
            found: true, message: '', title: str(windowResult.title), totalChunks: Number(windowResult.total) || 0,
            from: Number(windowResult.from) || 0, to: Number(windowResult.to) || 0, cursor: Number(windowResult.cursor) || 0,
            chunks: windowResult.chunks.map(function (chunk) {
              const project = mode === 'card' ? preserveRuntimeSource : projectAgentContent
              const projected = project(chunk.text, { charName: str(chat.cardName), macroState: chat.macroState })
              return { id: str(chunk.id), number: Number(chunk.order) + 1, text: projected.agentText }
            })
          }
    }
  }))
}
