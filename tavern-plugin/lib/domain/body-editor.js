import { upgradeReferences } from './session-upgrade-references.js'
import { replaceSessionSurface } from './session-surface-mutations.js'
import { createHash, randomUUID } from 'node:crypto'
import { editableReplyParts, projectProcessedReply } from './reply-presentation.js'
import { replyProse } from './reply-prose.js'
import { sceneSourceDigest } from './scene-illustration.js'
import { locateRegenerationSurface } from './rollback-surface.js'
import { sessionEvents } from './session-events.js'
import { isScopedMessages } from './scoped-messages.js'
import { diffJson } from './json-mutation.js'
import { locateUserEditFloor, locateUserInputFloor, userInputText } from './input-floor.js'
import { inputEventForTurn, inputKind, isFailedTurnEnd } from './session-turn-input.js'
import { legacyMessageUid, validMessageUid } from './message-uid.js'

function latest(chat) {
  const message = chat.messages?.at(-1)
  if (!['story', 'script'].includes(chat.mode || 'story') || message?.role !== 'assistant' || message.greeting) throw new Error('只能编辑最后一轮正文')
  return message
}
function source(message) { return message.projectionText ?? message.sourceText ?? message.text ?? '' }
// Player rows render message.text. Legacy/native imports may also carry an
// assistant-style sourceText; that field must not resurrect the pre-edit input.
function storyUserText(message) { return typeof message?.text === 'string' ? message.text : source(message) }
function token(chat, message) {
  // The last reply is addressed by position, so the row's own prose is the fence:
  // a settlement pass, a header write or a template-cache refresh must not
  // invalidate an editor the player already has open. An append moves the tail,
  // and latest() never returns anything but an assistant tail.
  return storyToken(chat, message, (chat.messages?.length || 1) - 1, 'assistant')
}
function storageRevision(chat) { return Math.max(0, Number(chat && chat._storageRevision) || 0) }
// Story rows are addressed by array position (story-transcript.js absoluteIndex); the
// row itself is the target, so a missing, duplicated or non-monotonic turn cannot
// move the edit to another message.
function hasStoryMessageIndex(input) {
  return Boolean(input && input.messageIndex !== undefined && input.messageIndex !== null)
}
function storyMessageIndex(input) {
  if (!hasStoryMessageIndex(input)) return null
  const index = Number(input.messageIndex)
  return Number.isSafeInteger(index) && index >= 0 ? index : null
}
function storyRevision(input) {
  if (!input || input.revision === undefined || input.revision === null) return null
  const revision = Number(input.revision)
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null
}
function storyMessageUid(input) {
  return validMessageUid(input?.messageUid) ? input.messageUid : null
}
/** UID edits bind the logical row, not unrelated Chat/timeline write counters. */
function storyToken(chat, message, index, role, messageUid = null) {
  // Settlement variables, receipts, display caches and edit markers never change
  // the text being edited; the Chat write counter and timeline revision are not
  // part of the row's identity either. Swipes, anchors and other edit inputs stay
  // CAS-protected.
  const { displayRuntime: _capture, tavernPluginData: _templateCache, variables: _variables,
    mvu: _receipt, sessionText: _sessionText, bodyEdit: _oldEdit, ...body } = message
  // A UID names the logical row; without one the index does, and the body covers
  // the occupant so a shifted list still refuses the write.
  const identity = messageUid ? ['story-message', messageUid] : ['story-row', Number.isSafeInteger(index) ? index : null]
  return createHash('sha256').update(JSON.stringify([chat.id, chat.timeline?.branchId, role, ...identity, body])).digest('hex')
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
export function createBodyEditor({ chats, sessions, timeline, activity, project, present, sessionPatch, beforeReplyEdit, queuedEditApplied }) {
  const pending = new Set()
  // An edit submitted while a turn is running is not refused: it waits here and
  // applies once that turn ends. Only the write waits — reading the row it points
  // at is side-effect free, so the editor opens during generation too.
  const waiting = new Map()
  const WAITING_LIMIT = 8
  function refuseClosedPatch() {
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
  }
  function generating(chat, agent) {
    return agent?.phase?.kind === 'running' || Boolean(chat && chat.regenInProgress)
      || ['pending', 'running'].includes(chat && chat.settleStatus) || Boolean(activity(chat)?.busy)
  }
  function idle(chat, agent, options) {
    if (options && options.whileBusy === true) return
    if (generating(chat, agent)) throw new Error('请等待当前生成或后台处理完成后再编辑')
  }
  // Same target, later text wins: a player who edits twice while one turn runs
  // means the last version, not both writes replayed in order.
  function waitingKey(role, input) {
    const index = Number(input && input.messageIndex)
    if (Number.isSafeInteger(index)) return role + ':row:' + index
    const turn = Number(input && input.turn)
    if (Number.isSafeInteger(turn) && turn > 0) return role + ':turn:' + turn
    const seq = Number(input && input.seq)
    return role + ':seq:' + (Number.isSafeInteger(seq) ? seq : 0)
  }
  function waitForTurn(sessionId, role, input, replay) {
    const list = waiting.get(sessionId) || []
    const key = waitingKey(role, input)
    const existing = list.findIndex(entry => entry.key === key)
    if (existing >= 0) list.splice(existing, 1)
    list.push({ key, role, input, replay, at: Date.now() })
    while (list.length > WAITING_LIMIT) list.shift()
    waiting.set(sessionId, list)
    return { queued: true, queuedCount: list.length, view: null }
  }
  // Replay in the order the player submitted: each save re-checks its own token,
  // so a row that moved on (another edit, a regeneration, a rollback) drops this
  // text instead of writing it over a target it was not written for.
  async function flushQueued(sessionId, attempt = 0) {
    const list = waiting.get(sessionId)
    if (!Array.isArray(list) || list.length === 0) return 0
    // Take the batch out of the map: an edit queued while this pass runs is a new
    // submission and must not be overwritten when the pass puts its leftovers back.
    waiting.delete(sessionId)
    const unapplied = []
    let applied = 0
    for (const entry of list) {
      try { await entry.replay(); applied += 1 }
      catch (error) {
        const message = String((error && error.message) || error)
        // Still running (or another save holds the lock): keep it for the next pass.
        if (/等待当前生成|后台处理完成后再编辑|正在保存正文/.test(message)) { unapplied.push(entry); continue }
        // The target changed under the queued text; the editor's own conflict is the report.
        console.warn('dsh-tavern: 排队编辑未应用（目标已变化）：' + message)
      }
    }
    const later = waiting.get(sessionId) || []
    if (unapplied.length) {
      waiting.set(sessionId, later.length ? [...unapplied, ...later] : unapplied)
      // The turn ends between the host's event and the agent going idle: retry on a
      // short backoff instead of asking the player to press 保存 again.
      if (attempt < 40) {
        const timer = setTimeout(() => { void flushQueued(sessionId, attempt + 1) }, 250)
        if (typeof timer.unref === 'function') timer.unref()
      }
      return applied
    }
    if (later.length === 0 && waiting.get(sessionId) === undefined) waiting.delete(sessionId)
    if (applied > 0 && typeof queuedEditApplied === 'function') { try { await queuedEditApplied(sessionId) } catch {} }
    return applied
  }
  // Whether a turn owns this session right now: callers use it to skip work that
  // must not race the running turn (story reconciliation, for one).
  async function isBusy(sessionId) {
    const chat = await chats.forSession(sessionId)
    return generating(chat, sessions.get(sessionId))
  }
  function queuedCount(sessionId) {
    const list = waiting.get(sessionId)
    return Array.isArray(list) ? list.length : 0
  }
  async function runOrWait(sessionId, role, input, run) {
    const chat = await chats.forSession(sessionId)
    const agent = sessions.get(sessionId)
    if (!chat || !generating(chat, agent)) return run()
    return waitForTurn(sessionId, role, input, run)
  }
  // Mirror the model context onto the save first: pending body-edit anchors are
  // replayed, and markers that no longer match any session event are dropped.
  async function syncChatMarkers(agent, chat) {
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
  }
  async function openChat(sessionId, options) {
    refuseClosedPatch()
    const chat = await chats.forSession(sessionId)
    if (!chat) throw new Error('会话不存在')
    const agent = sessions.get(sessionId)
    if (!agent?.session) throw new Error('无法访问原生会话')
    idle(chat, agent, options)
    return { chat, agent, busy: generating(chat, agent) }
  }
  // A UID names the logical Chat row across unrelated writes and index movement.
  // `messageIndex` remains a required hint, never the identity when a UID exists.
  // Old clients without one retain the exact revision fence below.
  function storyRow(chat, input, role) {
    const messages = Array.isArray(chat.messages) ? chat.messages : []
    const requestedIndex = storyMessageIndex(input)
    if (requestedIndex === null) throw new Error('这条消息已不在当前列表中，请刷新后重新打开编辑')
    if (typeof input?.role === 'string' && input.role !== role) throw new Error('这条消息已变化，请重新打开编辑')
    const messageUid = storyMessageUid(input)
    if (messageUid) {
      const candidates = []
      for (let index = 0; index < messages.length; index++) {
        const message = messages[index]
        if (legacyMessageUid(message, index) === messageUid) candidates.push({ message, index })
      }
      if (candidates.length !== 1 || candidates[0].message?.role !== role) throw new Error('这条消息已变化，请重新打开编辑')
      return { chat, ...candidates[0], revision: storageRevision(chat), messageUid }
    }
    if (requestedIndex >= messages.length) throw new Error('这条消息已不在当前列表中，请刷新后重新打开编辑')
    const message = messages[requestedIndex]
    if (!message || typeof message !== 'object' || message.role !== role) throw new Error('这条消息已变化，请重新打开编辑')
    const revision = storyRevision(input)
    // The revision is the panel's render stamp, not a fence on the Chat write
    // counter: settlement, candidates and worldbook syncs bump it without touching
    // this row. The row still has to hold the prose the caller rendered — a save
    // carries a storyToken, which fences the same row by identity and body.
    if (revision === null) throw new Error('正文或会话已变化，请重新打开编辑')
    const prose = typeof message.text === 'string' ? message.text : String(message.text ?? '')
    const namesRow = typeof input?.text === 'string' ? input.text === prose : null
    if (namesRow === false) throw new Error('正文或会话已变化，请重新打开编辑')
    if (namesRow === null && typeof input?.token !== 'string' && storageRevision(chat) !== revision) throw new Error('正文或会话已变化，请重新打开编辑')
    return { chat, index: requestedIndex, message, revision: storageRevision(chat), messageUid: null }
  }
  async function storyContext(sessionId, input, role, options) {
    refuseClosedPatch()
    const chat = await chats.forSession(sessionId)
    if (!chat) throw new Error('会话不存在')
    const agent = sessions.get(sessionId)
    const busy = generating(chat, agent)
    idle(chat, agent, options)
    // Chat rows remain editable when an old save has no live native Session.
    // Marker replay and Surface repair are downstream conveniences, not addressing:
    // a running turn owns the Session's write path, so the read stays Chat-only.
    if (agent?.session && !busy) await syncChatMarkers(agent, chat)
    return { agent, ...storyRow(chat, input, role) }
  }
  // Valid prose edits only: same text parts, no new HTML, no empty reply.
  function checkedTexts(parts, texts) {
    if (!Array.isArray(texts) || texts.length !== parts.filter(part => part.kind === 'text').length || texts.some(text => typeof text !== 'string')) throw new Error('编辑文本格式无效')
    if (!texts.some(text => text.trim())) throw new Error('正文不能为空')
    if (texts.some(text => editableReplyParts(text).some(part => part.kind !== 'text'))) throw new Error('这里只能编辑文本，不能新增 HTML')
  }
  // Cards' status blocks must start on their own line. An edit box hides the blank lines
  // around a text part, so keep the original edges when the edited text has none.
  function joinedText(parts, texts) {
    const keepEdges = (original, edited) => (/^\s/.test(edited) ? '' : original.match(/^\s*/)[0]) + edited + (/\s$/.test(edited) ? '' : original.match(/\s*$/)[0])
    let index = 0
    return parts.map(part => part.kind === 'text' ? keepEdges(part.text, texts[index++]) : part.text).join('')
  }
  async function editPatch(chat, message, text, kind, polished, target) {
    const reply = message.bodyRegenerationProcessed === true ? projectProcessedReply(text) : await project(text, chat)
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
    return patch
  }
  // Rewrite a native row only when its anchor/turn still locates this exact text.
  // Earlier floors must be updated too: the next request reads this surface, not
  // the Chat's edited copy. Ambiguous repeated or missing rows stay Chat-only.
  function storyNativeTarget(chat, index, agent, message) {
    if (!agent?.session || chat.messages[index]?.greeting === true) return null
    const turn = Number(message && message.turn)
    if (!Number.isSafeInteger(turn) || turn < 1) return null
    const events = sessionEvents(agent.session)
    const storedSeq = Number(message?.nativeAnchor?.reply)
    const located = locateRegenerationSurface({ events, nodes: agent.session.surface?.nodes,
      seq: Number.isSafeInteger(storedSeq) && storedSeq >= 0 ? storedSeq : undefined, turn })
    if (!located) return null
    const event = events.find(entry => Number(entry.seq) === Number(located.assistantSeq))
    const content = event && event.data && event.data.message ? event.data.message.content : null
    const text = Array.isArray(content) ? content.map(block => block && block.type === 'text' ? block.text : '').join('') : ''
    return text === String(source(message)) ? located : null
  }
  // The last assistant row keeps the timeline's settlement semantics; a history row
  // only changes its own prose (its settlement already happened and is not redone).
  function applyStoryPatch(chat, index, message, patch, kind) {
    const tail = index === chat.messages.length - 1 && chat.messages[index]?.greeting !== true
    const turn = Number(message.turn)
    if (tail && Number.isSafeInteger(turn) && turn > 0 && timeline && typeof timeline.apply === 'function') {
      return timeline.apply({ chat, intent: { kind, turn, patch } }).chat
    }
    Object.assign(chat.messages[index], patch)
    delete chat.messages[index].displayRuntime
    delete chat.messages[index].sessionText
    delete chat.messages[index].polishedFrom
    if (patch.polished !== true) delete chat.messages[index].polished
    return chat
  }
  async function context(sessionId, options) {
    const { chat: opened, agent, busy } = await openChat(sessionId, options)
    let chat = opened
    // The last reply's row is a Chat read: while a turn runs the Session write
    // path belongs to that turn, so marker replay waits for the save.
    if (!busy) await syncChatMarkers(agent, chat)
    let message = latest(chat)
    const locate = () => locateRegenerationSurface({ events: sessionEvents(agent.session), nodes: agent.session.surface?.nodes, turn: message.turn })
    let target = locate()
    // Editing needs the round to still be in the model context. A missing round is
    // refused here; nothing rewrites the native tail behind the player's back.
    if (!target) throw new Error('最后一轮正文已不在当前上下文中，无法编辑')
    const parts = editableReplyParts(source(message))
    if (!parts.some(part => part.kind === 'text' && part.text.trim())) throw new Error('这轮只有 HTML，没有可编辑文本')
    return { chat, agent, busy, message, target, parts }
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
    await synchronizeBodyEdits(agent.session, { messages: [row] }, sessions.flush)
    return present(saved)
  }
  async function read(sessionId, input) {
    if (hasStoryMessageIndex(input)) return readStoryMessage(sessionId, input)
    const { chat, message, parts } = await context(sessionId, { whileBusy: true })
    return { token: token(chat, message), turn: message.turn, parts: parts.map(part => part.kind === 'text' ? part : { kind: part.kind }) }
  }
  // Story view: read the row the list points at (no turn, no native floor needed).
  async function readStoryMessage(sessionId, input) {
    const { chat, message, index, revision, messageUid } = await storyContext(sessionId, input, 'assistant', { whileBusy: true })
    const parts = editableReplyParts(source(message))
    if (!parts.some(part => part.kind === 'text' && part.text.trim())) throw new Error('这轮只有 HTML，没有可编辑文本')
    return {
      role: 'assistant',
      token: storyToken(chat, message, index, 'assistant', messageUid),
      index,
      messageIndex: index,
      revision,
      ...(messageUid ? { messageUid } : {}),
      turn: Number(message.turn) || 0,
      parts: parts.map(part => part.kind === 'text' ? part : { kind: part.kind })
    }
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
      checkedTexts(parts, texts)
      const text = joinedText(parts, texts)
      if (text === source(message)) return present(chat)
      const patch = await editPatch(chat, message, text, kind, polished, target)
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
      return present(saved)
    } finally { pending.delete(sessionId) }
  }
  // Story save: the row is chosen by its position, the token binds it to the save
  // revision. A row without an exact native match is written to the Chat only.
  async function saveStoryText(sessionId, input, kind = 'body.edit', { polished = kind === 'body.polish' } = {}) {
    if (pending.has(sessionId)) throw new Error('正在保存正文，请稍候')
    pending.add(sessionId)
    try {
      const { chat, agent, message, index, revision, messageUid } = await storyContext(sessionId, input, 'assistant')
      if (input?.token !== storyToken(chat, message, index, 'assistant', messageUid)) throw new Error('正文或会话已变化，请重新打开编辑')
      const parts = editableReplyParts(source(message))
      if (!parts.some(part => part.kind === 'text' && part.text.trim())) throw new Error('这轮只有 HTML，没有可编辑文本')
      checkedTexts(parts, input.texts)
      const text = joinedText(parts, input.texts)
      if (text === source(message)) return present(chat)
      const target = storyNativeTarget(chat, index, agent, message)
      const patch = await editPatch(chat, message, text, kind, polished, target)
      // Validate on an isolated native Session before the durable Chat write, exactly
      // like the last-reply path: a rejected host event must not publish the edit.
      if (target) {
        const preview = agent.session.constructor.fromRestore(agent.session.id, structuredClone(sessionEvents(agent.session)), structuredClone(agent.session.header), agent.session.inheritedEventCount, 'detached')
        await synchronizeBodyEdits(preview, { messages: [{ ...message, ...patch }] }, async () => {})
      }
      const saved = await chats.update(chat.id, current => {
        idle(current, agent)
        const row = storyRow(current, { messageIndex: index, revision, messageUid }, 'assistant')
        if (storyToken(current, row.message, row.index, 'assistant', messageUid) !== input.token) throw new Error('正文或会话已变化，请重新打开编辑')
        return applyStoryPatch(current, row.index, row.message, patch, kind)
      }, { source: kind === 'body.polish' ? 'foreground.body-polish' : 'foreground.body-edit' })
      if (target) await synchronizeBodyEdits(agent.session, saved, sessions.flush)
      return present(saved)
    } finally { pending.delete(sessionId) }
  }
  // What hangs on the shown text version (dialogue speakers) follows the edit once it is saved.
  async function save(sessionId, input, options) {
    return runOrWait(sessionId, 'assistant', input, async () => {
      const carry = typeof beforeReplyEdit === 'function' ? await beforeReplyEdit(sessionId) : null
      const saved = hasStoryMessageIndex(input)
        ? await saveStoryText(sessionId, input, 'body.edit', options)
        : await saveText(sessionId, input, 'body.edit', options)
      if (carry) await carry()
      return saved
    })
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
  // A player row often carries no turn of its own; its native round is the reply's.
  // This is used for the native floor only, never to pick the Chat row.
  function userStoryTurn(chat, index, message) {
    const own = Number(message && message.turn)
    if (Number.isSafeInteger(own) && own > 0) return own
    const reply = (chat.messages || [])[index + 1]
    return Number(reply?.native?.turn) || Number(reply?.nativeAnchor?.turn) || Number(reply?.turn) || 0
  }
  // The native input floor for this row: only when it still holds the same text, so a
  // repeated or missing turn cannot point at another message.
  function userStoryFloor(agent, turn, original) {
    if (!agent?.session || !Number.isSafeInteger(turn) || turn < 1) return null
    const located = locateUserInputFloor(agent.session, turn)
    if (!located) return null
    return userInputText(located.event) === String(original) ? located : null
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
  async function userContext(sessionId, input, options) {
    refuseClosedPatch()
    let chat = await chats.forSession(sessionId)
    if (!chat) throw new Error('会话不存在')
    const agent = sessions.get(sessionId)
    if (!agent?.session) throw new Error('无法访问原生会话')
    const busy = generating(chat, agent)
    idle(chat, agent, options)
    // The marker replay writes the Session: it belongs to the turn while one runs.
    if (!busy) {
      await syncChatMarkers(agent, chat)
      chat = await chats.forSession(sessionId)
      if (!chat) throw new Error('会话不存在')
    }
    idle(chat, agent, options)
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
    return { chat, agent, busy, message: found?.message || null, index: found?.index ?? -1, turn, located, text, record, failed }
  }
  function userToken(chat, context) {
    // The native turn/seq, current text and edit marker identify this input;
    // an unrelated Chat write must not invalidate an open editor.
    return createHash('sha256').update(JSON.stringify([chat.id, chat.timeline?.branchId, context.turn, context.text,
      context.record?.id || '', context.message?.bodyEdit?.id || '', context.failed === true ? 'failed' : ''])).digest('hex')
  }
  async function readUser(sessionId, input) {
    if (hasStoryMessageIndex(input)) return readStoryUser(sessionId, input)
    const context = await userContext(sessionId, input, { whileBusy: true })
    return { token: userToken(context.chat, context), role: 'user', index: context.index, turn: context.turn, seq: context.located.seq,
      failed: context.failed === true, parts: [{ kind: 'text', text: context.text }] }
  }
  // Story view: the pointed-at player row, even when its turn is missing, repeated or
  // out of order; the row text is the save's own, never a turn's lookup result.
  async function readStoryUser(sessionId, input) {
    const { chat, message, index, revision, messageUid } = await storyContext(sessionId, input, 'user', { whileBusy: true })
    return { token: storyToken(chat, message, index, 'user', messageUid), role: 'user', index, messageIndex: index, revision,
      ...(messageUid ? { messageUid } : {}), turn: Number(message.turn) || 0, seq: 0, failed: false,
      parts: [{ kind: 'text', text: storyUserText(message) }] }
  }
  async function saveStoryUser(sessionId, input) {
    if (pending.has(sessionId)) throw new Error('正在保存正文，请稍候')
    pending.add(sessionId)
    try {
      const { chat, agent, message, index, revision, messageUid } = await storyContext(sessionId, input, 'user')
      if (input?.token !== storyToken(chat, message, index, 'user', messageUid)) throw new Error('输入或会话已变化，请重新打开编辑')
      const texts = input.texts
      if (!Array.isArray(texts) || texts.length !== 1 || typeof texts[0] !== 'string') throw new Error('编辑文本格式无效')
      const text = texts[0]
      if (text.trim() === '') throw new Error('输入不能为空')
      const before = storyUserText(message)
      if (text === before) return present(chat)
      const turn = userStoryTurn(chat, index, message)
      // The native input floor is used only when it still holds this exact row's text;
      // an ambiguous or missing round is repaired from the save instead.
      const located = userStoryFloor(agent, turn, storyUserText(message))
      const editId = 'tavern-user-edit:' + randomUUID()
      const marker = located ? { id: editId, seq: Number(located.seq), turn, role: 'user' } : null
      const saved = await chats.update(chat.id, current => {
        idle(current, agent)
        const row = storyRow(current, { messageIndex: index, revision, messageUid }, 'user')
        if (storyToken(current, row.message, row.index, 'user', messageUid) !== input.token) throw new Error('输入或会话已变化，请重新打开编辑')
        row.message.text = text
        if (marker) row.message.bodyEdit = marker
        return current
      }, { source: 'foreground.user-edit' })
      if (marker) await synchronizeBodyEdits(agent.session, saved, sessions.flush)
      return present(saved)
    } finally { pending.delete(sessionId) }
  }
  // A save requested while a turn runs waits for it: the editor stays open, and
  // the text lands once the round it points at can no longer move.
  async function saveUser(sessionId, input) {
    return runOrWait(sessionId, 'user', input, () => hasStoryMessageIndex(input)
      ? saveStoryUser(sessionId, input)
      : saveUserNow(sessionId, input))
  }
  async function saveUserNow(sessionId, input) {
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
  return Object.freeze({ read, peek, save, polish, readUser, saveUser, replaceText, flushQueued, queuedCount, isBusy })
}
