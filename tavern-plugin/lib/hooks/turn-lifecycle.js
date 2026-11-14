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
import { agentForSession } from '../domain/agent-lookup.js'
import { VIRTUAL_WORLDBOOK_SECTION, withVirtualWorldbook } from '../domain/worldbook-virtual-surface.js'
import { appendStorySubmissionReminder } from '../domain/story-tool-submission.js'

// A provider can stop mid-stream (SAFETY, an idle timeout) and DSH then keeps only the
// attempt's stream, never an assistant/message: the turn looks empty even though the
// player watched the body arrive. The prose is still inside that stream — a finished
// submit_story document, its cut argument text, or a text block — so the round is kept
// as an incomplete body instead of rolling back to the previous one.
const PARTIAL_CONTENT_RE = /"content"\s*:\s*"/
const STORY_SUBMIT_TOOL = 'submit_story'

function unescapeJsonFragment(fragment) {
  try { return JSON.parse('"' + fragment + '"') } catch (_error) { /* cut mid-escape */ }
  return fragment
    .replace(/\\u[0-9a-fA-F]{0,3}$/, '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

function contentOfArguments(raw) {
  if (typeof raw !== 'string' || raw === '') return ''
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed?.content === 'string') return parsed.content
  } catch (_error) { /* cut mid-document */ }
  const match = PARTIAL_CONTENT_RE.exec(raw)
  if (!match) return ''
  return unescapeJsonFragment(raw.slice(match.index + match[0].length).replace(/"(?:\s*})?\s*$/, ''))
}

export function recoveredSubmissionBody(session, turn) {
  let best = ''
  const consider = text => {
    if (typeof text === 'string' && text.length > best.length) best = text
  }
  for (const event of sessionEvents(session)) {
    if (Number(event?.data?.turn) !== Number(turn)) continue
    if (event.type === 'assistant/message') {
      for (const block of event.data.message?.content || []) {
        if (block?.type === 'tool-call' && block.name === STORY_SUBMIT_TOOL) consider(contentOfArguments(block.arguments))
        else if (block?.type === 'text') consider(block.text)
      }
    } else if (event.type === 'assistant/attempt') {
      for (const entry of event.data.stream || []) {
        if (entry?.type === 'tool-call-chunks' && entry.name === STORY_SUBMIT_TOOL) {
          consider(contentOfArguments((Array.isArray(entry.args) ? entry.args : []).join('')))
        } else if (entry?.type === 'chunk' && entry.chunk?.type === 'block-end' && entry.chunk.block?.type === 'text') {
          consider(entry.chunk.block.text)
        }
      }
    }
  }
  return best.trim()
}

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

  // Reply rewrites that reached the save while a turn ran wait for the Agent to go
  // idle (template-history.js); this writes them once it has.
  async function synchronizeTemplateHistoryWhenIdle(session) {
    await agentForSession(session)?.whenIdle()
    const chat = await hookChatForSession(session.id)
    if (chat) await synchronizeTemplateHistory(session, chat, value => sessionStore.flush(value))
  }

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
    let assistant = assistantResultForTurn(session, payload.turn)
    let interrupted = false
    try { await pluginBodyGeneration?.validateResult(session, payload.turn, assistant) }
    catch (error) {
      await turnOrchestrator.recordFailure({ sessionId, turn: payload.turn, requestId, code: 'plugin-generation', message: error.message, failure: error.failure })
      throw error
    }
    if (assistant === null || assistant.text === '') {
      // A stream that stopped at the output limit is not an empty answer: the model
      // wrote a body (or a submit_story argument) that never completed. Reporting it
      // as empty-response hid the real cause, and a cut submission looks exactly like
      // a model that returned nothing.
      const rescued = recoveredSubmissionBody(session, payload.turn)
      if (rescued !== '') {
        // Half a round beats no round: the player already read this text.
        assistant = { ...(assistant || {}), text: rescued, reasoningText: '', reasoningOnly: false }
        interrupted = true
      } else {
        const truncated = assistant !== null && reachedOutputLimit(assistant)
        const reasoningOnly = !truncated && assistant !== null && assistant.reasoningOnly === true
        const message = truncated
          ? '本轮输出达到上限被截断，正文没有完整提交；请重新生成本轮正文。'
          : reasoningOnly
            ? '模型本轮只返回了思考过程，没有返回正文；请重新生成本轮正文。'
            : '模型本轮没有返回正文；请重新生成本轮正文。'
        await turnOrchestrator.recordFailure({
          sessionId,
          turn: payload.turn,
          requestId,
          code: truncated ? 'output-limit' : (reasoningOnly ? 'reasoning-only' : 'empty-response'),
          message
        })
        throw new Error(message)
      }
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
      incomplete: interrupted || reachedOutputLimit(assistant),
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
    if (!edit) setTimeout(() => {
      synchronizeTemplateHistoryWhenIdle(session).catch(error => console.warn('dsh-tavern: 模板改写同步失败', session.id, error?.message || error))
    }, 0)
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
