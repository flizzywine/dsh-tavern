import { sessionEvents } from './session-events.js'
import { inputKind, isNewTurnInput, storyPlayerInputs } from './session-turn-input.js'
import { clearRegenerationAttemptSurface, regenerationAttemptTurns, locateRegenerationSurface, applyRegenerationProjection } from './rollback-surface.js'

/**
 * `replacingDshTurns` once the committed body is projected. The old reply stays
 * hidden until that very write: before it the log has no projection yet, and the
 * row plan would draw the old turn next to the attempt — one body twice (#312).
 */
export function projectedReplacingTurns(chat) {
  const temporary = Number(chat?.regenRecovery?.temporaryReplacingTurn)
  const turns = Array.isArray(chat?.replacingDshTurns) ? chat.replacingDshTurns : []
  const kept = Number.isSafeInteger(temporary) ? turns.filter(turn => Number(turn) !== temporary) : turns
  return kept.length ? kept : undefined
}

/**
 * Recover an uncommitted replacement from its durable pre-rollback revision.
 * The save is the truth (Wiki「设计：native-session-repair」): whatever the
 * native session does, recovery always ends the marker. A native step that
 * fails leaves the save restored and the native tail stale for `repair`.
 */
export function createRegenerationRecovery({ chats, sessions, timeline, isActive, repair }) {
  const recovering = new Set()

  function staleNative(chat, reason) {
    chat.nativeSync = { status: 'stale', reason: '重新生成恢复：' + String(reason?.message || reason || ''), at: Date.now() }
  }
  function endMarker(chat) {
    const kept = projectedReplacingTurns(chat)
    if (kept) chat.replacingDshTurns = kept
    else delete chat.replacingDshTurns
    delete chat.regenInProgress
    delete chat.regenRecovery
  }
  async function repairAfter(chatId, session, reason) {
    console.warn('dsh-tavern: 重新生成恢复时模型上下文对不上，已按存档恢复，模型上下文稍后按存档修复：' + String(reason?.message || reason || ''))
    if (session && typeof repair === 'function') {
      try { await repair(session.id, session) } catch { /* nativeSync stays stale; the next reconcile retries. */ }
    }
  }
  // Last resort: the recovery point or the native boundary is gone. Restore what
  // the save still has (the original story when readable) and end the marker.
  async function release({ chatId, operationId, before, session, reason }) {
    const saved = await chats.update(chatId, current => {
      if (!current || current.regenInProgress !== true || (operationId && current.regenRecovery?.id !== operationId)) return
      const next = before && current.regenRecovery?.phase !== 'committed'
        ? timeline.apply({ chat: current, intent: { kind: 'replacement.abort', restoreChat: before } }).chat : current
      endMarker(next)
      next.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
      staleNative(next, reason)
      return next
    }, { source: 'foreground.regen-release' })
    await repairAfter(chatId, session, reason)
    return saved
  }

  async function originalState(chat) {
    const saved = chat.regenRecovery
    if (saved) {
      const before = saved.before || await chats.readRevision(chat.id, saved.beforeRevision)
      if (!before || before.id !== chat.id || before.regenInProgress) throw new Error('找不到重新生成前的存档恢复点')
      return before
    }
    // Old releases wrote only the flag. Walk backwards to the last state before
    // this uninterrupted run of flagged revisions; never guess from message count.
    for (let revision = Number(chat._storageRevision) - 1; revision >= 0; revision--) {
      const before = await chats.readRevision(chat.id, revision)
      if (!before || before.id !== chat.id) break
      if (before.regenInProgress !== true) return before
    }
    throw new Error('找不到旧版重新生成前的历史存档，未修改当前对话')
  }

  function legacyEventStart(before, session) {
    const events = sessionEvents(session)
    const assistant = before.messages?.findLast(message => message.role === 'assistant' && !message.greeting)
    const target = locateRegenerationSurface({ events, nodes: session.surface?.nodes || [], turn: assistant?.turn })
    if (!target) throw new Error('找不到原正文的原生消息，未修改当前对话')
    const attempt = events.find(event => event.seq > target.assistantSeq && isNewTurnInput(event) && inputKind(event.data) === 'regenerate')
    return attempt ? attempt.seq : events.length
  }

  async function abort({ chatId, originalChat, session, eventStart, operationId }) {
    // Hold the Chat store transaction across projection cleanup and flush. A
    // concurrent observer must not invalidate restoration after cleanup succeeds.
    let nativeError = null
    const saved = await chats.update(chatId, async current => {
      if (!current || current.regenRecovery?.phase === 'committed' || current.regenInProgress !== true ||
          (operationId && current.regenRecovery?.id !== operationId) ||
          Number(current.tavernHelperLifecycleRevision || 0) > Number(originalChat.tavernHelperLifecycleRevision || 0) + 1) return
      const events = sessionEvents(session)
      // A send rejected while the marker was set failed its own turn; only real
      // story after the attempt is kept: the save stays as it is, never overwritten.
      if (storyPlayerInputs(events, eventStart).length) {
        nativeError = new Error('重新生成后已有新的玩家输入，保留当前存档')
        endMarker(current)
        current.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
        staleNative(current, nativeError)
        return current
      }
      let abortedTurns = []
      try {
        abortedTurns = regenerationAttemptTurns({ events, eventStart })
        clearRegenerationAttemptSurface({ session, eventStart })
        if (typeof sessions.flush === 'function') await sessions.flush(session)
      } catch (error) { nativeError = error }
      const next = timeline.apply({ chat: current, intent: { kind: 'replacement.abort', restoreChat: originalChat } }).chat
      delete next.regenInProgress
      delete next.regenRecovery
      next.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
      next.suppressedDshTurns = [...new Set([...(next.suppressedDshTurns || []), ...abortedTurns])].sort((a, b) => a - b)
      if (nativeError) staleNative(next, nativeError)
      return next
    }, { source: 'foreground.regen-abort' })
    if (nativeError) await repairAfter(chatId, session, nativeError)
    return saved
  }

  // Chat is already authoritative here. Never roll it back if projecting or
  // flushing the native replacement fails; the native tail is repaired from it.
  async function complete({ chatId, session, operationId }) {
    let nativeError = null
    const saved = await chats.update(chatId, async current => {
      const saved = current?.regenRecovery
      if (!saved || saved.phase !== 'committed' || (operationId && saved.id !== operationId)) return
      try {
        if (saved.sessionId !== session.id) throw new Error('重新生成恢复会话不匹配')
        if (!saved.projection || saved.projection.unplaced) throw new Error(saved.projection?.unplaced || '重新生成缺少已提交正文的投影记录')
        const projected = applyRegenerationProjection(session, saved.projection)
        if (projected?.nativeAnchor) {
          const storyTurn = Number(saved.projection.storyTurn)
          const row = current.messages?.find(message => message?.role === 'assistant' && Number(message.turn) === storyTurn)
          if (row) row.nativeAnchor = projected.nativeAnchor
          if (projected.nativeAnchor.turn !== storyTurn) {
            current.regeneratedDshTurns = { ...current.regeneratedDshTurns, [String(storyTurn)]: projected.nativeAnchor.turn }
            const frames = Object.values(current.foregroundFrames || {})
            const frame = frames.reverse().find(frame => frame.branchId === current.timeline?.branchId && Number(frame.turn) === storyTurn)
            if (frame) frame.turn = projected.nativeAnchor.turn
          }
        }
        if (typeof sessions.flush === 'function') await sessions.flush(session)
      } catch (error) { nativeError = error }
      endMarker(current)
      if (nativeError) staleNative(current, nativeError)
      return current
    }, { source: 'foreground.regen-projected' })
    if (nativeError) await repairAfter(chatId, session, nativeError)
    return saved
  }

  async function recover(chatId) {
    if (isActive(chatId) || recovering.has(chatId)) return
    recovering.add(chatId)
    let handle
    try {
      if (chats.readState && !(await chats.readState(chatId))?.regenInProgress) return
      const chat = await chats.read(chatId)
      if (!chat || chat.regenInProgress !== true) return
      // Independent providers have not changed story or model surface while
      // generating. A crash only abandons their lock, never rewinds the live
      // story or settings to an older revision.
      if (chat.regenRecovery?.detached === true && chat.regenRecovery.phase === 'prepared') {
        return await chats.update(chatId, current => {
          if (current?.regenRecovery?.id !== chat.regenRecovery.id || current.regenRecovery.phase !== 'prepared') return current
          if (current.regenRecovery.candidate) current.bodyGenerationCandidate = current.regenRecovery.candidate
          endMarker(current)
          current.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
          return current
        }, { source: 'foreground.plugin-regen-recover' })
      }
      const sessionId = chat.regenRecovery?.sessionId || chat.sessionId
      let agent = sessions.get(sessionId)
      if (agent?.phase?.kind === 'running') return
      let session = agent?.session || sessions.getSession?.(sessionId)
      if (!session && typeof sessions.resume === 'function') {
        handle = await sessions.resume(sessionId)
        agent = handle.agent
        session = agent?.session
      }
      if (agent?.phase?.kind === 'running') return
      const operationId = chat.regenRecovery?.id
      if (chat.regenRecovery?.phase === 'committed') {
        if (!session) return await release({ chatId, operationId, session, reason: '无法加载重新生成的原生会话' })
        return await complete({ chatId, session, operationId })
      }
      let before
      try { before = await originalState(chat) }
      catch (error) { return await release({ chatId, operationId, session, reason: error }) }
      if (!session) return await release({ chatId, operationId, before, reason: '无法加载重新生成的原生会话' })
      let eventStart
      try { eventStart = chat.regenRecovery?.eventStart ?? legacyEventStart(before, session) }
      catch (error) { return await release({ chatId, operationId, before, session, reason: error }) }
      if (!Number.isSafeInteger(eventStart) || eventStart < 0 || eventStart > sessionEvents(session).length) {
        return await release({ chatId, operationId, before, session, reason: '重新生成的原生历史边界不匹配' })
      }
      const aborted = await abort({ chatId, originalChat: before, session, eventStart, operationId })
      if (aborted !== undefined || (await chats.read(chatId))?.regenInProgress !== true) return aborted
      // Abort declined (the story moved on since the attempt): keep the save as it is.
      return await release({ chatId, operationId, session, reason: '重新生成后存档已有其他变化' })
    } finally {
      try { if (handle) await handle.dispose() }
      finally { recovering.delete(chatId) }
    }
  }

  return Object.freeze({ recover, abort, complete })
}
