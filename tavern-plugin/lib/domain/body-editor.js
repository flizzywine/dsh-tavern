import { upgradeReferences } from './session-upgrade-references.js'
import { replaceSessionSurface } from './session-surface-mutations.js'
import { createHash, randomUUID } from 'node:crypto'
import { editableReplyParts } from './reply-presentation.js'
import { replyProse } from './reply-prose.js'
import { sceneSourceDigest } from './scene-illustration.js'
import { locateRegenerationSurface } from './rollback-surface.js'
import { sessionEvents } from './session-events.js'
import { isScopedMessages } from './scoped-messages.js'
import { diffJson } from './json-mutation.js'
import { locateUserEditFloor, locateUserInputFloor, userInputText } from './input-floor.js'
import { inputEventForTurn, inputKind, isFailedTurnEnd } from './session-turn-input.js'

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
  const references = upgradeReferences(sessionEvents(session))
  const recorded = new Set()
  for (const event of sessionEvents(session)) {
    if (event.type === 'assistant/message' && event.data?.message?.id) recorded.add(event.data.message.id)
    else if (event.type === 'user/message' && event.data?.id) recorded.add(event.data.id)
  }
  const cleared = []
  let sessionDirty = false
  for (const message of chat.messages || []) {
    if (!message?.bodyEdit) continue
    const { id, turn } = message.bodyEdit
    const seq = references.sequence(message.bodyEdit.seq, message.bodyEdit.formatVersion)
    if (recorded.has(id)) continue
    const user = message.bodyEdit.role === 'user' || message.role === 'user'
    let targetSeq = session.surface?.nodes.includes(seq) ? seq : null
    // Migration renumbers seqs and may fold the body-edit injection onto its
    // target; Chat markers still hold the pre-migration seq. Recover by turn.
    if (targetSeq == null && turn != null) {
      if (user) targetSeq = locateUserInputFloor(session, turn)?.seq ?? null
      else {
        const located = locateRegenerationSurface({ events: sessionEvents(session), nodes: session.surface?.nodes, turn })
        targetSeq = located?.assistantSeq ?? null
      }
    }
    if (targetSeq == null) {
      // Issue #72: orphaned marker after migration wiped the injection. Chat
      // already holds the edited text — drop the marker so turns can proceed.
      cleared.push(id)
      delete message.bodyEdit
      continue
    }
    if (targetSeq !== seq) message.bodyEdit = user ? { id, seq: targetSeq, turn, role: 'user' } : { id, seq: targetSeq, turn, formatVersion: 4 }
    if (user) {
      replaceSessionSurface(session, 'user/message', {
        id, role: 'user', content: [{ type: 'text', text: String(message.text ?? '') }], source: { kind: 'user' }
      }, { start: targetSeq, end: targetSeq, sourceEventSeqs: [targetSeq] })
    } else {
      // `turn` is the native turn that draws the reply; after a regeneration it differs from the
      // story round, which the replacement names like a projection does (story alignment).
      const story = Number(message.turn)
      replaceSessionSurface(session, 'assistant/message', {
        turn, step: 1,
        message: { id, role: 'assistant', content: [{ type: 'text', text: message.text }], source: { kind: 'model', provider: 'dsh-tavern', model: 'body-edit', ...(Number.isSafeInteger(story) && story > 0 ? { tavernStoryTurn: story } : {}) } }
      }, { start: targetSeq, end: targetSeq, sourceEventSeqs: [targetSeq] })
    }
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
export function createBodyEditor({ chats, sessions, timeline, activity, project, present, sessionPatch, repairNative, beforeReplyEdit }) {
  const pending = new Set()
  function refuseClosedPatch() {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
  }
  function idle(chat, agent) {
    if (agent?.phase?.kind === 'running' || chat.regenInProgress || ['pending', 'running'].includes(chat.settleStatus) || activity(chat)?.busy) throw new Error('请等待当前生成或后台处理完成后再编辑')
  }
  async function context(sessionId) {
    refuseClosedPatch()
    let chat = await chats.forSession(sessionId)
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
    let message = latest(chat)
    const locate = () => locateRegenerationSurface({ events: sessionEvents(agent.session), nodes: agent.session.surface?.nodes, turn: message.turn })
    let target = locate()
    // The save is the truth: bring the native tail back to it, then edit; if the
    // round is still not there, edit the save and let repair carry the text over.
    if (!target && typeof repairNative === 'function') {
      await repairNative(sessionId, agent.session)
      chat = await chats.forSession(sessionId)
      idle(chat, agent)
      message = latest(chat)
      target = locate()
    }
    if (!target && typeof repairNative !== 'function') throw new Error('最后一轮正文已不在当前上下文中，无法编辑')
    const parts = editableReplyParts(source(message))
    if (!parts.some(part => part.kind === 'text' && part.text.trim())) throw new Error('这轮只有 HTML，没有可编辑文本')
    return { chat, agent, message, target, parts }
  }
  // A bounded history edits only its last floor: apply the same timeline intent to
  // the header and that floor, then patch them on the read revision. A moved
  // revision returns undefined so the complete path re-validates the edit token.
  async function saveLatestFloor(sessionId, chat, message, patch, target, agent, kind = 'body.edit') {
    if (!isScopedMessages(chat.messages) || typeof chats.patch !== 'function') return undefined
    const index = chat.messages.length - 1
    const { messages: _rows, ...header } = chat
    const edited = timeline.apply({ chat: { ...header, messages: [message] }, intent: { kind, turn: message.turn, patch } }).chat
    const { messages: [row], ...head } = edited
    const changes = diffJson({ ...header, messages: [] }, { ...head, messages: [] }).filter(change => !['_storageRevision', 'updatedAt'].includes(change.path[0]))
    for (const change of diffJson(message, row)) changes.push({ ...change, path: ['messages', index, ...change.path] })
    const saved = await chats.patch(chat.id, chat._storageRevision, changes, { source: 'foreground.body-edit', assertCurrent() {
      if (target && !agent.session.surface?.nodes.includes(target.assistantSeq)) throw new Error('模型上下文已变化，请重新打开编辑')
    } })
    if (!saved) return undefined
    if (target) await synchronizeBodyEdits(agent.session, { messages: [row] }, sessions.flush)
    else await repairNative(sessionId, agent.session)
    return present(saved)
  }
  async function read(sessionId) {
    const { chat, message, parts } = await context(sessionId)
    return { token: token(chat, message), turn: message.turn, parts: parts.map(part => part.kind === 'text' ? part : { kind: part.kind }) }
  }
  // The last reply's text parts as saved, for reading only (the 精修 review): no editing lock,
  // so it reads while the turn's settlement still runs. Writing goes through read/polish.
  async function peek(sessionId) {
    const chat = await chats.forSession(sessionId)
    if (!chat) throw new Error('会话不存在')
    return editableReplyParts(source(latest(chat))).filter(part => part.kind === 'text').map(part => part.text)
  }
  // `kind`: body.edit, or body.polish for 自动精修 (same text checks, nothing else invalidated).
  // `polished`: the new text is a 精修 (manual or automatic); the reply shows 「已精修」 until it is edited again.
  async function saveText(sessionId, input, kind = 'body.edit', { polished = kind === 'body.polish' } = {}) {
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
        ...replyProse(text, { ...reply, projectionText: text }),
        // The scene stays the original reply's (scene-illustration.js), however often it is reworded.
        ...(kind === 'body.polish' ? { polishedFrom: message.polishedFrom || sceneSourceDigest(source(message)) } : {}),
        ...(polished ? { polished: true } : {}),
        ...(target ? { bodyEdit: { formatVersion: 4, id: 'tavern-body-edit:' + randomUUID(), seq: target.assistantSeq, turn: target.turn } } : {})
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
      if (target) {
        const preview = agent.session.constructor.fromRestore(agent.session.id, structuredClone(sessionEvents(agent.session)), structuredClone(agent.session.header), agent.session.inheritedEventCount, 'detached')
        await synchronizeBodyEdits(preview, { messages: [{ ...message, ...patch }] }, async () => {})
      }
      const patched = await saveLatestFloor(sessionId, chat, message, patch, target, agent, kind)
      if (patched) return patched
      const saved = await chats.update(chat.id, current => {
        idle(current, agent)
        if (token(current, latest(current)) !== input.token) throw new Error('正文或会话已变化，请重新打开编辑')
        if (target && !agent.session.surface?.nodes.includes(target.assistantSeq)) throw new Error('模型上下文已变化，请重新打开编辑')
        return timeline.apply({ chat: current, intent: { kind, turn: message.turn, patch } }).chat
      }, { source: kind === 'body.polish' ? 'foreground.body-polish' : 'foreground.body-edit' })
      if (target) await synchronizeBodyEdits(agent.session, saved, sessions.flush)
      else await repairNative(sessionId, agent.session)
      return present(saved)
    } finally { pending.delete(sessionId) }
  }
  // What hangs on the shown text version (dialogue speakers) follows the edit once it is saved.
  async function save(sessionId, input, options) {
    const carry = typeof beforeReplyEdit === 'function' ? await beforeReplyEdit(sessionId) : null
    const saved = await saveText(sessionId, input, 'body.edit', options)
    if (carry) await carry()
    return saved
  }
  // A player input is a floor too: the model surface gets a replacement
  // user/message, while the Chat keeps the new text so the page can render it.
  // Only that one message changes; no round is replayed and no settlement runs.
  function userMessageForTurn(chat, turn) {
    const messages = chat.messages || []
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (!message || message.role !== 'user' || message.greeting === true) continue
      const reply = messages[index + 1]
      const native = Number(reply?.native?.turn) || Number(reply?.nativeAnchor?.turn) || Number(reply?.turn) || 0
      if (native === turn || (message.bodyEdit && Number(message.bodyEdit.turn) === turn)) return { message, index }
    }
    return null
  }
  function userRecord(chat, turn) {
    const all = chat.userInputEdits
    const record = all && typeof all === 'object' && !Array.isArray(all) ? all[String(turn)] : undefined
    return record && typeof record === 'object' && typeof record.text === 'string' ? record : null
  }
  function userFallbackTurn(chat) {
    const messages = chat.messages || []
    const index = messages.findLastIndex(message => message && message.role === 'user' && message.greeting !== true)
    if (index < 0) return 0
    const reply = messages[index + 1]
    return Number(reply?.native?.turn) || Number(reply?.nativeAnchor?.turn) || Number(reply?.turn) || 0
  }
  async function userContext(sessionId, input) {
    refuseClosedPatch()
    let chat = await chats.forSession(sessionId)
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
    chat = await chats.forSession(sessionId)
    if (!chat) throw new Error('会话不存在')
    idle(chat, agent)
    const requested = Number(input?.turn) || 0
    const turn = requested > 0 ? requested : userFallbackTurn(chat)
    if (!Number.isSafeInteger(turn) || turn < 1) throw new Error('找不到这条输入对应的回合')
    const events = sessionEvents(agent.session)
    const end = events.findLast(event => event.type === 'turn/end' && Number(event.data?.turn) === turn)
    const failed = Boolean(end && isFailedTurnEnd(end.data?.reason?.kind))
    const found = userMessageForTurn(chat, turn)
    const record = userRecord(chat, turn)
    const markerSeq = Number(record?.seq) || Number(found?.message?.bodyEdit?.seq) || 0
    let located = markerSeq > 0 ? locateUserEditFloor(agent.session, markerSeq) : null
    if (!located) located = locateUserInputFloor(agent.session, turn)
    if (!located && failed) {
      // A failed turn may already have been cleaned from the model surface (an
      // old save or a previous retry). Its input is still in the log; use that
      // exact text, but save the edit as an overlay instead of touching Surface.
      const seq = Number(input?.seq) || 0
      const original = (seq > 0 ? events.find(event => Number(event.seq) === seq && event.type === 'user/message' && inputKind(event.data) === 'player') : null)
        || inputEventForTurn(agent.session, turn)
      if (original && inputKind(original.data) === 'player') located = { seq: Number(original.seq), event: original, turn }
    }
    // Never fall back to "the newest input": that edits another message.
    if (!located) throw new Error('这条输入已不在当前上下文中，无法编辑')
    const text = record ? record.text : found ? String(found.message.text ?? '') : userInputText(located.event)
    return { chat, agent, message: found?.message || null, index: found?.index ?? -1, turn, located, text, record, failed }
  }
  function userToken(chat, context) {
    return createHash('sha256').update(JSON.stringify([chat.id, chat.timeline?.branchId, chat._storageRevision, context.turn, context.text,
      context.record?.id || '', context.message?.bodyEdit?.id || '', context.failed === true ? 'failed' : ''])).digest('hex')
  }
  async function readUser(sessionId, input) {
    const context = await userContext(sessionId, input)
    return { token: userToken(context.chat, context), role: 'user', index: context.index, turn: context.turn, seq: context.located.seq,
      failed: context.failed === true, parts: [{ kind: 'text', text: context.text }] }
  }
  async function saveUser(sessionId, input) {
    if (pending.has(sessionId)) throw new Error('正在保存正文，请稍候')
    pending.add(sessionId)
    try {
      const context = await userContext(sessionId, input)
      if (input?.token !== userToken(context.chat, context)) throw new Error('输入或会话已变化，请重新打开编辑')
      const texts = input.texts
      if (!Array.isArray(texts) || texts.length !== 1 || typeof texts[0] !== 'string') throw new Error('编辑文本格式无效')
      const text = texts[0]
      if (text.trim() === '') throw new Error('输入不能为空')
      // A failed turn is edited as a Chat overlay: the input may already be gone
      // from the model surface, and the next retry/withdraw will read this text.
      // Nothing on the Session is changed here.
      if (context.failed) {
        if (text === context.text) return present(context.chat)
        const editId = 'tavern-user-edit:' + randomUUID()
        const saved = await chats.update(context.chat.id, current => {
          idle(current, context.agent)
          current.userInputEdits = { ...(current.userInputEdits && typeof current.userInputEdits === 'object' && !Array.isArray(current.userInputEdits) ? current.userInputEdits : {}),
            [String(context.turn)]: { text, id: editId, seq: context.located.seq } }
          return current
        }, { source: 'foreground.user-edit' })
        return present(saved)
      }
      if (text === context.text) return present(context.chat)
      const { chat, agent, turn, located } = context
      const editId = 'tavern-user-edit:' + randomUUID()
      const source = located.event.data?.source && typeof located.event.data.source === 'object'
        ? { ...located.event.data.source, kind: 'user' }
        : { kind: 'user' }
      const data = { id: editId, role: 'user', content: [{ type: 'text', text }], source }
      // A rejected host event must not publish a Chat text that future requests
      // keep trying to synchronize. Validate on an isolated copy first.
      const preview = agent.session.constructor.fromRestore(agent.session.id, structuredClone(sessionEvents(agent.session)), structuredClone(agent.session.header), agent.session.inheritedEventCount, 'detached')
      replaceSessionSurface(preview, 'user/message', data, { start: located.seq, end: located.seq, sourceEventSeqs: [located.seq] })
      const saved = await chats.update(chat.id, current => {
        idle(current, agent)
        const existing = userMessageForTurn(current, turn)
        const currentRecord = userRecord(current, turn)
        const before = currentRecord ? currentRecord.text : existing ? String(existing.message.text ?? '') : userInputText(located.event)
        if (before !== context.text) throw new Error('输入或会话已变化，请重新打开编辑')
        if (!agent.session.surface?.nodes.includes(located.seq)) throw new Error('模型上下文已变化，请重新打开编辑')
        const edits = current.userInputEdits && typeof current.userInputEdits === 'object' && !Array.isArray(current.userInputEdits)
          ? { ...current.userInputEdits } : {}
        edits[String(turn)] = { text, id: editId, seq: located.seq, role: 'user' }
        current.userInputEdits = edits
        if (existing) {
          existing.message.text = text
          existing.message.bodyEdit = { id: editId, seq: located.seq, turn, role: 'user' }
        }
        return current
      }, { source: 'foreground.user-edit' })
      replaceSessionSurface(agent.session, 'user/message', data, { start: located.seq, end: located.seq, sourceEventSeqs: [located.seq] })
      await sessions.flush(agent.session)
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
  // 自动精修: the reply reworded in place; dialogue speakers follow as for an edit.
  async function polish(sessionId, input) {
    const carry = typeof beforeReplyEdit === 'function' ? await beforeReplyEdit(sessionId) : null
    const saved = await saveText(sessionId, input, 'body.polish')
    if (carry) await carry()
    return saved
  }
  return Object.freeze({ read, peek, save, polish, readUser, saveUser, replaceText })
}
