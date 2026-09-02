import { createHash } from 'node:crypto'

const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null
const label = (value, allowed) => allowed.includes(value) ? value : value === undefined ? 'missing' : 'other'
export const diagnosticIdentity = value => typeof value === 'string' && value
  ? createHash('sha256').update(value).digest('hex').slice(0, 16) : null
function message(value, index) {
  return { index, type: type(value), role: label(value?.role, ['user', 'assistant', 'system', 'tool']),
    turn: number(value?.turn), turnType: type(value?.turn), greeting: value?.greeting === true,
    textType: type(value?.text), textLength: typeof value?.text === 'string' ? value.text.length : null,
    sourceTextLength: typeof value?.sourceText === 'string' ? value.sourceText.length : null,
    contentType: type(value?.content), contentCount: Array.isArray(value?.content) ? value.content.length : null }
}
function event(value) {
  const data = value?.data, msg = data?.message || data
  return { seq: number(value?.seq), type: label(value?.type, ['user/message', 'assistant/message', 'turn/start', 'turn/end', 'tool/call', 'tool/result']),
    turn: number(data?.turn), sourceKind: label(msg?.source?.kind, ['user', 'model', 'plugin']),
    textLength: typeof msg?.content === 'string' ? msg.content.length : Array.isArray(msg?.content)
      ? msg.content.reduce((sum, block) => sum + (block?.type === 'text' && typeof block.text === 'string' ? block.text.length : 0), 0) : null,
    contentType: type(msg?.content), contentCount: Array.isArray(msg?.content) ? msg.content.length : null }
}

/** Structural evidence only: no text, prompts, names, arbitrary keys or raw events. */
export function regenerationTargetDiagnostic(chat, session, { reason, assistantIndex, target }) {
  const messages = Array.isArray(chat?.messages) ? chat.messages : []
  const events = Array.isArray(session?.events) ? session.events : []
  const nodes = Array.isArray(session?.surface?.nodes) ? session.surface.nodes : []
  const turn = messages[assistantIndex]?.turn
  const selectedNodes = new Set(nodes)
  const matching = events.filter(item => item?.type === 'assistant/message' && item?.data?.turn === turn)
  const indices = new Set(Array.from({length: Math.min(12, messages.length)}, (_, i) => messages.length - Math.min(12, messages.length) + i))
  for (let i = Math.max(0, assistantIndex - 2); i <= Math.min(messages.length - 1, assistantIndex + 2); i++) indices.add(i)
  return { version: 1, reason, chat: { id: diagnosticIdentity(chat?.id), revision: number(chat?._storageRevision),
    timelineRevision: number(chat?.timeline?.revision), mode: label(chat?.mode, ['story', 'script']),
    regenInProgress: chat?.regenInProgress === true, settleStatus: label(chat?.settleStatus, ['idle', 'running', 'pending', 'done', 'failed']),
    messagesType: type(chat?.messages), messageCount: messages.length,
    messages: [...indices].sort((a,b) => a-b).map(i => message(messages[i], i)) },
    selection: { assistantIndex, previousIndex: assistantIndex - 1, requestedTurn: number(turn),
      nativeSeq: number(target?.assistantSeq), nativeTurn: number(target?.turn) },
    native: { eventCount: events.length, surfaceType: type(session?.surface?.nodes), surfaceCount: nodes.length,
      matchingAssistantCount: matching.length,
      matchingSurfaceCount: matching.filter(item => selectedNodes.has(item.seq)).length,
      matchingAssistants: matching.slice(-8).map(item => ({ ...event(item), visible: selectedNodes.has(item.seq) })),
      surfaceTail: nodes.slice(-12).map(seq => { const item = events[seq]?.seq === seq ? events[seq] : events.find(item => item?.seq === seq); return { node: number(seq), found: Boolean(item), ...event(item) } }) } }
}
