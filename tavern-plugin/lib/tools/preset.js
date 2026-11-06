import { defineTool } from '@deepseek-ai/dsh-tools'
import { normalizeResourcePath } from '../domain/file-resources.js'

export function registerPresetTools({
  chatForSession,
  presetEditor,
  tools,
}) {
  tools.register(defineTool({
    name: 'tavern_read_preset',
    description: '按 JSON Pointer 分段读取预设的原始工作 JSON。目标预设只用于编辑，不会应用到当前 Agent。',
    parameters: {
      path: { type: 'string', required: true, description: 'presets/... 相对路径' },
      pointer: { type: 'string', description: 'JSON Pointer，例如 /prompts/0；省略时读取根节点' },
      offset: { type: 'integer', description: '可选的 1 起始字符位置' },
      limit: { type: 'integer', description: '本次最多读取字符数，默认 6000，最大 12000' }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true }, pointer: { type: 'string', required: true }, text: { type: 'string', required: true },
          totalChars: { type: 'integer', required: true }, from: { type: 'integer', required: true }, to: { type: 'integer', required: true }, done: { type: 'boolean', required: true }
        }
      },
      render: function (_args, value) { return [{ type: 'text', text: '预设 ' + value.path + ' · ' + (value.pointer || '/') + ' · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字\n\n' + value.text }] }
    },
    isConcurrencySafe: function () { return true },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('预设只能在卡片工作台中读取')
      const normalized = normalizeResourcePath(args.path, 'preset')
      return await presetEditor.read(normalized, args)
    }
  }))

  tools.register(defineTool({
    name: 'tavern_update_preset',
    description: '按用户要求，以 JSON Pointer 修改预设的最小路径并重新校验。不会应用或运行目标预设。',
    parameters: {
      path: { type: 'string', required: true, description: 'presets/... 相对路径' },
      operations: {
        type: 'array', required: true,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            op: { type: 'string', required: true, enum: ['set', 'delete'] },
            path: { type: 'string', required: true, description: 'JSON Pointer，例如 /prompts/0/content' },
            value: { type: 'json', description: 'set 操作的新值；delete 时省略' }
          }
        }
      }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          path: { type: 'string', required: true }, changed: { type: 'array', required: true, items: { type: 'string' } },
          valid: { type: 'boolean', required: true }, recognized: { type: 'boolean', required: true }, promptCount: { type: 'integer', required: true },
          regexCount: { type: 'integer', required: true }, warning: { type: 'string', required: true }
        }
      },
      render: function (_args, value) { return [{ type: 'text', text: '预设已修改并通过 JSON 校验；变更 ' + value.changed.length + ' 个路径。目标预设仍未应用。' + (value.warning ? '\n诊断：' + value.warning : '') }] }
    },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const chat = await chatForSession(sessionId)
      if (chat === undefined || (chat.mode || 'story') !== 'card') throw new Error('预设只能在卡片工作台中修改')
      const normalized = normalizeResourcePath(args.path, 'preset')
      return await presetEditor.update(normalized, args.operations)
    }
  }))
}
