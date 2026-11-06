import { ensureSessionSystemHead, sessionEvents, appendSessionEvent, sessionEventData } from './session-events.js'
import { createForegroundFrameBuilder } from './agent-input-frame.js'
import { createForegroundFrameSessionAdapter } from './foreground-frame-session-adapter.js'
import { foregroundFrameInputs } from './turn-orchestration.js'
import { plainReplyProse } from './reply-prose.js'

const clone = value => structuredClone(value)

// Native Tavern rounds contain one input and one body. Preserve adjacent source
// paragraphs in that body, with the state at the end of the combined message.
function nativeMessages(messages) {
  const result = []
  for (const row of messages) {
    const previous = result.at(-1)
    if (previous?.role === row.role) {
      const text = previous.text + '\n\n' + row.text
      const sourceLines = previous.sourceLines.concat(row.sourceLine)
      Object.assign(previous, row, { text, sourceLines })
    } else result.push({ ...row, sourceLines: [row.sourceLine] })
  }
  return result
}

/** Build replayable native events and compact checkpoints without running any Agent. */
export async function buildImportedConversation(chat, parsed, { operationId, fileName = '', initialVariables, textOnly = false, framePlan, prepareFrame, now = Date.now() }) {
  if (!prepareFrame && !framePlan?.text?.trim()) throw new Error('导入缺少原生正文任务指令')
  const frameBuilder = createForegroundFrameBuilder()
  const events = []
  let turn = 0
  let pendingUsers = [], roundStart = 0
  chat.importHistory = { version: 1, operationId, digest: parsed.digest, status: 'ready', warnings: parsed.warnings,
    importedAt: now, messageCount: parsed.messages.length }
  chat.title = fileName.replace(/\.jsonl$/i, '').slice(0, 160) || chat.cardName + ' · 导入对话'
  chat.nativeOpeningAppended = true
  chat.settleStatus = 'done'
  chat.timeline.participants = { background: { role: 'background', lifetime: 'chat', status: 'needs-session', sessionId: '', boundary: null } }
  const beforeParticipants = clone(chat.timeline.participants)
  for (const [index, row] of nativeMessages(parsed.messages).entries()) {
    const messageId = `tavern-import:${operationId}:${row.sourceLine}`
    const variables = textOnly ? initialVariables : row.variables || initialVariables
    const message = { role: row.role, ...plainReplyProse(row.text), ts: Date.parse(row.timestamp) || now,
      native: true, name: row.name, swipeId: 0, swipes: [row.text],
      ...(variables === undefined ? {} : { variables: [clone(variables)] }),
      importSource: { operationId, line: row.sourceLine, lines: row.sourceLines, swipe: row.sourceSwipe, stateSourceLine: textOnly ? null : row.stateSourceLine, stateInherited: textOnly || row.stateInherited } }
    if (row.role === 'user') {
      if (!pendingUsers.length) roundStart = chat.messages.length
      pendingUsers.push(row.text)
      events.push({ type: 'user/message', data: { id: messageId, role: 'user', content: [{ type: 'text', text: row.text }],
        source: { kind: 'user', importSource: message.importSource } }, intent: { surfaceOp: 'append' } })
    } else {
      turn++
      message.turn = turn
      if (index === 0) message.greeting = true
      if (pendingUsers.length) {
        const userText = pendingUsers.join('\n\n')
        const beforeWorldBookReads = clone(chat.worldBookReads)
        const beforeVirtualWorldbook = clone(chat.worldBookVirtualState)
        const plan = prepareFrame ? await prepareFrame({ chat, turn, userText }) : framePlan
        if (!plan?.text?.trim()) throw new Error('导入缺少原生正文任务指令')
        const frame = frameBuilder.build({ chatId: chat.id, branchId: chat.timeline.branchId,
          basedOnRevision: chat.timeline.revision, operationId: `import:${operationId}:${turn}`, turn,
          inputs: foregroundFrameInputs(plan, userText, userText, chat.runtimePresetSnapshot, chat),
          source: { ...(plan.virtualWorldbook ? { worldBook: { virtualWorldbook: plan.virtualWorldbook } } : {}), importSource: message.importSource, card: { systemPromptText: plan.systemPromptText } } })
        const adapted = createForegroundFrameSessionAdapter({ id: () => `tavern-import-frame:${operationId}:${turn}` })
          .append({ messages: [], frame, step: 1, openingText: chat.cardContextSnapshot, historyMessages: events.filter(event => event.type === 'user/message').map(event => event.data) })
        events.push(...(turn === 1 ? [] : [{ type: 'turn/start', data: { turn } }, { type: 'step/start', data: { turn, step: 1 } }]))
        for (const context of adapted.messages) events.push({ type: 'user/message', data: context, intent: { surfaceOp: 'append' } })
        chat.timeline.checkpoints.push({ id: `import-checkpoint:${operationId}:${turn}`, turn, userText: pendingUsers.join('\n\n'),
          importMessageCount: roundStart, importBefore: { scriptState: clone(chat.scriptState), posture: '', candidates: null,
            settleStatus: 'done', settleError: null, lastSettle: null, worldBookReads: beforeWorldBookReads, worldBookVirtualState: beforeVirtualWorldbook, preparedWorldBookContext: '', preparedWorldBook: null, participants: beforeParticipants },
          participants: beforeParticipants, committedAt: now })
        chat.timeline.checkpoints = chat.timeline.checkpoints.slice(-40)
        chat.timeline.revision++
      }
      if (!pendingUsers.length && turn !== 1) events.push({ type: 'turn/start', data: { turn } }, { type: 'step/start', data: { turn, step: 1 } })
      events.push(
        { type: 'assistant/message', data: { turn, step: 1, message: { id: messageId, role: 'assistant', content: [{ type: 'text', text: row.text }],
          source: { kind: 'model', provider: 'dsh-tavern', model: 'chat-import', importSource: message.importSource } } }, intent: { surfaceOp: 'append', sourceEventSeqs: [] } },
        { type: 'step/end', data: { turn, step: 1 } }, { type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
      pendingUsers = []
    }
    chat.messages.push(message)
  }
  if (chat.mvu?.enabled) chat.mvu.openingInitialization = { version: 2, status: 'complete', completedAt: now, source: 'chat-import' }
  return { chat, events, lastTurn: turn }
}

/** Resume only our exact contiguous event prefix; never rewrite append-only history. */
export async function appendImportedEvents(session, plan, flush) {
  ensureSessionSystemHead(session)
  const events = sessionEvents(session).filter(event => event.type !== 'session/end-seed')
  // The reserved opening turn/step precedes the system head; imported history
  // starts after it, so the head's own turn/start must never anchor the resume.
  const headIndex = events.findIndex(event => event.type === 'system/message')
  let start = events.findIndex((event, index) => index > headIndex && (event.type === 'turn/start' || event.type === 'assistant/message' ||
    (event.type === 'user/message' && event.data?.id !== 'tavern-session-prefix:' + session.id)))
  if (start < 0) start = events.length
  if (events.length > start + plan.events.length) throw new Error('导入期间 Session 已有新事件，请使用新 Session')
  for (let index = 0; index < plan.events.length; index++) {
    const expected = plan.events[index], existing = events[start + index]
    if (existing) {
      if (existing.type !== expected.type || JSON.stringify(existing.data) !== JSON.stringify(sessionEventData(session, expected.type, expected.data))) throw new Error('导入事件与当前 Session 不一致，拒绝重复追加')
    } else appendSessionEvent(session, expected.type, expected.data, expected.intent)
  }
  await flush(session)
}
