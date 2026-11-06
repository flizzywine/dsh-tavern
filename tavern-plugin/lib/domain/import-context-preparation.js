import { replaceSessionSurface } from './session-surface-mutations.js'
import { sessionEvents, appendSessionEvent } from './session-events.js'
import { markRequestHandled, requestHandledBy } from './request-lineage.js'
import { producerSource, sourceProducerName } from './message-source.js'

const PLUGIN = 'dsh-tavern-context-window'
const eventMessage = event => event.type === 'user/message' ? event.data : event.type === 'assistant/message' ? event.data.message : null

export function needsImportContextPreparation(chat) {
  return Boolean(chat?.importHistory && !chat.importHistory.contextPreparation &&
    !(chat.messages || []).some(m => m.role === 'assistant' && !m.importSource))
}

/** Complete imported rounds on the current native Surface; the opening stays pinned. */
function importedRounds(session, operationId) {
  const bySeq = new Map(sessionEvents(session).map(event => [event.seq, event]))
  const rounds = []
  let pending = null
  for (const seq of session.surface.nodes) {
    const event = bySeq.get(seq), message = eventMessage(event)
    const imported = message?.source?.importSource?.operationId === operationId
    if (event.type === 'user/message' && imported) pending = { seqs: [], ids: [] }
    if (!pending) continue
    if (!imported && !['foreground-frame', 'worldbook-snapshot'].includes(message?.source?.form)) { pending = null; continue }
    pending.seqs.push(seq)
    pending.ids.push(message.id)
    if (event.type === 'assistant/message' && imported) {
      rounds.push({ ...pending, turn: event.data.turn })
      pending = null
    }
  }
  return rounds
}

/** Only the middle of imported history is removable; all other request content is pinned. */
export function planImportContext({ session, request, operationId, contextWindow, estimateMessage }) {
  if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) throw new Error('无法取得当前模型的上下文窗口，请配置模型容量后再继续导入对话')
  const reserve = Number.isFinite(request.maxTokens) && request.maxTokens > 0 ? Math.ceil(request.maxTokens) : Math.ceil(contextWindow * .2)
  const available = contextWindow - reserve
  const budget = Math.min(Math.floor(contextWindow * .8) - 1, available) - Math.max(32, Math.ceil(contextWindow * .01))
  const envelope = { role: 'system', content: [{ type: 'text', text: [request.system || '', JSON.stringify(request.tools || [])].join('\n') }] }
  const total = estimateMessage(envelope) + request.messages.reduce((sum, message) => sum + estimateMessage(message), 0)
  const base = { contextWindow, reserve, budget, beforeTokens: total, afterTokens: total, droppedRounds: 0, removedIds: [], removedSeqs: [] }
  if (total <= available) return { ...base, status: 'unchanged' }
  const rounds = importedRounds(session, operationId)
  // Always keep the latest completed round. With no opening, also retain the first round.
  const events = sessionEvents(session)
  const roundMessageIds = new Set(rounds.flatMap(round => round.ids))
  const hasOpening = events.some(e => e.type === 'assistant/message' && e.data.message.source?.importSource?.operationId === operationId &&
    !roundMessageIds.has(e.data.message.id))
  const removable = rounds.slice(hasOpening ? 0 : 1, -1)
  const costs = new Map(request.messages.map(m => [m.id, estimateMessage(m)]))
  const result = { ...base, status: 'trimmed' }
  for (const round of removable) {
    result.afterTokens -= round.ids.reduce((sum, id) => sum + (costs.get(id) || 0), 0)
    result.removedIds.push(...round.ids)
    result.removedSeqs.push(...round.seqs)
    result.droppedRounds++
    if (result.afterTokens <= budget) break
  }
  if (!result.removedSeqs.length || result.afterTokens > budget) throw new Error('开头必留内容、最新完整轮次及本轮输入仍超过模型容量，请缩短输入或选择更大上下文的模型')
  return result
}

const PREPARED = 'import-context-preparation'

export function createImportContextPreparation({ readChat, readHeader, updateChat, getSession, flush, modelInfo, estimateMessage }) {
  async function prepare(request) {
    if (request.purpose !== undefined || requestHandledBy(request, PREPARED)) return request
    // Only an imported chat awaiting its first check needs history rows.
    const header = readHeader && await readHeader(request.sessionId, ['importHistory'])
    if (header && !(header.importHistory && !header.importHistory.contextPreparation)) return request
    const chat = await readChat(request.sessionId)
    if (!needsImportContextPreparation(chat)) return request
    const session = getSession(request.sessionId)
    if (!session) throw new Error('无法访问导入对话的原生 Session')
    const markerId = 'tavern-context-preparation:' + chat.importHistory.operationId
    const events = sessionEvents(session)
    const existing = events.find(e => e.type === 'user/message' && e.data.id === markerId && sourceProducerName(e.data.source) === PLUGIN)
    let result
    if (existing) {
      const removed = new Set(existing.sourceEventSeqs)
      result = { ...existing.data.source.preparation, removedSeqs: [...removed], removedIds: events.filter(e => removed.has(e.seq)).map(e => eventMessage(e)?.id).filter(Boolean) }
    } else {
      const info = await modelInfo(request)
      request.signal?.throwIfAborted()
      result = planImportContext({ session, request: { ...request, maxTokens: request.maxTokens ?? info.defaultMaxTokens }, operationId: chat.importHistory.operationId, contextWindow: info.context?.contextWindow, estimateMessage })
      const { removedIds, removedSeqs, ...receipt } = result
      const message = { id: markerId, role: 'user', content: [],
        source: producerSource(PLUGIN, { preparation: receipt }) }
      if (result.status === 'trimmed') replaceSessionSurface(session, 'user/message', message, {
        start: removedSeqs[0], end: removedSeqs.at(-1), sourceEventSeqs: removedSeqs
      })
      else appendSessionEvent(session, 'user/message', message, { surfaceOp: 'append' })
    }
    await flush(session)
    const { removedIds, removedSeqs, ...receipt } = result
    await updateChat(chat.id, current => {
      current.importHistory.contextPreparation = { ...receipt, provider: request.provider, model: request.model }
      return current
    }, { source: 'chat-import.context-preparation' })
    if (!removedIds.length) return request
    const removed = new Set(removedIds)
    return markRequestHandled({ ...request, messages: request.messages.filter(m => !removed.has(m.id) && m.id !== markerId) }, PREPARED)
  }
  return { prepare, isPrepared: request => requestHandledBy(request, PREPARED) }
}
