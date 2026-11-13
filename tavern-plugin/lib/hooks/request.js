import { virtualWorldbookRestoreRefs } from '../domain/worldbook-virtual-surface.js'
import { worldbookContextDelta } from '../domain/worldbook-context-delta.js'
import { normalizeProviderOverflow } from '../domain/provider-overflow.js'
import { synchronizeBodyEdits } from '../domain/body-editor.js'
import { randomUUID } from 'node:crypto'
import { promptSection } from '../domain/prompt-section.js'
import { lastRoundVariableChanges } from '../domain/foreground-variable-changes.js'
import { synchronizeTemplateHistory } from '../domain/template-history.js'

// Appended once at the start of a reply, so it joins the history after the cached prefix.
export function appendVariableChanges({ chat, payload, decision }) {
  if (!chat || decision.kind !== 'enter' || Number(payload.step) !== 1) return decision
  // The frozen regeneration frame already contains the target round's input
  // state. Live post-round variable changes belong to the old body, not this try.
  if (chat.regenRecovery?.candidateFrame?.kind === 'foreground') return decision
  if (decision.messages.some(message => message.source?.form === 'variable-changes')) return decision
  const text = lastRoundVariableChanges(chat)
  if (!text) return decision
  return { ...decision, messages: [...decision.messages, { id: randomUUID(), role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin:dsh-tavern', form: 'variable-changes' } }] }
}

export async function appendWorldbookRecovery({ chat, payload, decision, project }) {
  if (!chat || chat.worldbookStrategy !== 'native-skills' || decision.kind !== 'enter' || !project) return decision
  const state = chat.worldBookVirtualState
  const refs = virtualWorldbookRestoreRefs(payload.agent.session, state, decision.messages)
  if (!refs.length) return decision
  const projected = await project(chat, { restoreRefs: refs })
  const text = projected?.snapshots
  if (!text) return decision
  const texts = Object.fromEntries(refs.map(ref => [ref, state.entries[ref]?.contextText ?? state.entries[ref]?.text])
    .filter(([, body]) => body && text.includes(body)))
  const marker = { scope: state.scope, entries: Object.fromEntries(Object.keys(texts).map(ref => [ref, state.entries[ref].renderHash])), texts }
  // Missing chains get a full baseline, appended after pending input; never edit system/history.
  const full = worldbookContextDelta(null, marker, text)
  return { ...decision, messages: [...decision.messages, { id: randomUUID(), role: 'user',
    content: [{ type: 'text', text: promptSection('lorebook_restore', full.text) }],
    source: { kind: 'plugin:dsh-tavern', form: 'worldbook-recovery', virtualWorldbook: marker, worldbookEntrySnapshots: full.records } }] }
}

export function registerRequestHooks({
  backgroundAgentRunner,
  gameModes,
  cardMemory,
  projectWorldbookRecovery,
  chatForSession,
  ctx,
  foregroundStrategies,
  openingRequest,
  persistClearedBodyEdits,
  requestCoordinates,
  requestIdForMessages,
  requestPerformance,
  sessionStore,
  tavernRetryLimiter,
}) {
  ctx.on('agent/request', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (sessionId !== '') requestCoordinates.set(sessionId, { turn: payload.turn, step: payload.step })
    if (!requestPerformance || sessionId === '' || backgroundAgentRunner.owns(sessionId)) return await next()
    return await requestPerformance.run('generateRequest', sessionId, () => next())
  })

  ctx.on('agent/request-error', tavernRetryLimiter.handle, { prepend: true })
  // Registered last with prepend, so it runs first: the retry limiter and DSH's
  // overflow compaction both see the normalized code.
  ctx.on('agent/request-error', normalizeProviderOverflow, { prepend: true })

  const prepareStep = async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    // Tavern drives only game sessions; child agents (its own background
    // agents, plugin agents, DSH subagents) never get a turn frame or status.
    // parentSession alone does not mark a child: a native fork of a game also
    // carries it, but has its own Tavern chat.
    if (backgroundAgentRunner.owns(sessionId) || (payload.agent.session.header?.parentSession && !await chatForSession(sessionId))) return next()
    if (gameModes && ['story', 'script'].includes((await chatForSession(sessionId))?.mode) && await gameModes.active(sessionId)) throw new Error('本局由玩法插件接管，请在玩法面板中行动')
    if (Number(payload.step) === 1) await openingRequest?.beforeFirstStep(sessionId)
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const chat = await chatForSession(sessionId)
    if (chat) await synchronizeTemplateHistory(payload.agent.session, chat, session => sessionStore.flush(session))
    if (chat) await synchronizeBodyEdits(payload.agent.session, chat, session => sessionStore.flush(session), persistClearedBodyEdits)
    const prepared = await foregroundStrategies.prepareStep({
      sessionId,
      payload,
      decision: openingRequest?.project(payload.agent.session, chat, decision) ?? decision,
      chat,
      requestId: requestIdForMessages(payload.messages)
    })
    // prepareStep may render and persist a newer worldbook state. Restoring the
    // pre-prepare header would append stale content after the fresh delta.
    const recoveryChat = projectWorldbookRecovery ? await chatForSession(sessionId) : chat
    const recovered = await appendWorldbookRecovery({ chat: recoveryChat, payload, decision: prepared, project: projectWorldbookRecovery })
    const withChanges = appendVariableChanges({ chat, payload, decision: recovered })
    try { return await cardMemory.appendRecall({ chat, payload, decision: withChanges }) }
    catch (error) { console.warn('[Tavern card memory] recall unavailable:', error.message); return withChanges }
  }
  ctx.on('agent/pre-step', async function (payload, next) {
    const sessionId = payload.agent && payload.agent.session ? payload.agent.session.id : ''
    if (!requestPerformance || sessionId === '' || backgroundAgentRunner.owns(sessionId)) return await prepareStep(payload, next)
    return await requestPerformance.run('generatePrepare', sessionId, () => prepareStep(payload, next))
  })
}
