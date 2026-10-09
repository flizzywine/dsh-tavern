import { createImportContextPreparation, needsImportContextPreparation } from '../domain/import-context-preparation.js'
import { createStoryCompactionRequest, nativelyRetainedRounds, retainRecentStoryRounds, usesStoryCompaction } from '../domain/story-compaction.js'
import { installCompactionRequestProjection } from '../domain/compaction-request.js'
import { installWorkspaceInstructionPresentation } from '../domain/workspace-instruction-presentation.js'
import { presentModelError } from '../domain/model-error-presentation.js'
import { markRequestHandled, requestHandledBy } from '../domain/request-lineage.js'

export function registerModelStreamHooks({
  agentRegistry,
  backgroundAgentRunner,
  chatForSession,
  chatHeaderForSession,
  ctx,
  foregroundStrategies,
  fullTemplateRuntime,
  modelRequestLog,
  pluginCompactionNotes,
  requestCoordinates,
  storyRetention,
  runtimePrompt,
  sessionStateForSession,
  sessionStore,
  str,
  updateChat,
  worldbookRecallLog,
}) {
  const importContextPreparation = createImportContextPreparation({
    readChat: chatForSession, readHeader: chatHeaderForSession, updateChat,
    getSession: id => sessionStore.get(id) || agentRegistry.get(id)?.session,
    flush: session => sessionStore.flush(session),
    modelInfo: request => ctx.llm.resolveModelInfo(request.provider, request.model, request.signal),
    estimateMessage: message => {
      const meter = ctx.get('tokenMeter')
      if (!meter?.estimateMessage) throw new Error('当前宿主缺少原生 token 计量接口，请更新 DSH 后重试')
      const native = meter.estimateMessage(message)
      // The host's fixed four-characters/token estimate underprices CJK text.
      // Use a conservative Unicode floor for this one-time admission check.
      const text = (message.content || []).map(block => block.text || JSON.stringify(block)).join('')
      const nonAscii = [...text].filter(char => char.codePointAt(0) > 127).length
      return Math.max(native, Math.ceil((text.length - nonAscii) / 4) + nonAscii * 2 + 8)
    }
  })
  installWorkspaceInstructionPresentation(ctx, async sessionId => {
    if (backgroundAgentRunner.owns(sessionId)) return true
    const chat = await sessionStateForSession(sessionId)
    return Boolean(chat)
  })
  installCompactionRequestProjection(ctx, async sessionId => backgroundAgentRunner.owns(sessionId) || Boolean(await sessionStateForSession(sessionId)), async request => {
    // Story/script chats summarize with the story prompt and keep the latest rounds
    // verbatim after the summary; other sessions keep DSH's prompt.
    const chat = await chatForSession(str(request.sessionId))
    if (!usesStoryCompaction(chat)) return { request }
    if (needsImportContextPreparation(chat)) throw new Error('导入对话尚未完成首次上下文容量检查，暂不调用摘要模型')
    // Seam to the plugin layer: plugins may add what the summary must keep.
    const notes = pluginCompactionNotes ? await pluginCompactionNotes({ gameId: str(request.sessionId) }).catch(() => []) : []
    const instruction = [runtimePrompt('story-compaction'), ...(notes.length ? ['【插件附加的摘要要求】', ...notes.map(note => note.text)] : [])].join('\n\n')
    const story = createStoryCompactionRequest(request, instruction)
    const session = sessionStore.get(story.sessionId) || agentRegistry.get(story.sessionId)?.session
    const retention = await storyRetention(story)
    return retainRecentStoryRounds(story, retention.rounds - nativelyRetainedRounds(session, story), retention)
  })

  ctx.on('llm/stream', function (options, next) {
    const sessionId = str(options && options.sessionId)
    const coordinates = requestCoordinates.get(sessionId)
    if (coordinates !== undefined) {
      requestCoordinates.set(sessionId, Object.assign({}, coordinates, {
        source: { kind: 'model', provider: str(options.provider), model: str(options.model) }
      }))
    }
    const projectedRequest = (requestHandledBy(options, 'full-template') || importContextPreparation.isPrepared(options)) ? null : foregroundStrategies.projectRequest(options, coordinates)
    if (projectedRequest !== null) return ctx.llm.stream(projectedRequest)
    const stream = next()
    const backgroundContext = backgroundAgentRunner.requestContext(sessionId)
    const ownerSessionId = backgroundContext ? backgroundContext.parentSessionId : sessionId
    return (async function * () {
      const prepared = await importContextPreparation.prepare(options)
      if (prepared !== options) { yield * ctx.llm.stream(prepared); return }
      const chat = ownerSessionId === '' ? undefined : await chatHeaderForSession(ownerSessionId, [
        'requestMode', 'compatibilityTraces', 'bypassPlanId', 'runtimePresetSnapshot', 'foregroundFrames'
      ])
      if (chat && ['story', 'script'].includes(chat.mode) && options.purpose === undefined && chat.requestMode !== 'sillytavern' && !requestHandledBy(options, 'full-template')) {
        const projected = await fullTemplateRuntime.forSession(ownerSessionId).projectRequestProjection({ messages: options.messages, system: options.system, model: options.model })
        yield * ctx.llm.stream(markRequestHandled({ ...options, ...projected }, 'full-template'))
        return
      }
      let requestRecord = null
      if (options.purpose === undefined && chat !== undefined && ['story', 'script', 'card'].includes(chat.mode)) {
        const coordinates = requestCoordinates.get(sessionId) || {}
        requestRecord = await modelRequestLog.record({ chat, context: backgroundContext, coordinates, options })
        if (!backgroundContext && ['story', 'script'].includes(chat.mode)) {
          // Evidence only: scanning a multi-MB request must not delay the first token.
          worldbookRecallLog.requested(chat, options, requestRecord.id)
            .catch(error => console.warn('dsh-tavern: 世界书请求日志关联失败', String(error?.message || error)))
        }
      }
      let responseText = ''
      let finish = null
      let failure = null
      try {
        for await (const chunk of stream) {
          if (chunk && chunk.type === 'text-delta') responseText += str(chunk.text)
          if (chunk && chunk.type === 'finish') finish = chunk.reason === undefined ? chunk : chunk.reason
          yield chunk
        }
      } catch (error) {
        const displayedError = chat ? presentModelError(error) : error
        failure = str(displayedError && displayedError.message || displayedError)
        throw displayedError
      } finally {
        const completed = finish && finish.kind !== 'error' && finish.kind !== 'aborted'
        foregroundStrategies.completeRequest(options, completed)
        if (chat && requestRecord) {
          try { await modelRequestLog.complete({ chatId: chat.id, id: requestRecord.id, text: responseText, finish, error: failure }) }
          catch (error) { console.error('dsh-tavern: 模型结果日志写入失败', str(error && error.message || error)) }
        }
      }
    })()
  }, { global: true })
}
