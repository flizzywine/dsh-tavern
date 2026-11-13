import { createHostToolPolicy } from '../host/tools.js'
import { randomUUID } from 'node:crypto'
import { assistantResultForTurn } from '../domain/session-turn-result.js'
import { inputEventForTurn } from '../domain/session-turn-input.js'
import { roundAnchor } from '../domain/round-anchor.js'
import { inputAttachments } from '../domain/player-input-content.js'
import { prependSystemInstruction } from '../domain/system-append.js'
import { markTavernSectionsLiteral } from '../domain/literal-sections.js'
import { sessionStablePrefixSections, withCurrentWorldbook } from '../domain/session-stable-prefix.js'
import { variableDirectoryOpen } from '../domain/session-variable-directory.js'
import { synchronizeBodyEdits } from '../domain/body-editor.js'
import { synchronizeTemplateHistory } from '../domain/template-history.js'
import { turnRepliedByModel } from '../domain/story-alignment.js'
import { isSurfaceEditTurn, sessionEvents } from '../domain/session-events.js'
import { VIRTUAL_WORLDBOOK_SECTION, withVirtualWorldbook } from '../domain/worldbook-virtual-surface.js'
import { appendStorySubmissionReminder } from '../domain/story-tool-submission.js'

function reachedOutputLimit(assistant) {
  const stream = Array.isArray(assistant?.event?.data?.stream) ? assistant.event.data.stream : []
  return stream.some(entry => {
    const chunk = entry?.type === 'chunk' ? entry.chunk : entry
    if (chunk?.type !== 'finish') return false
    const reason = chunk.reason === undefined ? chunk : chunk.reason
    return reason?.kind === 'max-tokens'
  })
}

export function registerTurnLifecycleHooks({
  autoChoices,
  pluginBodyGeneration,
  reconcileWhenIdle,
  backgroundAgentRunner,
  hookChatForSession,
  clearRuntimePresetRequestState,
  contentText,
  ctx,
  ensureNativeSystemPrefix,
  foregroundHandoff,
  foregroundStrategies,
  flushQueuedBodyEdits,
  nativeWorldBookTemplateContext,
  persistClearedBodyEdits,
  pluginPromptSections,
  publishResourceWorkspace,
  readChatCard,
  replaceAssistantReply,
  requestIdForTurn,
  requestPerformance,
  runtimePrompt,
  sessionStore,
  storyOutputToolCall,
  turnOrchestrator,
  turnStarted,
  userMessageForTurn,
}) {
  const hostTools = createHostToolPolicy(ctx)

  ctx.on('agent/turn-stopping', async function (payload) {
    const session = payload.agent && payload.agent.session
    if (session === undefined) return
    const sessionId = session.id
    // No template cancellation here: this hook runs when any Agent's turn ends normally,
    // and the game's template process is shared, so cancelling it killed whatever another
    // task (settlement beside the director or 自动精修) was still rendering.
    clearRuntimePresetRequestState(payload.agent)
    if (backgroundAgentRunner.owns(sessionId)) return
    const userMessage = userMessageForTurn(session, payload.turn)
    const userText = contentText(userMessage)
    const userContent = userMessage?.content || []
    if (userText === '' && !inputAttachments(userContent).length) return
    const requestId = requestIdForTurn(session, payload.turn)
    const assistant = assistantResultForTurn(session, payload.turn)
    try { await pluginBodyGeneration?.validateResult(session, payload.turn, assistant) }
    catch (error) {
      await turnOrchestrator.recordFailure({ sessionId, turn: payload.turn, requestId, code: 'plugin-generation', message: error.message, failure: error.failure })
      throw error
    }
    if (assistant?.refusalAborted === true || (assistant?.plainTextRefusal === true && typeof storyOutputToolCall === 'function' && (await storyOutputToolCall()) === true)) {
      const message = assistant.generationError || '模型未通过 submit_story 提交有效剧情正文；请重新生成本轮正文。'
      await turnOrchestrator.recordFailure({
        sessionId,
        turn: payload.turn,
        requestId,
        code: 'content-filter',
        message,
        ...(assistant.failure ? { failure: assistant.failure } : {})
      })
      throw new Error(message)
    }
    if (assistant === null || assistant.text === '') {
      const reasoningOnly = assistant !== null && assistant.reasoningOnly === true
      const message = reasoningOnly
        ? '模型本轮只返回了思考过程，没有返回正文；请重新生成本轮正文。'
        : '模型本轮没有返回正文；请重新生成本轮正文。'
      await turnOrchestrator.recordFailure({
        sessionId,
        turn: payload.turn,
        requestId,
        code: reasoningOnly ? 'reasoning-only' : 'empty-response',
        message
      })
      throw new Error(message)
    }
    const projectedMessageId = assistant.storyToolSubmission ? 'tavern-tool-reply:' + randomUUID() : randomUUID()
    let replyMessageId = String(assistant.event?.data?.message?.id || '')
    const finalize = () => foregroundHandoff.finalize({
      sessionId,
      turn: payload.turn,
      requestId,
      userText,
      userContent,
      pluginBodyGeneration: assistant?.pluginBodyGeneration === true,
      assistantText: assistant === null ? '' : assistant.text,
      replyMessageId: projectedMessageId,
      incomplete: reachedOutputLimit(assistant),
      incompleteReason: '这次生成达到输出上限或被中断，保留了已生成的部分正文',
      nativeAnchor: roundAnchor(payload.turn, inputEventForTurn(session, payload.turn), assistant.event)
    })
    const saved = requestPerformance ? await requestPerformance.run('generateCommit', sessionId, finalize) : await finalize()
    // A submit_story call and its receipt both carry the body; fold them into one
    // plain reply so context, regeneration and rollback see an ordinary round.
    if (assistant.storyToolSubmission) {
      replaceAssistantReply(session, assistant, saved.reply ? saved.reply.sessionText : assistant.content, projectedMessageId)
      replyMessageId = projectedMessageId
    } else if (saved.reply) {
      if (assistant.text !== saved.reply.sessionText) replyMessageId = projectedMessageId
      replaceAssistantReply(session, assistant, saved.reply.sessionText, projectedMessageId)
    }
    if (saved?.candidates && saved.candidates.messageId !== replyMessageId && replyMessageId !== '') {
      await foregroundHandoff.syncCandidateMessageId?.(sessionId, saved.candidates.requestId, replyMessageId)
    }
  })

  ctx.on('agent/error', function (payload) {
    clearRuntimePresetRequestState(payload.agent)
  })

  ctx.on('session/event', function (session, event) {
    // A new foreground request drops the previous reply's waiting automatic candidates.
    // A Tavern edit (精修 write-back, body edit) opens a turn of its own: not 玩家发送.
    const edit = isSurfaceEditTurn(session, event?.data?.turn)
    if (event?.type === 'turn/start' && !backgroundAgentRunner.owns(session.id)) {
      autoChoices.cancel(session.id)
      if (!edit) turnStarted?.(session.id, event.data?.turn)
    }
    if (!event || event.type !== 'turn/end') return
    if (backgroundAgentRunner.owns(session.id)) return
    const reason = event.data && event.data.reason ? event.data.reason.kind : ''
    foregroundHandoff.end({ sessionId: session.id, turn: event.data && event.data.turn, reason, error: event.data?.reason?.error, edit })
    // Edits submitted while this turn ran are replayed now that the round cannot
    // move any more; a target that changed in between drops its text instead.
    if (typeof flushQueuedBodyEdits === 'function') void flushQueuedBodyEdits(session.id)
    const reply = assistantResultForTurn(session, event.data && event.data.turn)
    void autoChoices.completed({ sessionId: session.id, turn: event.data && event.data.turn, messageId: String(reply?.event?.data?.message?.id || ''), reason })
    // A turn whose record went missing (#196) is adopted before the player's next
    // message, once the agent has gone idle; reconcile never blocks this hook. Only after
    // a model's reply: Tavern's own turns (rollback, undo, edit, repair) end between their
    // native write and their save write, and reconciling there undoes them.
    if (turnRepliedByModel(sessionEvents(session), event.data && event.data.turn)) setTimeout(() => { void reconcileWhenIdle?.(session.id) }, 0)
  })

  ctx.on('system-prompt/assemble', async function (_assembly, context, next) {
    const assembly = await next()
    const agent = context && context.agent
    if (agent === undefined || agent.session === undefined) return assembly
    if (backgroundAgentRunner.owns(agent.session.id)) return assembly
    // DSH assembles the system prompt before agent/pre-step. The first request freezes the
    // variable directory into it, so the opening's MVU variables must be saved before that.
    if (variableDirectoryOpen(agent.session)) await foregroundHandoff.awaitOpening(agent.session.id)
    const chat = await hookChatForSession(agent.session.id)
    if (chat) await synchronizeTemplateHistory(agent.session, chat, session => sessionStore.flush(session))
    if (chat) await synchronizeBodyEdits(agent.session, chat, session => sessionStore.flush(session), persistClearedBodyEdits)
    if (chat && chat.requestMode !== 'sillytavern' && ['story', 'script', 'card'].includes(await turnOrchestrator.modeFor(agent.session.id))) {
      await ensureNativeSystemPrefix(agent.session, chat)
    }
    let workspaceProjection = null
    try { workspaceProjection = await publishResourceWorkspace(agent.session.id, chat) }
    catch { console.error('dsh-tavern: 资源工作区投影刷新失败，继续使用现有资源文件') }
    let fixedSystemSections = sessionStablePrefixSections(agent.session)
    let deferWorldbook = false
    if (chat && ['story', 'script'].includes(chat.mode || 'story')) {
      const native = chat.worldbookStrategy === 'native-skills'
      const projected = await nativeWorldBookTemplateContext(chat, await readChatCard(chat), native
        ? { restore: false } : undefined)
      deferWorldbook = native && !!context.signal && projected.visibilityPending === true
      fixedSystemSections = native
        ? withVirtualWorldbook(fixedSystemSections, projected.prefixContext ?? '', chat.disabledForegroundTools, { defer: deferWorldbook })
        : withCurrentWorldbook(fixedSystemSections, projected.prefixContext ?? '', chat.disabledForegroundTools)
    }
    const assembled = await hostTools.assemble(assembly, context, (value, tools) => foregroundStrategies.assembleSystemPrompt(value, {
      sessionId: agent.session.id,
      toolDefinitions: tools,
      chat,
      cwd: agent.session.header && agent.session.header.cwd,
      workspaceProjection,
      fixedSystemSections
    }))
    // Third-party plugin sections join the play prompt only, after Tavern's own.
    if (pluginPromptSections && chat && chat.requestMode !== 'sillytavern' && ['story', 'script'].includes(await turnOrchestrator.modeFor(agent.session.id))) {
      const extra = await pluginPromptSections({ gameId: agent.session.id })
      if (extra.length) assembled.sections = [...(assembled.sections || []), ...extra]
    }
    // The final reminder goes after those sections, so their length cannot bury
    // the one contract that must be the last thing the model reads.
    const pluginContract = assembled.sections?.find(section => section.name === 'tavern:plugin-body-generation')
    if (pluginContract) assembled.sections = [...assembled.sections, { ...pluginContract, name: 'tavern:plugin-body-generation-reminder' }]
    const hasSubmission = (assembled.sections || []).some(section => section.name === 'tavern:story-tool-submission')
    const outputToolCall = hasSubmission && typeof storyOutputToolCall === 'function' ? (await storyOutputToolCall()) === true : false
    const result = markTavernSectionsLiteral(prependSystemInstruction(appendStorySubmissionReminder(assembled, outputToolCall), chat ? runtimePrompt('system-append') : ''))
    if (deferWorldbook) foregroundStrategies.stageWorldbookSection(context, result.sections.find(section => section.name === VIRTUAL_WORLDBOOK_SECTION))
    return result
  })
}
