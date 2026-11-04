import { randomUUID } from 'node:crypto'
import { createSessionSurfaceMutator } from './session-surface-mutations.js'
import { sessionEvents } from './session-events.js'
import { inputKind } from './session-turn-input.js'
import { upgradeReferences, upgradedAnchor } from './session-upgrade-references.js'

function str(value) { return typeof value === 'string' ? value : value == null ? '' : String(value) }
function integer(value, minimum = 0) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= minimum ? number : null
}
function textOf(data) {
  const content = data?.message?.content || data?.content || []
  return Array.isArray(content) ? content.filter(block => block?.type === 'text').map(block => str(block.text)).join('') : ''
}
function nativeTurn(row) {
  return integer(row?.nativeAnchor?.turn, 1) ?? integer(row?.native?.turn, 1) ?? integer(row?.turn, 1)
}
function storyTurn(row) { return integer(row?.turn, 1) ?? (row?.greeting === true ? 1 : null) }

// Structural deletion must not double as an MVU rollback. Native storage accepts
// the same explicit world selection used by history operations; when the active
// snapshot itself is removed, retain its world with a null floor anchor until a
// later turn publishes a new snapshot.
function activeWorldOf(chat) {
  for (let position = (chat.messages?.length || 0) - 1; position >= 0; position -= 1) {
    const row = chat.messages[position], swipe = Math.max(0, Number(row?.swipeId) || 0)
    const variables = row?.variables?.[swipe]
    if (variables && typeof variables === 'object' && !Array.isArray(variables)) {
      return { position, swipe, world: structuredClone({ variables, ...(chat.posture !== undefined ? { posture: chat.posture } : {}) }) }
    }
  }
  return { position: null, swipe: 0, world: { variables: {}, ...(chat.posture !== undefined ? { posture: chat.posture } : {}) } }
}
function worldAfterRemoval(world, removed) {
  if (world.position === null) return structuredClone(world)
  const position = removed.has(world.position) ? null
    : world.position - [...removed].filter(index => index < world.position).length
  return { position, swipe: world.swipe, world: structuredClone(world.world) }
}

/** Normalize the public wire shape once; Chat indices are never accepted. */
export function normalizeMessageDeletionSelectors(items) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('请选择要删除的消息')
  const unique = new Map()
  for (const item of items) {
    if (!item || typeof item !== 'object' || !['user', 'assistant'].includes(item.role)) throw new Error('消息删除选择器无效')
    const turn = integer(item.turn, 1), seq = integer(item.seq)
    if (turn === null || seq === null) throw new Error('消息删除选择器的回合或序号无效')
    let selector
    if (item.role === 'user') selector = { role: 'user', turn, seq }
    else {
      const storyTurn = integer(item.storyTurn, 1)
      const helperId = typeof item.messageId === 'number' ? integer(item.messageId) : null
      if (typeof item.messageId === 'number' && helperId === null) throw new Error('正文删除选择器无效')
      const messageId = helperId === null ? str(item.messageId).trim() : helperId
      if (storyTurn === null || messageId === '' || (typeof messageId !== 'number' && typeof messageId !== 'string')) throw new Error('正文删除选择器无效')
      selector = { role: 'assistant', turn, storyTurn, seq, messageId }
    }
    unique.set(JSON.stringify(selector), selector)
  }
  return [...unique.values()]
}

function turnBySeq(events) {
  const result = new Map()
  let turn = 0
  for (const event of events) {
    if (event?.type === 'turn/start') turn = integer(event.data?.turn) ?? 0
    result.set(Number(event?.seq), turn)
    if (event?.type === 'turn/end') turn = 0
  }
  return result
}

// Surface replacements keep their position but receive a new seq. Ownership is
// therefore lineage, not nodes.includes(originalSeq), especially after an edit.
function lineageResolver(events) {
  const bySeq = new Map(events.map(event => [Number(event.seq), event]))
  const cache = new Map()
  function roots(seq) {
    if (cache.has(seq)) return cache.get(seq)
    cache.set(seq, new Set([seq])) // cycle guard for damaged logs
    const event = bySeq.get(seq)
    const sources = Array.isArray(event?.sourceEventSeqs) ? event.sourceEventSeqs : []
    const result = new Set([seq])
    for (const source of sources) for (const root of roots(Number(source))) result.add(root)
    cache.set(seq, result)
    return result
  }
  return { bySeq, roots }
}

function descendant(events, nodes, originalSeq, type) {
  const { roots } = lineageResolver(events)
  const bySeq = new Map(events.map(event => [Number(event.seq), event]))
  const found = []
  for (const node of nodes) {
    const seq = Number(node), event = bySeq.get(seq)
    if (event?.type === type && roots(seq).has(originalSeq)) found.push(seq)
  }
  if (found.length > 1) throw new Error('消息在当前模型上下文中的位置不唯一')
  return found[0] ?? null
}

function surfacePlan(selected, nodes) {
  const positions = new Map(nodes.map((seq, index) => [Number(seq), index]))
  const present = selected.filter(item => item.surfaceSeq !== null).map(item => ({ ...item, position: positions.get(item.surfaceSeq) }))
  if (present.some(item => !Number.isSafeInteger(item.position) || item.position < 0)) throw new Error('模型上下文已变化，请重新读取消息')
  present.sort((left, right) => left.position - right.position)
  const groups = []
  for (const item of present) {
    const last = groups.at(-1)
    if (last && item.position === last.endPosition + 1) {
      last.endPosition = item.position
      last.items.push(item)
    } else groups.push({ startPosition: item.position, endPosition: item.position, items: [item] })
  }
  return groups.map((group, index) => {
    const sourceEventSeqs = nodes.slice(group.startPosition, group.endPosition + 1).map(Number)
    return {
      type: 'user/message',
      data: { id: `tavern-message-delete:${index}`, role: 'user', content: [], source: { kind: 'plugin:dsh-tavern', form: 'message-deletion' } },
      start: sourceEventSeqs[0], end: sourceEventSeqs.at(-1), sourceEventSeqs,
      messageUids: group.items.map(item => item.messageUid).filter(Boolean)
    }
  })
}

function assistantRow(chat, selector, events) {
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  if (typeof selector.messageId === 'number') {
    const row = messages[selector.messageId]
    if (row?.role !== 'assistant') throw new Error('要删除的正文已经变化，请刷新后重试')
    return { row, index: selector.messageId }
  }
  const references = upgradeReferences(events)
  const candidates = []
  for (let index = 0; index < messages.length; index++) {
    const row = messages[index]
    if (row?.role !== 'assistant' || storyTurn(row) !== selector.storyTurn) continue
    const anchor = row.nativeAnchor ? upgradedAnchor(row.nativeAnchor, references) : null
    if (anchor && (anchor.turn !== selector.turn || anchor.reply !== selector.seq)) continue
    if (!anchor && nativeTurn(row) !== selector.turn) continue
    candidates.push({ row, index, anchor })
  }
  if (candidates.length !== 1) throw new Error('要删除的正文已经变化，请刷新后重试')
  return candidates[0]
}

function userRows(chat, selector, events, original) {
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  const references = upgradeReferences(events)
  const expectedText = textOf(original?.data)
  const candidates = []
  for (let index = 0; index < messages.length; index++) {
    const row = messages[index]
    if (row?.role !== 'user') continue
    const edit = row.bodyEdit
    let matched = edit?.role === 'user' && integer(edit.turn, 1) === selector.turn && integer(edit.seq) === selector.seq
    const reply = messages[index + 1]
    const anchor = reply?.role === 'assistant' && reply.nativeAnchor ? upgradedAnchor(reply.nativeAnchor, references) : null
    if (anchor?.input === selector.seq && anchor.turn === selector.turn) matched = true
    if (!anchor && nativeTurn(reply) === selector.turn && (integer(row.turn, 1) === selector.turn || str(row.text) === expectedText)) matched = true
    if (integer(row.turn, 1) === selector.turn && str(row.text) === expectedText) matched = true
    if (matched) candidates.push({ row, index })
  }
  if (candidates.length !== 1) throw new Error('要删除的输入已经变化，请刷新后重试')
  return candidates[0]
}

function resolveSelectors(chat, session, selectors) {
  const events = sessionEvents(session), nodes = session.surface?.nodes || []
  if (!Array.isArray(nodes)) throw new Error('模型上下文尚未就绪')
  const bySeq = new Map(events.map(event => [Number(event.seq), event]))
  const turns = turnBySeq(events)
  const resolved = new Map()
  for (const selector of selectors) {
    const original = bySeq.get(selector.seq)
    let match, surfaceSeq = null, historical = null
    if (selector.role === 'assistant') {
      if (original?.type !== 'assistant/message' || integer(original.data?.turn, 1) !== selector.turn) throw new Error('正文原生序号或回合不匹配')
      match = assistantRow(chat, selector, events)
      if (storyTurn(match.row) !== selector.storyTurn || nativeTurn(match.row) !== selector.turn) throw new Error('正文剧情回合或原生回合不匹配')
      surfaceSeq = descendant(events, nodes, selector.seq, 'assistant/message')
      if (typeof selector.messageId !== 'number') {
        const candidates = events.filter(event => event?.type === 'assistant/message' && str(event.data?.message?.id) === selector.messageId)
        const { roots } = lineageResolver(events)
        const owned = candidates.filter(event => roots(Number(event.seq)).has(selector.seq))
        if (!owned.length) throw new Error('正文标识已变化，请刷新后重试')
        // The current descendant may have a post-edit id. The selector may name
        // either that id or the original append id; both must share this lineage.
        historical = (surfaceSeq !== null ? bySeq.get(surfaceSeq) : owned.at(-1))?.seq ?? null
        if (historical === null) throw new Error('正文标识与原生序号不匹配')
      }
    } else {
      if (original?.type !== 'user/message' || inputKind(original.data) !== 'player' || turns.get(selector.seq) !== selector.turn) throw new Error('输入原生序号或回合不匹配')
      match = userRows(chat, selector, events, original)
      surfaceSeq = descendant(events, nodes, selector.seq, 'user/message')
    }
    // A compacted row may be deleted from Chat alone. Never invent a tombstone
    // for a node which is not on the current surface.
    const key = `${match.index}:${match.row.role}`
    const nativeEvent = selector.role === 'assistant' ? bySeq.get(surfaceSeq ?? historical) : null
    const value = { ...match, selector, surfaceSeq, historicalSeq: historical, nativeMessageId: str(nativeEvent?.data?.message?.id), messageUid: match.row.messageUid || null }
    if (resolved.has(key)) {
      const previous = resolved.get(key)
      if (previous.surfaceSeq !== value.surfaceSeq) throw new Error('重复选择器指向了不同原生位置')
    } else resolved.set(key, value)
  }
  return [...resolved.values()]
}

function comparableOperations(operations) {
  return operations.map(operation => ({ type: operation.type, start: operation.start, end: operation.end, sourceEventSeqs: operation.sourceEventSeqs }))
}

/** Build the native write set from the current Chat and current surface. */
export function planMessageDeletion(chat, session, selectors, operationId = 'preview') {
  const selected = resolveSelectors(chat, session, selectors)
  const operations = surfacePlan(selected, session.surface?.nodes || []).map(operation => ({
    ...operation,
    data: { ...operation.data, id: `tavern-message-delete:${operationId}:${operation.data.id.split(':').at(-1)}`,
      source: { ...operation.data.source, deletionId: operationId } }
  }))
  return { selected, operations, operationSignature: JSON.stringify(comparableOperations(operations)) }
}

/** Apply an audited plan. Stable ids + source ranges make retries and restores no-ops. */
export function synchronizeMessageDeletion(session, chat, flush) {
  const audit = chat?.messageDeletion
  if (!audit || audit.version !== 1 || !Array.isArray(audit.surface?.operations)) return Promise.resolve(0)
  if (audit.surface.sessionId !== session.id) return Promise.reject(new Error('删除恢复计划属于另一个会话'))
  const mutator = createSessionSurfaceMutator(session)
  for (const operation of audit.surface.operations) {
    mutator.replace(operation.type, operation.data, { start: operation.start, end: operation.end, sourceEventSeqs: operation.sourceEventSeqs })
  }
  return Promise.resolve(audit.surface.operations.length && typeof flush === 'function' ? flush(session) : undefined).then(() => audit.surface.operations.length)
}

function clearTurnReferences(chat, selected) {
  const deletedUsers = new Set(selected.filter(item => item.selector.role === 'user').map(item => item.selector.turn))
  const deletedAssistants = selected.filter(item => item.selector.role === 'assistant')
  if (deletedUsers.size && chat.userInputEdits && typeof chat.userInputEdits === 'object' && !Array.isArray(chat.userInputEdits)) {
    const edits = { ...chat.userInputEdits }
    for (const turn of deletedUsers) delete edits[String(turn)]
    if (Object.keys(edits).length) chat.userInputEdits = edits
    else delete chat.userInputEdits
  }
  if (deletedAssistants.length && chat.candidates && typeof chat.candidates === 'object') {
    const candidate = str(chat.candidates.messageId)
    if (deletedAssistants.some(item => str(item.selector.messageId) === candidate || item.nativeMessageId === candidate || str(item.row.id) === candidate)) chat.candidates = null
  }
  // Keep nativeCommits even when a floor is deleted. They are adoption barriers,
  // not display text: removing the latest one lets uncommittedRounds resurrect a
  // deleted user floor from the still-visible assistant reply on the next reconcile.
}

function preserveSplitRoundMarkers(chat, selected, removed) {
  for (const item of selected) {
    if (item.selector.role === 'assistant') {
      for (let index = item.index - 1; index >= 0 && chat.messages[index]?.role === 'user'; index -= 1) {
        const user = chat.messages[index]
        if (!removed.has(index) && !integer(user.turn, 1)) user.turn = item.selector.storyTurn
      }
    } else {
      const greeting = chat.messages[item.index + 1]
      if (greeting?.role === 'assistant' && greeting.greeting === true && !removed.has(item.index + 1)) greeting.openingInputDeleted = true
    }
  }
}

function detached(session) {
  if (typeof session?.constructor?.fromRestore !== 'function') throw new Error('当前会话不支持删除预演')
  return session.constructor.fromRestore(session.id, structuredClone(sessionEvents(session)), structuredClone(session.header), session.inheritedEventCount, 'detached')
}

export function createMessageDeletion({ chats, sessions, activity, view, sessionPatch }) {
  const pending = new Set()
  function idle(chat, agent) {
    const events = sessionEvents(agent?.session)
    const started = events.findLastIndex(event => event?.type === 'turn/start'), ended = events.findLastIndex(event => event?.type === 'turn/end')
    if ((agent?.phase?.kind && agent.phase.kind !== 'idle') || started > ended || chat.regenInProgress || ['pending', 'running', 'waiting-runtime'].includes(chat.settleStatus) || activity?.(chat)?.busy) {
      throw new Error('请等待当前生成或后台处理完成后再删除消息')
    }
  }
  async function remove(args) {
    const sessionId = str(args?.sessionId)
    if (!sessionId) throw new Error('缺少会话')
    if (sessionPatch && !sessionPatch.replacementAllowed()) throw new Error(sessionPatch.blockReason())
    if (pending.has(sessionId)) throw new Error('正在删除消息，请稍候')
    const selectors = normalizeMessageDeletionSelectors(args?.items)
    pending.add(sessionId)
    try {
      const chat = await chats.forSession(sessionId)
      if (!chat) throw new Error('会话不存在')
      const agent = sessions.get(sessionId)
      if (!agent?.session) throw new Error('无法访问原生会话')
      idle(chat, agent)
      const operationId = randomUUID()
      const prepared = planMessageDeletion(chat, agent.session, selectors, operationId)
      // Host validation happens before any durable deletion. No Chat write is
      // attempted when even one selector or one surface segment is stale.
      const preview = detached(agent.session)
      const previewMutator = createSessionSurfaceMutator(preview)
      for (const operation of prepared.operations) previewMutator.replace(operation.type, operation.data, operation)
      let worldSelection
      const deletionMetadata = { source: 'foreground.message-delete' }
      const saved = await chats.update(chat.id, current => {
        idle(current, agent)
        if (current.sessionId !== sessionId) throw new Error('会话已切换，请刷新后重试')
        // Backfill stable ids for old and new rows in the same CAS transaction;
        // deleted ids remain in the audit, survivors keep theirs across splices.
        for (const row of current.messages || []) if (row && typeof row === 'object' && !str(row.messageUid)) row.messageUid = randomUUID()
        const latest = planMessageDeletion(current, agent.session, selectors, operationId)
        if (latest.operationSignature !== prepared.operationSignature) throw new Error('模型上下文已变化，请重新读取消息')
        const removed = new Set(latest.selected.map(item => item.index))
        const auditItems = latest.selected.map(item => ({ ...item.selector, messageUid: item.row.messageUid, surfaceSeq: item.surfaceSeq }))
        const operations = surfacePlan(latest.selected, agent.session.surface.nodes).map(operation => ({
          ...operation,
          data: { ...operation.data, id: `tavern-message-delete:${operationId}:${operation.data.id.split(':').at(-1)}`,
            source: { ...operation.data.source, deletionId: operationId } }
        }))
        const missing = latest.selected.filter(item => item.surfaceSeq === null).map(item => ({ messageUid: item.row.messageUid, role: item.row.role, turn: item.selector.turn }))
        const activeWorld = activeWorldOf(current)
        worldSelection = { old: activeWorld, selected: worldAfterRemoval(activeWorld, removed) }
        deletionMetadata.worldSelection = worldSelection
        clearTurnReferences(current, latest.selected)
        preserveSplitRoundMarkers(current, latest.selected, removed)
        current.messages = current.messages.filter((_, index) => !removed.has(index))
        current.tavernHelperLifecycleRevision = Math.max(0, Number(current.tavernHelperLifecycleRevision) || 0) + 1
        current.messageDeletion = {
          version: 1, id: operationId, at: Date.now(), status: 'pending', deletedCount: removed.size, items: auditItems,
          surface: { sessionId, operations },
          ...(missing.length ? { contextRepair: { required: true, reason: 'compacted-or-absent', items: missing } } : {})
        }
        current.nativeSync = { status: 'stale', reason: '消息删除等待原生上下文同步', at: Date.now(), deletionId: operationId }
        return current
      }, deletionMetadata)
      if (!saved?.messageDeletion || saved.messageDeletion.id !== operationId) throw new Error('消息删除未提交，请刷新后重试')
      try {
        await synchronizeMessageDeletion(agent.session, saved, sessions.flush)
      } catch (error) {
        await chats.update(saved.id, current => {
          if (current.messageDeletion?.id !== operationId) return undefined
          current.messageDeletion.status = 'surface-pending'
          current.messageDeletion.surfaceError = str(error?.message || error)
          current.nativeSync = { status: 'stale', reason: '消息删除原生同步失败', at: Date.now(), deletionId: operationId }
          return current
        }, { source: 'foreground.message-delete-stale', worldSelection }).catch(() => {})
        throw error
      }
      const completed = await chats.update(saved.id, current => {
        if (current.messageDeletion?.id !== operationId) return undefined
        current.messageDeletion.status = 'synchronized'
        current.messageDeletion.synchronizedAt = Date.now()
        if (current.messageDeletion.contextRepair?.required === true) {
          current.nativeSync = { status: 'stale', reason: '删除消息涉及压缩历史，仍需后续上下文修复', at: Date.now(), deletionId: operationId }
        } else if (current.nativeSync?.deletionId === operationId) delete current.nativeSync
        return current
      }, { source: 'foreground.message-delete-synchronized', worldSelection })
      return { view: await view(sessionId), deletedCount: saved.messageDeletion.deletedCount, chat: completed || saved }
    } finally { pending.delete(sessionId) }
  }
  return Object.freeze({ remove })
}
