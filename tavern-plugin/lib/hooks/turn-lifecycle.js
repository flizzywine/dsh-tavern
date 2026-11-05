import { assistantResultForTurn } from '../domain/session-turn-result.js'
import { inputEventForTurn } from '../domain/session-turn-input.js'
import { roundAnchor } from '../domain/round-anchor.js'
import { inputAttachments } from '../domain/player-input-content.js'
import { prependSystemInstruction } from '../domain/system-append.js'
import { markTavernSectionsLiteral } from '../domain/literal-sections.js'
import { sessionStablePrefixSections, withCurrentWorldbook } from '../domain/session-stable-prefix.js'
import { synchronizeBodyEdits } from '../domain/body-editor.js'
import { synchronizeTemplateHistory } from '../domain/template-history.js'
import { turnRepliedByModel } from '../domain/story-alignment.js'
import { isSurfaceEditTurn, sessionEvents } from '../domain/session-events.js'
import { withVirtualWorldbook } from '../domain/worldbook-virtual-surface.js'
import { appendStorySubmissionReminder } from '../domain/story-tool-submission.js'

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
  nativeWorldBookTemplateContext,
  persistClearedBodyEdits,
  pluginPromptSections,
  publishResourceWorkspace,
  readChatCard,
  replaceAssistantReply,
  requestIdForTurn,
  runtimePrompt,
  sessionStore,
  storyOutputToolCall,
  turnOrchestrator,
  turnStarted,
  userMessageForTurn,
}) {
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
    const saved = await foregroundHandoff.finalize({
      sessionId,
      turn: payload.turn,
      requestId,
      userText,
      userContent,
      pluginBodyGeneration: assistant?.pluginBodyGeneration === true,
      assistantText: assistant === null ? '' : assistant.text,
      nativeAnchor: roundAnchor(payload.turn, inputEventForTurn(session, payload.turn), assistant.event)
    })
    // A submit_story call and its receipt both carry the body; fold them into one
    // plain reply so context, regeneration and rollback see an ordinary round.
    if (assistant.storyToolSubmission) replaceAssistantReply(session, assistant, saved.reply ? saved.reply.sessionText : assistant.content)
    else if (saved.reply) replaceAssistantReply(session, assistant, saved.reply.sessionText)
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
    foregroundHandoff.end({ sessionId: session.id, turn: event.data && event.data.turn, reason, edit })
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
    if (chat && ['story', 'script'].includes(chat.mode || 'story')) {
      const native = chat.worldbookStrategy === 'native-skills'
      const projected = await nativeWorldBookTemplateContext(chat, await readChatCard(chat), native
        ? { restore: false } : undefined)
      fixedSystemSections = (native ? withVirtualWorldbook : withCurrentWorldbook)(fixedSystemSections, projected.prefixContext ?? '', chat.disabledForegroundTools)
    }
    const assembled = await foregroundStrategies.assembleSystemPrompt(assembly, {
      sessionId: agent.session.id,
      chat,
      cwd: agent.session.header && agent.session.header.cwd,
      workspaceProjection,
      fixedSystemSections
    })
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
    return markTavernSectionsLiteral(prependSystemInstruction(appendStorySubmissionReminder(assembled, outputToolCall), chat ? runtimePrompt('system-append') : ''))
  })
}
