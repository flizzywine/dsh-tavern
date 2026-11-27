import { promptSection } from '../domain/prompt-section.js'
import { createModelStreamProgress } from '../domain/model-stream-progress.js'
import { assertFrozenStageRequest } from '../domain/stage-shared-context.js'
import { createImportContextPreparation, needsImportContextPreparation } from '../domain/import-context-preparation.js'
import { createStoryCompactionRequest, nativelyRetainedRounds, retainRecentStoryRounds, storyVolumeMerge, storyVolumePlan, usesStoryCompaction } from '../domain/story-compaction.js'
import { installCompactionRequestProjection } from '../domain/compaction-request.js'
import { installPrefixBoundReasoningProjection } from '../domain/prefix-bound-reasoning.js'
import { omitEmptyProviderContent } from '../domain/provider-message-content.js'
import { omitUnusedToolHistory } from '../domain/tool-history-presentation.js'
import { foregroundStyleReferenceEnabled } from '../domain/style-reference.js'
import { projectWithoutStyleReference } from '../domain/style-reference-request.js'
import legacySeeds from '../domain/session-seed-trajectory.cjs'
import { installWorkspaceInstructionPresentation } from '../domain/workspace-instruction-presentation.js'
import { isTavernAgentSession } from '../domain/tavern-agent-scope.js'
import { presentModelError } from '../domain/model-error-presentation.js'
import { markRequestHandled, requestHandledBy } from '../domain/request-lineage.js'
import { bodyGenerationFailure } from '../domain/body-generation-failure.js'
import { toolProtocolDirectiveOf } from '../domain/foreground-orchestration-strategies.js'
import { STORY_CONTEXT_TOOL_NAME, STORY_SUBMIT_TOOL_NAME } from '../domain/story-tool-submission.js'
import { isAutoToolOnlyModel, runWithToolProtocolDirective } from '../domain/tool-protocol-enforcement.js'
import { createToolReplyStreamTracker } from '../domain/tool-reply-stream-parser.js'
import { projectWritingPreparationRequest, PURE_WRITING_REQUEST, WRITING_PREPARATION_REQUEST } from '../domain/pure-writing-request.js'

// Prompt prose source. Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "Plugin summary requirements:"
})

const { tavernIsLegacySeedTrajectory } = legacySeeds

export function applyCompactionModel(request, selection) {
  if (!selection?.provider || !selection?.model) return request
  const next = { ...request, provider: selection.provider, model: selection.model }
  if (typeof selection.reasoningEffort === 'string' && selection.reasoningEffort) next.reasoningEffort = selection.reasoningEffort
  else delete next.reasoningEffort
  return next
}

function writingPreparationStreamFilter(receiveVariableReply) {
  const textByIndex = new Map()
  const replyBlocks = new Map()
  const limit = 2048
  let toolCall = false
  return chunk => {
    const isText = chunk.type === 'text-delta' || (chunk.type === 'block-start' && chunk.blockType === 'text')
      || (chunk.type === 'block-end' && chunk.block?.type === 'text')
    if (Number.isInteger(chunk.index) && !textByIndex.has(chunk.index)) textByIndex.set(chunk.index, isText)
    if (receiveVariableReply) {
      if (chunk.type === 'tool-call-delta' || chunk.blockType === 'tool-call' || chunk.block?.type === 'tool-call') toolCall = true
      if (!toolCall && isText && chunk.type !== 'block-start') {
        const index = chunk.index ?? 0
        const value = chunk.type === 'block-end' ? chunk.block.text : (replyBlocks.get(index) || '') + chunk.text
        replyBlocks.set(index, String(value ?? '').slice(0, limit + 1))
      }
      if (!toolCall && chunk.type === 'finish' && (chunk.reason ?? chunk).kind === 'stop') {
        const reply = [...replyBlocks].sort(([a], [b]) => a - b).map(([, value]) => value).join('')
        if (reply.length <= limit) receiveVariableReply(reply)
      }
    }
    if (isText) return null
    if (chunk.type !== 'finish' || !Array.isArray(chunk.replayState?.blocks)) return chunk
    const textBlocks = [...textByIndex.values()]
    if (!textBlocks.some(Boolean)) return chunk
    // Replay entries are positional in the original response, including the removed text.
    const { replayState, ...finish } = chunk
    if (replayState.blocks.length !== textBlocks.length) return finish
    return { ...finish, replayState: { ...replayState, blocks: replayState.blocks.filter((_, index) => !textBlocks[index]) } }
  }
}

export function registerModelStreamHooks({
  agentRegistry,
  pluginBodyGeneration,
  backgroundAgentRunner,
  chatForSession,
  chatHeaderForSession,
  compactionModel,
  ctx,
  foregroundStrategies,
  fullTemplateRuntime,
  modelRequestLog,
  modelSelection,
  pluginCompactionNotes,
  pluginSettlementProgress,
  replyStarted,
  replyStreamRewriters,
  requestCoordinates,
  storyRetention,
  runtimePrompt,
  sessionStateForSession,
  recentStateForSession,
  sessionStore,
  str,
  updateChat,
  worldbookRecallLog,
  openReplyObservers,
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
  // Whether a session is a Tavern game: its header answers that, not its history.
  const isGame = async sessionId => Boolean(await chatHeaderForSession(str(sessionId), []))
  const ownsSession = async sessionId => backgroundAgentRunner.owns(sessionId) || await isGame(sessionId)
  // Keep scripted openings from old saves out of request and compaction context.
  ctx.on('llm/stream', (request, next) => {
    if (!request?.messages?.some(tavernIsLegacySeedTrajectory)) return next()
    return ctx.llm.stream({ ...request, messages: request.messages.filter(message => !tavernIsLegacySeedTrajectory(message)) })
  }, { prepend: true })
  // Compaction keeps its newest replies after the summary, behind a prefix they were not signed against.
  installPrefixBoundReasoningProjection(ctx, { ownsSession, session: id => sessionStore.get(id) || agentRegistry.get(id)?.session || backgroundAgentRunner.requestSession(id) })
  installWorkspaceInstructionPresentation(ctx, sessionId => isTavernAgentSession(sessionId, {
    isGame, isBackground: id => backgroundAgentRunner.owns(id),
    readHeader: id => (sessionStore.get(id) || agentRegistry.get(id)?.session)?.header
  }))
  installCompactionRequestProjection(ctx, ownsSession, async request => {
    // 前台对话压缩优先使用全局设置的专用压缩模型；后台 Agent 保持各自任务模型。
    const foreground = !backgroundAgentRunner.owns(request.sessionId)
    let routed = foreground && typeof compactionModel === 'function'
      ? applyCompactionModel(request, await compactionModel())
      : request
    // Story/script chats summarize with the story prompt and keep the latest rounds
    // verbatim after the summary; other sessions keep DSH's prompt.
    const head = await chatHeaderForSession(str(request.sessionId), ['backgroundTasks', 'disabledForegroundTools'])
    if (!usesStoryCompaction(head)) return { request: routed }
    if (foreground && !foregroundStyleReferenceEnabled(head)) routed = projectWithoutStyleReference(routed)
    // An imported game compacts right away: an oversized history is summarized in segments
    // (bounded-compaction.js), so the first-play capacity check is not a precondition.
    // Seam to the plugin layer: plugins may add what the summary must keep.
    const notes = pluginCompactionNotes ? await pluginCompactionNotes({ gameId: str(request.sessionId) }).catch(() => []) : []
    const session = sessionStore.get(request.sessionId) || agentRegistry.get(request.sessionId)?.session
    // 保留轮数与前情卷预算仍按前台会话自身模型窗口计算，实际摘要与合并请求走 routed（压缩专用模型）。
    const retention = await storyRetention(request)
    const natively = nativelyRetainedRounds(session, request)
    // Which story turns this compaction folds: everything but the rounds kept verbatim.
    const kept = retainRecentStoryRounds(request, retention.rounds - natively, retention).kept || 0
    // The turn the summary folds through is a few rounds from the end: the latest floors
    // hold it; the whole history only where storage cannot read those alone.
    const back = kept + natively
    const recent = await recentStateForSession(str(request.sessionId), 2 * back + 8)
    const recentTurns = (recent?.messages || []).filter(message => message?.role === 'assistant' && Number(message.turn) > 0).map(message => Number(message.turn))
    const turns = recent && (recent.messagesFrom === 0 || recentTurns.length > back) ? recentTurns
      : ((await chatForSession(str(request.sessionId)))?.messages || []).filter(message => message?.role === 'assistant' && Number(message.turn) > 0).map(message => Number(message.turn))
    const volumes = storyVolumePlan(request, { through: turns[turns.length - 1 - kept - natively], budget: retention.volumeBudget, estimate: retention.estimate })
    const instruction = [runtimePrompt('story-compaction'), volumes.instruction, ...(notes.length ? [promptSection('plugin_compaction', [PROMPT_PROSE.p001, ...notes.map(note => note.text)].join('\n\n'))] : [])].join('\n\n')
    const story = createStoryCompactionRequest(routed, instruction)
    let prefix = volumes.prefix
    if (volumes.merge) {
      // Only the oldest volumes are rewritten, in their own call; a failed merge keeps them all.
      try { prefix = [prefix[0], await mergeStoryVolumes(volumes.merge, routed), ...prefix.slice(1)] }
      catch (error) {
        console.warn('dsh-tavern: 合并旧卷失败，本次原样保留全部旧卷：', error?.message || error)
        prefix = [prefix[0], ...volumes.merge.volumes.map(volume => volume.text), ...prefix.slice(1)]
      }
    }
    return { ...retainRecentStoryRounds(story, retention.rounds - natively, retention), prefix }
  })
  async function mergeStoryVolumes(merge, request) {
    const { header, prompt } = storyVolumeMerge(merge)
    let text = ''
    for await (const event of ctx.llm.stream({ provider: request.provider, model: request.model, purpose: 'compaction', signal: request.signal,
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
      ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
      messages: [{ id: 'tavern-story-volume-merge', role: 'user', content: [{ type: 'text', text: prompt }] }] })) {
      if (event?.type === 'block-end' && event.block?.type === 'text') text += event.block.text
      if (event?.type === 'finish' && event.reason?.kind !== 'stop') throw new Error('合并未完成：' + (event.reason?.failure?.message || event.reason?.kind))
    }
    text = text.trim()
    if (!text) throw new Error('合并没有返回文字')
    return text.startsWith('【前情总览') ? text : header + '\n' + text
  }

  async function gameChildSession(sessionId) {
    const parentSessionId = str((sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session)?.header?.parentSession)
    if (!parentSessionId || parentSessionId === sessionId || backgroundAgentRunner.owns(parentSessionId)) return null
    const chat = await chatHeaderForSession(parentSessionId, ['requestMode', 'compatibilityTraces', 'bypassPlanId', 'runtimePresetSnapshot'])
    if (!chat || !['story', 'script'].includes(chat.mode)) return null
    return { chat, context: { scope: 'background', task: 'subagent', parentSessionId, turn: await latestLoggedTurn(chat.id) } }
  }
  // A request that carries no turn is filed under the game's latest turn so old bodies are pruned with the rest.
  async function latestLoggedTurn(chatId) {
    return (await modelRequestLog.list(chatId)).reduce((latest, entry) => Math.max(latest, Number(entry.turn) || 0), 0)
  }
  ctx.on('llm/stream', function (options, next) {
    const sessionId = str(options && options.sessionId)
    const coordinates = requestCoordinates.get(sessionId)
    if (coordinates !== undefined) {
      requestCoordinates.set(sessionId, Object.assign({}, coordinates, {
        source: { kind: 'model', provider: str(options.provider), model: str(options.model) }
      }))
    }
    const backgroundContext = backgroundAgentRunner.requestContext(sessionId)
    const writingContext = backgroundContext?.writingPreparation
    if (options.purpose === undefined && writingContext && !requestHandledBy(options, WRITING_PREPARATION_REQUEST)) {
      return ctx.llm.stream(markRequestHandled(projectWritingPreparationRequest(options, writingContext), WRITING_PREPARATION_REQUEST))
    }
    if (options.purpose === undefined && !requestHandledBy(options, PURE_WRITING_REQUEST) && foregroundStrategies.pureWritingTurn?.(sessionId)) {
      return (async function * () {
        yield * ctx.llm.stream(await foregroundStrategies.prepareWritingRequest(options))
      })()
    }
    const projectedRequest = (!writingContext && !requestHandledBy(options, 'full-template') && !importContextPreparation.isPrepared(options))
      ? foregroundStrategies.projectRequest(options, coordinates) : null
    if (projectedRequest !== null) return ctx.llm.stream(projectedRequest)
    const ownerSessionId = backgroundContext ? backgroundContext.parentSessionId : sessionId
    return (async function * () {
      const writingPreparation = requestHandledBy(options, WRITING_PREPARATION_REQUEST)
      const pureWriting = requestHandledBy(options, PURE_WRITING_REQUEST) || writingPreparation
      if (!pureWriting && !backgroundContext && options.purpose === undefined && pluginBodyGeneration) {
        const session = sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
        const direct = await pluginBodyGeneration.direct(session, options.signal)
        if (direct) { yield * direct; return }
      }
      // a director already owns frozen, projected sources.
      const director = backgroundContext?.task === 'stage-director'
      if (director) assertFrozenStageRequest(backgroundContext, options)
      const prepared = director || pureWriting ? options : await importContextPreparation.prepare(options)
      if (prepared !== options) { yield * ctx.llm.stream(prepared); return }
      const chat = ownerSessionId === '' ? undefined : await chatHeaderForSession(ownerSessionId, [
        'requestMode', 'compatibilityTraces', 'bypassPlanId', 'runtimePresetSnapshot', 'foregroundFrames'
      ])
      const renderTemplate = !pureWriting || (!writingPreparation && Boolean(chat?.runtimePresetSnapshot))
      if (renderTemplate && !director && chat && ['story', 'script'].includes(chat.mode) && options.purpose === undefined && chat.requestMode !== 'sillytavern' && !requestHandledBy(options, 'full-template')) {
        const projected = await fullTemplateRuntime.forSession(ownerSessionId).projectRequestProjection({ messages: options.messages, system: options.system, model: options.model })
        yield * ctx.llm.stream(markRequestHandled({ ...options, ...projected }, 'full-template'))
        return
      }
      // Agents a plugin creates under a game are not Tavern's own sessions; log them
      // as that game's background requests so 完整上下文 can show them.
      const child = options.purpose === undefined && !backgroundContext && !chat ? await gameChildSession(sessionId) : null
      // Templates can erase text after the history projection. Check the final
      // Tavern request before recording it or starting the downstream stream.
      if (chat || backgroundContext || child || requestHandledBy(options, 'compaction-projection')) {
        const cleaned = omitUnusedToolHistory(omitEmptyProviderContent(options))
        if (cleaned !== options) { yield * ctx.llm.stream(cleaned); return }
      }
      const baseDirective = options.purpose === undefined ? toolProtocolDirectiveOf(options) : null
      const activeModel = str(options.model || baseDirective?.model)
      const activeDirective = baseDirective
        ? Object.freeze({
            ...baseDirective,
            provider: str(options.provider || baseDirective.provider),
            model: activeModel,
            forceToolChoice: baseDirective.storyOutputToolCall === true && !isAutoToolOnlyModel(activeModel),
            ...(Array.isArray(options.tools)
              ? {
                  allowedToolNames: options.tools
                    .map(tool => str(tool?.name))
                    .filter(name => name !== '' && name !== STORY_CONTEXT_TOOL_NAME)
                }
              : {})
          })
        : null
      const stream = runWithToolProtocolDirective(activeDirective, () => next())
      let requestRecord = null
      if (child) requestRecord = await modelRequestLog.record({ chat: child.chat, context: child.context, coordinates: {}, options })
      // Dev diagnostics: the summary request actually sent (after routing and story projection).
      else if (options.purpose === 'compaction' && requestHandledBy(options, 'compaction-projection') && chat !== undefined && ['story', 'script', 'card'].includes(chat.mode)) {
        const turn = backgroundContext ? Number(backgroundContext.turn) || 0 : await latestLoggedTurn(chat.id)
        requestRecord = await modelRequestLog.record({ chat, context: { ...backgroundContext, task: 'compaction', turn }, coordinates: { turn }, options })
      } else if (options.purpose === undefined && chat !== undefined && ['story', 'script', 'card'].includes(chat.mode)) {
        const coordinates = requestCoordinates.get(sessionId) || {}
        const systemSections = !backgroundContext ? foregroundStrategies.systemSectionsFor?.(sessionId, options.system) : undefined
        requestRecord = await modelRequestLog.record({ chat, context: backgroundContext, coordinates, options, ...(systemSections?.length ? { systemSections } : {}) })
        if (!backgroundContext && ['story', 'script'].includes(chat.mode)) {
          // Evidence only: scanning a multi-MB request must not delay the first token.
          // Calling an async function directly still runs its synchronous prefix here:
          // prompt concatenation and output matching belong after the provider stream starts.
          void Promise.resolve().then(() => worldbookRecallLog.requested(chat, options, requestRecord.id))
            .catch(error => console.warn('dsh-tavern: 世界书请求日志关联失败', String(error?.message || error)))
        }
      }
      const progress = child ? event => pluginSettlementProgress?.model(child.context.parentSessionId, event) : () => {}
      progress('start')
      // The story reply of a turn started streaming (正文开始; once per turn, see index.js).
      if (!backgroundContext && !child && options.purpose === undefined && ['story', 'script'].includes(chat?.mode)) replyStarted?.(sessionId, requestCoordinates.get(sessionId)?.turn)
      let responseText = ''
      let toolStreamedText = ''
      const toolReplyTracker = createToolReplyStreamTracker(STORY_SUBMIT_TOOL_NAME)
      // A provider can end after emitting visible prose with finish_reason=error,
      // or drop the terminal chunk altogether. The host normally records only an
      // assistant/attempt for those turns, and the failed-turn cleanup then removes
      // the story placeholder: the player watches a reply vanish after it streamed.
      // Let the ordinary max-tokens path commit that visible prefix instead. Content
      // moderation is deliberately excluded; its interrupted text stays discarded.
      const preservePartial = !backgroundContext && !child && options.purpose === undefined && ['story', 'script'].includes(chat?.mode)
      function recoveredFinish(reason) {
        if (!preservePartial || responseText.trim() === '' || options.signal?.aborted) return null
        const kind = typeof reason?.kind === 'string' ? reason.kind : ''
        if (kind === 'aborted' || kind === 'content-filter') return null
        const failure = reason?.failure || reason?.error || reason
        if (bodyGenerationFailure(failure).category === 'content-filter') return null
        return { kind: 'max-tokens', recoveredFrom: kind === 'error' ? 'error' : 'interrupted' }
      }
      // Optional observers initialize independently; they never hold up model tokens.
      const replyObserver = openReplyObservers?.({signal:options.signal, sessionId:ownerSessionId,
        turn:requestCoordinates.get(sessionId)?.turn,
        enabled:!backgroundContext && !child && options.purpose === undefined && ['story','script'].includes(chat?.mode)})
      // 正文流式润色：插件注册了改写器时，text-delta 先攒成安全段落、改写后再往前端吐。
      // 工具提交的正文（submit_story 的 JSON 参数）不经过这里，那种模式仍走结算后替换。
      const rewriter = !backgroundContext && !child && options.purpose === undefined
        && chat && ['story', 'script'].includes(chat.mode) && !activeDirective?.storyOutputToolCall
        ? replyStreamRewriters?.pick()
        : null
      const rewriteContext = {
        sessionId: ownerSessionId,
        chatId: chat?.id,
        turn: requestCoordinates.get(sessionId)?.turn,
        mode: chat?.mode,
        signal: options.signal
      }
      const openRewrite = () => replyStreamRewriters.open(rewriteContext, rewriter)
      const openBlocks = new Map()
      const replyBlocks = []
      function rewriteBlock(index) {
        const key = index ?? 0
        if (!openBlocks.has(key)) {
          const block = { index, stream: openRewrite(), source: '', text: '' }
          openBlocks.set(key, block)
          replyBlocks.push(block)
        }
        return openBlocks.get(key)
      }
      function appendRewritten(block, text) {
        block.text += text
        responseText += text
        if (text) replyObserver?.append(text)
      }
      function rewriteDelta(block, text) {
        return { type: 'text-delta', ...(block.index == null ? {} : { index: block.index }), text }
      }
      async function* flushRewriteBlocks() {
        for (const block of openBlocks.values()) {
          const rest = await block.stream.drain()
          appendRewritten(block, rest)
          if (rest) yield rewriteDelta(block, rest)
        }
        openBlocks.clear()
      }
      let finish = null, usage = null
      const filterPreparation = writingPreparation ? writingPreparationStreamFilter(writingContext?.receiveVariableReply) : null
      let failure = null, interrupted = false
      const liveness = createModelStreamProgress({signal:options.signal})
      let iterator, exhausted = false
      try {
        liveness.provider()
        iterator = runWithToolProtocolDirective(activeDirective, () => stream[Symbol.asyncIterator]())
        while (true) {
          const item = await liveness.wait(runWithToolProtocolDirective(activeDirective, () => iterator.next()))
          if (item.done) {exhausted = true; break}
          let chunk = item.value
          liveness.chunk(chunk)
          if (filterPreparation && chunk) {
            chunk = filterPreparation(chunk)
            if (chunk === null) continue
          }
          if (rewriter && chunk?.type === 'block-start' && chunk.blockType === 'text') rewriteBlock(chunk.index)
          if (chunk?.type === 'text-delta') {
            const delta = str(chunk.text)
            if (rewriter) {
              const block = rewriteBlock(chunk.index)
              block.source += delta
              const rewritten = block.stream.push(delta)
              if (!rewritten) { progress('output'); continue }
              appendRewritten(block, rewritten)
              chunk = { ...chunk, text: rewritten }
            } else {
              responseText += delta
              if (!activeDirective?.storyOutputToolCall) replyObserver?.append(delta)
            }
          }
          if (rewriter && chunk?.type === 'block-end' && chunk.block?.type === 'text') {
            const block = rewriteBlock(chunk.index)
            const complete = str(chunk.block.text)
            // block-end can carry text that was never sent as deltas.
            if (complete.startsWith(block.source)) {
              const rest = block.stream.push(complete.slice(block.source.length)) + await block.stream.drain()
              appendRewritten(block, rest)
              if (rest) yield rewriteDelta(block, rest)
            } else {
              // The final block supersedes divergent deltas. Do not append the
              // replacement to deltas the consumer has already received.
              block.stream.abort()
              const replacement = openRewrite()
              block.text = replacement.push(complete) + await replacement.drain()
            }
            chunk = { ...chunk, block: { ...chunk.block, text: block.text } }
            openBlocks.delete(chunk.index ?? 0)
          }
          if (chunk?.type === 'finish') yield* flushRewriteBlocks()
          if (chunk && chunk.type === 'tool-call-delta') {
            const extracted = toolReplyTracker.pushToolDelta(chunk)
            if (extracted.matched && extracted.contentDelta !== '') {
              toolStreamedText += extracted.contentDelta
              replyObserver?.append(extracted.contentDelta)
            }
          }
          if (chunk && chunk.type === 'finish') {
            const reason = chunk.reason === undefined ? chunk : chunk.reason
            const recovered = reason?.kind === 'error' ? recoveredFinish(reason) : null
            if (recovered) {
              chunk = chunk.reason === undefined ? { ...chunk, ...recovered } : { ...chunk, reason: recovered }
              finish = recovered
            } else finish = reason
          }
          // Dev diagnostics: provider-reported tokens, including prompt-cache reads/writes.
          if (chunk && chunk.type === 'usage') usage = chunk.usage
          if (chunk && ['text-delta', 'reasoning-delta', 'tool-call-delta'].includes(chunk.type)) progress('output')
          yield chunk
        }
        yield* flushRewriteBlocks()
        if (!finish || finish.kind === 'aborted') {
          const recovered = !finish ? recoveredFinish(null) : null
          if (recovered) {
            finish = recovered
            yield { type: 'finish', reason: recovered }
          } else throw Object.assign(new Error('模型流已中断，未收到完整结束标记。'), {code:'MODEL_STREAM_INTERRUPTED'})
        }
      } catch (error) {
        interrupted = /^MODEL_STREAM_/.test(error?.code || '')
        const displayedError = chat ? presentModelError(error) : error
        failure = str(displayedError && displayedError.message || displayedError)
        throw displayedError
      } finally {
        const timing = liveness.snapshot()
        liveness.dispose()
        // A hung iterator must not hold the foreground/settlement release path.
        if (!exhausted && iterator?.return) void Promise.resolve().then(() => iterator.return()).catch(() => {})
        progress('end')
        const completed = !failure && !options.signal?.aborted && finish && finish.kind !== 'error' && finish.kind !== 'aborted'
        replyObserver?.finish(completed, completed && finish.kind === 'stop')
        foregroundStrategies.completeRequest(options, completed)
        const owner = child ? child.chat : chat
        if (owner && requestRecord) {
          // complete() 内部同步进入 chatId 写盘队列，evidence()/settled() 会自动等待落盘，
          // 无需在流结束 finally 阻塞主回合提交。
          void Promise.resolve(modelRequestLog.complete({ chatId: owner.id, id: requestRecord.id, sessionId, text: (rewriter ? replyBlocks.map(block => block.text).join('') : responseText) || toolStreamedText, finish, usage, error: failure,
            interrupted: interrupted || (!failure && !finish) || finish?.kind === 'aborted' || options.signal?.aborted || Boolean(timing.interruption), timing }))
            .catch(error => { console.error('dsh-tavern: 模型结果日志写入失败', str(error && error.message || error)) })
        }
      }
    })()
  }, { global: true })
}
