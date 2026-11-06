import { composeTavernRegexScripts } from '../domain/card-extension-reading.js'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { projectRuntimeReply } from '../domain/runtime-content-projection.js'
import { readPlayChatDebugTurn } from '../domain/play-chat-debug.js'

export function registerPlayChatTool({
  chatForSession,
  modelRequestLog,
  readCardExtensions,
  readChat,
  sessionDebugEvidence,
  str,
  tools,
  worldbookRecallLog,
  displayRuntimeStore,
}) {
  tools.register(defineTool({
    name: 'tavern_read_play_chat',
    description: '在卡片工作台中渐进读取当前工作台关联的游玩诊断。默认从最新一轮的小型 overview 开始；需要时可列出轮次、读取任意轮次或整场对话，并按层、分页获取文本、状态、日志、真实模型请求、正则诊断和 iframe 证据。',
    parameters: {
      ref: { type: 'string', description: '关联的游玩记录引用，例如 play-chat:chat-xxx；只有一个引用时可省略' },
      turn: { type: 'integer', description: '要读取的游玩轮次；省略时使用最新一轮' },
      layer: { type: 'string', enum: ['overview', 'turns', 'conversation', 'input', 'source', 'session', 'display', 'saved-display', 'diagnostics', 'tavern', 'foreground', 'background', 'request', 'worldbook', 'iframe', 'preset', 'context', 'regex'], description: '读取层：小型概览、轮次目录、整场对话、本轮玩家输入、模型原文、Session 文本、当前实时展示、保存时展示快照、当前正则诊断、Tavern 状态、前台 Agent、后台 Agent、真实模型请求、iframe 运行证据、本局预设快照、完整持久上下文或组合正则；默认 overview' },
      offset: { type: 'integer', description: '可选的 1 起始字符位置，默认 1' },
      limit: { type: 'integer', description: '本次最多读取字符数，默认 6000，最大 12000' }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          chatId: { type: 'string', required: true },
          turn: { type: 'integer', required: true },
          layer: { type: 'string', required: true },
          text: { type: 'string', required: true },
          totalChars: { type: 'integer', required: true },
          from: { type: 'integer', required: true },
          to: { type: 'integer', required: true },
          done: { type: 'boolean', required: true },
          cardSnapshotVersion: { type: 'integer', required: true },
          cardSnapshotDigest: { type: 'string', required: true }
        }
      },
      render: function (_args, value) {
        return [{ type: 'text', text: '游玩记录第 ' + value.turn + ' 轮 · ' + value.layer + ' · 第 ' + value.from + '~' + value.to + ' 字 / 共 ' + value.totalChars + ' 字 · 人物卡快照 v' + value.cardSnapshotVersion + ' (' + (value.cardSnapshotDigest || '无摘要') + ')\n\n' + value.text }]
      }
    },
    isConcurrencySafe: function () { return true },
    async execute(args, exec) {
      const sessionId = exec && exec.agent && exec.agent.session ? exec.agent.session.id : ''
      const editorChat = await chatForSession(sessionId)
      if (editorChat === undefined || (editorChat.mode || 'story') !== 'card') throw new Error('游玩记录只能在卡片工作台中读取')
      const references = Array.isArray(editorChat.workspace && editorChat.workspace.mountedResources)
        ? editorChat.workspace.mountedResources.filter(function (item) { return item && item.kind === 'play-chat' })
        : []
      const requestedRef = str(args.ref).trim()
      const reference = requestedRef === ''
        ? (references.length === 1 ? references[0] : null)
        : references.find(function (item) { return item.path === requestedRef })
      if (reference === null || reference === undefined) throw new Error(references.length > 1 ? '请指定要读取的游玩记录 ref' : '当前卡片工作台没有关联的游玩记录，请从对应游玩对话进入卡片调试')
      const sourceChat = await readChat(reference.chatId)
      if (sourceChat === undefined) throw new Error('游玩记录已不存在')
      let projector = null
      let regexScripts
      if (str(args.layer) === 'diagnostics' || str(args.layer) === 'display' || str(args.layer) === 'regex') {
        const extensions = await readCardExtensions(sourceChat.cardPath || editorChat.cardPath, sourceChat)
        regexScripts = composeTavernRegexScripts(extensions, sourceChat.runtimePresetSnapshot?.regexScripts, sourceChat.regexOverrides && sourceChat.regexOverrides.preset)
        projector = function (message) {
          return projectRuntimeReply(str(message.sourceText) || str(message.text), {
            charName: sourceChat.cardName,
            macroState: sourceChat.macroState,
            projectionText: Object.prototype.hasOwnProperty.call(message, 'projectionText') ? str(message.projectionText) : (str(message.sourceText) || str(message.text)),
            regexScripts,
            placement: 2,
            isEdit: false,
            depth: 0
          })
        }
      }
      const foregroundId = str(sourceChat.sessionId)
      const backgroundId = str(sourceChat.timeline && sourceChat.timeline.participants && sourceChat.timeline.participants.background && sourceChat.timeline.participants.background.sessionId) || str(sourceChat.candidateAgent && sourceChat.candidateAgent.sessionId)
      return readPlayChatDebugTurn(editorChat, sourceChat, reference, args, projector, {
        regex: regexScripts,
        foreground: sessionDebugEvidence(foregroundId),
        background: sessionDebugEvidence(backgroundId),
        worldbook: args.layer === 'worldbook' ? await worldbookRecallLog.read(sourceChat, args.turn || reference.turn) : undefined,
        displayRuntime: args.layer === 'iframe' && displayRuntimeStore ? await displayRuntimeStore.read(sourceChat.id, Number(args.turn || reference.turn)) : undefined,
        requests: await modelRequestLog.evidence(sourceChat.id, args.turn || reference.turn)
      })
    }
  }))
}
