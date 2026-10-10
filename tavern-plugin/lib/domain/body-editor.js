import { replaceSessionSurface } from './session-surface-mutations.js'
import { createHash, randomUUID } from 'node:crypto'
import { editableReplyParts } from './reply-presentation.js'
import { locateRegenerationSurface } from './rollback-surface.js'
import { sessionEvents } from './session-events.js'
import { isScopedMessages } from './scoped-messages.js'
import { diffJson } from './json-mutation.js'

function latest(chat) {
  const message = chat.messages?.at(-1)
  if (!['story', 'script'].includes(chat.mode || 'story') || message?.role !== 'assistant' || message.greeting) throw new Error('只能编辑最后一轮正文')
  return message
}
function source(message) { return message.projectionText ?? message.sourceText ?? message.text ?? '' }
function token(chat, message) {
  // Template display bookkeeping is not an edit to the authoritative prose.
  const { displayRuntime: _capture, tavernPluginData: _templateCache, ...body } = message
  return createHash('sha256').update(JSON.stringify([chat.id, chat.timeline?.branchId, chat.timeline?.revision, chat.messages.length, body])).digest('hex')
}

/** Reconcile a durable Chat edit to native Surface; retries never duplicate history. */
export async function synchronizeBodyEdits(session, chat, flush, persistChat) {
  const recorded = new Set(sessionEvents(session).filter(event => event.type === 'assistant/message').map(event => event.data?.message?.id))
  const cleared = []
  let sessionDirty = false
  for (const message of chat.messages || []) {
    if (!message?.bodyEdit) continue
    const { id, seq, turn } = message.bodyEdit
    if (recorded.has(id)) continue
    let targetSeq = session.surface?.nodes.includes(seq) ? seq : null
    // Migration renumbers seqs and may fold the body-edit injection onto its
    // target; Chat markers still hold the pre-migration seq. Recover by turn.
    if (targetSeq == null && turn != null) {
      const located = locateRegenerationSurface({ events: sessionEvents(session), nodes: session.surface?.nodes, turn })
      targetSeq = located?.assistantSeq ?? null
    }
    if (targetSeq == null) {
      // Issue #72: orphaned marker after migration wiped the injection. Chat
      // already holds the edited text — drop the marker so turns can proceed.
      cleared.push(id)
      delete message.bodyEdit
      continue
    }
    if (targetSeq !== seq) message.bodyEdit = { id, seq: targetSeq, turn }
    replaceSessionSurface(session, 'assistant/message', {
      turn, step: 1,
      message: { id, role: 'assistant', content: [{ type: 'text', text: message.text }], source: { kind: 'model', provider: 'dsh-tavern', model: 'body-edit' } }
    }, { start: targetSeq, end: targetSeq, sourceEventSeqs: [targetSeq] })
    recorded.add(id)
    sessionDirty = true
  }
  if (cleared.length && typeof persistChat === 'function') {
    await persistChat(chat, cleared)
  }
  if (sessionDirty || (chat.messages || []).some(message => message.bodyEdit)) await flush(session)
  return cleared
}

/** Edit prose only; do not replay macros, scripts or settlement. */
export function createBodyEditor({ chats, sessions, timeline, activity, project, present, sessionPatch }) {
  const pending = new Set()
  function refuseClosedPatch() {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
  }
  function idle(chat, agent) {
    if (agent?.phase?.kind === 'running' || chat.regenInProgress || ['pending', 'running'].includes(chat.settleStatus) || activity(chat)?.busy) throw new Error('请等待当前生成或后台处理完成后再编辑')
  }
  async function context(sessionId) {
    refuseClosedPatch()
    const chat = await chats.forSession(sessionId)
    if (!chat) throw new Error('会话不存在')
    const agent = sessions.get(sessionId)
    if (!agent?.session) throw new Error('无法访问原生会话')
    idle(chat, agent)
    await synchronizeBodyEdits(agent.session, chat, sessions.flush, async (dirty, cleared) => {
      const drop = new Set(cleared)
      await chats.update(dirty.id, current => {
        let changed = false
        for (const message of current.messages || []) {
          if (message.bodyEdit && drop.has(message.bodyEdit.id)) {
            delete message.bodyEdit
            changed = true
          }
        }
        return changed ? current : undefined
      }, { source: 'body-edit.stale-clear' })
    })
    const message = latest(chat)
    const target = locateRegenerationSurface({ events: sessionEvents(agent.session), nodes: agent.session.surface?.nodes, turn: message.turn })
    if (!target) throw new Error('最后一轮正文已不在当前上下文中，无法编辑')
    const parts = editableReplyParts(source(message))
    if (!parts.some(part => part.kind === 'text' && part.text.trim())) throw new Error('这轮只有 HTML，没有可编辑文本')
    return { chat, agent, message, target, parts }
  }
  // A bounded history edits only its last floor: apply the same timeline intent to
  // the header and that floor, then patch them on the read revision. A moved
  // revision returns undefined so the complete path re-validates the edit token.
  async function saveLatestFloor(chat, message, patch, target, agent) {
    if (!isScopedMessages(chat.messages) || typeof chats.patch !== 'function') return undefined
    const index = chat.messages.length - 1
    const { messages: _rows, ...header } = chat
    const edited = timeline.apply({ chat: { ...header, messages: [message] }, intent: { kind: 'body.edit', turn: message.turn, patch } }).chat
    const { messages: [row], ...head } = edited
    const changes = diffJson({ ...header, messages: [] }, { ...head, messages: [] }).filter(change => !['_storageRevision', 'updatedAt'].includes(change.path[0]))
    for (const change of diffJson(message, row)) changes.push({ ...change, path: ['messages', index, ...change.path] })
    const saved = await chats.patch(chat.id, chat._storageRevision, changes, { source: 'foreground.body-edit', assertCurrent() {
      if (!agent.session.surface?.nodes.includes(target.assistantSeq)) throw new Error('模型上下文已变化，请重新打开编辑')
    } })
    if (!saved) return undefined
    await synchronizeBodyEdits(agent.session, { messages: [row] }, sessions.flush)
    return present(saved)
  }
  async function read(sessionId) {
    const { chat, message, parts } = await context(sessionId)
    return { token: token(chat, message), turn: message.turn, parts: parts.map(part => part.kind === 'text' ? part : { kind: part.kind }) }
  }
  async function save(sessionId, input) {
    if (pending.has(sessionId)) throw new Error('正在保存正文，请稍候')
    pending.add(sessionId)
    try {
      const { chat, agent, message, target, parts } = await context(sessionId)
      if (input?.token !== token(chat, message)) throw new Error('正文或会话已变化，请重新打开编辑')
      const texts = input.texts
      if (!Array.isArray(texts) || texts.length !== parts.filter(part => part.kind === 'text').length || texts.some(text => typeof text !== 'string')) throw new Error('编辑文本格式无效')
      if (!texts.some(text => text.trim())) throw new Error('正文不能为空')
      if (texts.some(text => editableReplyParts(text).some(part => part.kind !== 'text'))) throw new Error('这里只能编辑文本，不能新增 HTML')
      // Cards' status blocks must start on their own line. An edit box hides the blank lines
      // around a text part, so keep the original edges when the edited text has none.
      const keepEdges = (original, edited) => (/^\s/.test(edited) ? '' : original.match(/^\s*/)[0]) + edited + (/\s$/.test(edited) ? '' : original.match(/\s*$/)[0])
      let index = 0
      const text = parts.map(part => part.kind === 'text' ? keepEdges(part.text, texts[index++]) : part.text).join('')
      if (text === source(message)) return present(chat)
      const reply = await project(text, chat)
      const patch = {
        sourceText: text, projectionText: text, text: reply.sessionText,
        displayText: reply.displayText, displayMode: reply.displayMode,
        bodyEdit: { id: 'tavern-body-edit:' + randomUUID(), seq: target.assistantSeq, turn: target.turn }
      }
      if (Array.isArray(message.swipes)) {
        patch.swipes = structuredClone(message.swipes)
        const swipe = Number(message.swipeId) || 0
        if (typeof patch.swipes[swipe] === 'string') patch.swipes[swipe] = text
      }
      // Validate on an isolated native Session before the durable Chat intent.
      // A rejected host event must never publish an edit that future requests
      // will keep trying (and failing) to synchronize. Accepted writes retain
      // the existing journal-first recovery path for disk/flush failures.
      const preview = agent.session.constructor.fromRestore(agent.session.id, structuredClone(sessionEvents(agent.session)), structuredClone(agent.session.header), agent.session.inheritedEventCount, 'detached')
      await synchronizeBodyEdits(preview, { messages: [{ ...message, ...patch }] }, async () => {})
      const patched = await saveLatestFloor(chat, message, patch, target, agent)
      if (patched) return patched
      const saved = await chats.update(chat.id, current => {
        idle(current, agent)
        if (token(current, latest(current)) !== input.token) throw new Error('正文或会话已变化，请重新打开编辑')
        if (!agent.session.surface?.nodes.includes(target.assistantSeq)) throw new Error('模型上下文已变化，请重新打开编辑')
        return timeline.apply({ chat: current, intent: { kind: 'body.edit', turn: message.turn, patch } }).chat
      }, { source: 'foreground.body-edit' })
      await synchronizeBodyEdits(agent.session, saved, sessions.flush)
      return present(saved)
    } finally { pending.delete(sessionId) }
  }
  // A whole new text (plugins): its HTML and markers must equal the current ones, in order;
  // only the prose between them changes, through the same checks as a player's edit.
  async function replaceText(sessionId, text) {
    const { chat, message, parts } = await context(sessionId)
    const fixed = parts.filter(part => part.kind !== 'text')
    const gaps = Array.from({ length: fixed.length + 1 }, () => '')
    let gap = 0
    for (const part of editableReplyParts(String(text))) {
      if (part.kind === 'text') { gaps[gap] += part.text; continue }
      if (gap >= fixed.length || fixed[gap].kind !== part.kind || fixed[gap].text.trim() !== part.text.trim()) throw new Error('正文里的 HTML 块要保持原样，只能改文字')
      gap++
    }
    if (gap !== fixed.length) throw new Error('正文里的 HTML 块要保持原样，只能改文字')
    const texts = []
    gap = 0
    for (const part of parts) {
      if (part.kind !== 'text') { gap++; continue }
      texts.push(gaps[gap])
      gaps[gap] = ''
    }
    if (gaps.some(rest => rest.trim())) throw new Error('只能修改原有的文字段落，不能在 HTML 块之间新增段落')
    return await save(sessionId, { token: token(chat, message), texts })
  }
  return Object.freeze({ read, save, replaceText })
}
