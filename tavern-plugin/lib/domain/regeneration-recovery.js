import { sessionEvents } from './session-events.js'
import { inputKind, isNewTurnInput, storyPlayerInputs } from './session-turn-input.js'
import { clearRegenerationAttemptSurface, regenerationAttemptTurns, locateRegenerationSurface, applyRegenerationProjection } from './rollback-surface.js'
import { isDeepStrictEqual } from 'node:util'
import { createRegenerationDiscard, regenerationAttemptMessages, restoreDiscardedRegeneration, installRegenerationDiscard, retainRegenerationFailure, clearRegenerationFailure } from './regeneration-discard.js'
import { assertRegenerationSourceCurrent } from './last-round-replacement.js'

// Older hosts may still have finalized the detached native candidate as one
// temporary round. Remove it only when every original row and timeline entry is
// intact and the sole suffix is provably this request's candidate turn.
function discardCandidateResidue(chat, original) {
  if (!chat?.regenRecovery?.candidateFrame || !original) return false
  const turn = Number(chat.regenRecovery.candidateTurn)
  const before = regenerationAttemptMessages(Array.isArray(original.messages) ? original.messages : [], chat.regenRecovery.discarded)
  const messages = Array.isArray(chat.messages) ? chat.messages : []
  if (messages.length !== before.length + 2 || !isDeepStrictEqual(messages.slice(0, before.length), before) ||
      messages.at(-2)?.role !== 'user' || messages.at(-1)?.role !== 'assistant' || Number(messages.at(-1)?.turn) !== turn) return false
  const beforeOperations = original.timeline?.operations || {}
  const operations = chat.timeline?.operations || {}
  const originalIntact = Object.entries(beforeOperations).every(([id, operation]) => isDeepStrictEqual(operations[id], operation))
  const extras = Object.entries(operations).filter(([id]) => !Object.hasOwn(beforeOperations, id))
  const checkpoints = original.timeline?.checkpoints || []
  if ((original.timeline?.branchId && chat.timeline?.branchId !== original.timeline.branchId) || !originalIntact ||
      !isDeepStrictEqual((chat.timeline?.checkpoints || []).slice(0, checkpoints.length), checkpoints) || extras.length !== 1 ||
      extras[0][1]?.kind !== 'body' || extras[0][1]?.status !== 'completed' || Number(extras[0][1]?.turn) !== turn) return false
  chat.messages.splice(before.length, 2)
  chat.timeline = structuredClone(original.timeline)
  if (chat.nativeCommits && typeof chat.nativeCommits === 'object') delete chat.nativeCommits[String(turn)]
  if (Number(chat.foregroundError?.turn) === turn) chat.foregroundError = null
  return true
}

function recoveryWithDiscard(current, original) {
  if (current?.regenRecovery?.discarded) return current.regenRecovery
  const index = (current?.messages || []).findIndex(row => row?.regenerationDiscarded === true)
  if (index < 0 || original?.messages?.[index]?.role !== 'assistant') return current?.regenRecovery
  return {
    ...current?.regenRecovery,
    discarded: createRegenerationDiscard(original.messages[index], index, index - 1),
    temporaryReplacingTurn: Number(current?.regenRecovery?.temporaryReplacingTurn || original.messages[index].turn) || null
  }
}

// Background writes may change variables and revision without changing the
// story this attempt owns. Compare story identity and visible content.
function storyRows(messages) {
  return messages.map(row => [row?.role, row?.turn, row?.sourceText, row?.projectionText,
    row?.text, row?.swipeId, row?.tavernHidden, row?.is_hidden, row?.hidden, row?.messageUid, row?.regenerationDiscarded])
}

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
 * Recover an uncommitted replacement without resurrecting its discarded prose.
 * Whatever the native session does, recovery ends the marker and keeps the old
 * story row absent. A native step failure only marks the native tail stale.
 */
export function createRegenerationRecovery({ chats, sessions, isActive }) {
  const recovering = new Set()

  function attempt({ originalChat, session, sessionId, operationId, eventStart, replacingTurn, assistantIndex, inputIndex, provider = false }) {
    const chatId = originalChat.id
    const discarded = assistantIndex === null ? null
      : createRegenerationDiscard(originalChat.messages[assistantIndex], assistantIndex, inputIndex)
    const targetMessageUid = discarded?.assistant.messageUid || ''
    const source = provider ? 'foreground.plugin-regen-' : 'foreground.regen-'

    function stale(message) {
      const failure = new Error(message)
      if (provider) failure.code = 'TAVERN_PLUGIN_STALE_VERSION'
      return failure
    }

    function checkPrepared(current) {
      if (current?.regenRecovery?.id !== operationId || current?.regenRecovery?.phase !== 'prepared') {
        throw stale(provider ? '正文重新生成操作已经失效' : '重新生成操作已失效')
      }
    }

    function checkBranch(current) {
      const originalBranch = originalChat.timeline?.branchId
      // A legacy native save can acquire its first timeline during generation.
      if ((provider || originalBranch) && current.timeline?.branchId !== originalBranch) throw stale('重新生成期间剧情状态已经变化')
    }

    function checkStoryRows(current) {
      const expected = regenerationAttemptMessages(originalChat.messages, current.regenRecovery.discarded)
      if (!isDeepStrictEqual(storyRows(current.messages), storyRows(expected))) throw stale('重新生成期间历史消息已经变化')
    }

    function begin(validate, details = {}) {
      return chats.update(chatId, current => {
        validate(current)
        if (assistantIndex !== null) assertRegenerationSourceCurrent({
          originalChat, currentChat: restoreDiscardedRegeneration(current), assistantIndex, inputIndex
        })
        current.regenRecovery = { ...details, id: operationId, phase: 'prepared', detached: true,
          beforeRevision: Number(current._storageRevision || 0), sessionId, eventStart,
          targetMessageUid, temporaryReplacingTurn: replacingTurn, ...(discarded ? { discarded } : {}) }
        if (discarded) installRegenerationDiscard(current, discarded)
        else clearRegenerationFailure(current)
        current.regenInProgress = true
        current.tavernHelperLifecycleRevision = provider
          ? Number(current.tavernHelperLifecycleRevision || 0) + 1
          : Math.max(0, Number(originalChat.tavernHelperLifecycleRevision) || 0) + 1
        return current
      }, { source: source + 'begin', worldSelection: { preserveWorld: true } })
    }

    function updatePrepared(stage, change) {
      return chats.update(chatId, current => {
        checkPrepared(current)
        checkBranch(current)
        checkStoryRows(current)
        change(current.regenRecovery)
        return current
      }, { source: source + stage })
    }

    function commit({ projection, validate, apply }) {
      return chats.update(chatId, async current => {
        if (validate) await validate()
        checkPrepared(current)
        checkBranch(current)
        if (provider) checkStoryRows(current)
        apply(current)
        current.regenInProgress = true
        current.regenRecovery = { ...current.regenRecovery, phase: 'committed', projection }
        if (provider) delete current.bodyGenerationCandidate
        current.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
        return current
      }, { source: source + 'commit', ...(provider ? {} : { worldSelection: { preserveDetachedWorld: true } }) })
    }

    return Object.freeze({
      targetMessageUid, begin, checkPrepared, updatePrepared, commit,
      project: () => complete({ chatId, session, operationId }),
      abandon: () => provider ? abandonDetached(chatId, operationId)
        : abort({ chatId, originalChat, session, eventStart, operationId })
    })
  }

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
  function abandonDetached(chatId, operationId, interrupted = false) {
    return chats.update(chatId, current => {
      const marker = current?.regenRecovery
      if (marker?.id !== operationId || marker?.phase !== 'prepared') return current
      if (interrupted && marker.candidate) current.bodyGenerationCandidate = marker.candidate
      if (!interrupted) delete current.bodyGenerationCandidate
      endMarker(current)
      retainRegenerationFailure(current, marker)
      current.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
      return current
    }, { source: interrupted ? 'foreground.plugin-regen-recover' : 'foreground.plugin-regen-release',
      worldSelection: { preserveWorld: true } })
  }
  async function repairAfter(chatId, session, reason) {
    console.warn('dsh-tavern: 重新生成恢复时模型上下文对不上，旧正文保持撤下，模型上下文保持不修：' + String(reason?.message || reason || ''))
  }
  // Last resort: the recovery point or native boundary is gone. End the marker
  // without restoring prose or otherwise rewriting the current story.
  async function release({ chatId, operationId, before, session, reason }) {
    const saved = await chats.update(chatId, current => {
      if (!current || current.regenInProgress !== true || (operationId && current.regenRecovery?.id !== operationId)) return
      // Failure releases only this attempt. It never writes the pre-generation
      // story back: the old prose was discarded when regeneration began.
      const recovery = recoveryWithDiscard(current, before)
      const next = current
      endMarker(next)
      if (recovery?.phase === 'committed') clearRegenerationFailure(next)
      else retainRegenerationFailure(next, recovery)
      next.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
      staleNative(next, reason)
      return next
    }, { source: 'foreground.regen-release', worldSelection: { preserveWorld: true } })
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
    // 投影/修复写回的正文可能带着别的剧情轮号，按正文再认一次。
    const target = locateRegenerationSurface({ events, nodes: session.surface?.nodes || [], turn: assistant?.turn,
      texts: [assistant?.text, assistant?.sourceText, assistant?.projectionText] })
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
        const recovery = recoveryWithDiscard(current, originalChat)
        endMarker(current)
        retainRegenerationFailure(current, recovery)
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
      // Only the temporary candidate suffix is request residue. The discarded
      // source prose stays discarded on every failure and recovery path.
      if (current.regenRecovery?.candidateFrame) discardCandidateResidue(current, originalChat)
      const recovery = recoveryWithDiscard(current, originalChat)
      const next = current
      delete next.regenInProgress
      delete next.regenRecovery
      retainRegenerationFailure(next, recovery)
      next.tavernHelperLifecycleRevision = Number(current.tavernHelperLifecycleRevision || 0) + 1
      next.suppressedDshTurns = [...new Set([...(next.suppressedDshTurns || []), ...abortedTurns])].sort((a, b) => a - b)
      if (nativeError) staleNative(next, nativeError)
      return next
    }, { source: 'foreground.regen-abort', worldSelection: { preserveWorld: true } })
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
      clearRegenerationFailure(current)
      if (nativeError) staleNative(current, nativeError)
      return current
    }, { source: 'foreground.regen-projected' })
    if (nativeError) await repairAfter(chatId, session, nativeError)
    return saved
  }

  async function recover(chatId, initialChat = null) {
    if (isActive(chatId) || recovering.has(chatId)) return
    recovering.add(chatId)
    let handle
    try {
      // Regeneration already loaded the complete story to select its target. Other
      // callers keep the cheap state-only guard instead of reconstructing Chat.
      if (!initialChat && chats.readState && !(await chats.readState(chatId))?.regenInProgress) return
      const chat = initialChat || await chats.read(chatId)
      if (!chat || chat.regenInProgress !== true) return
      // Independent providers have not changed the native model surface. Their
      // story placeholder stays discarded; a crash only abandons the lock and
      // never rewinds story or settings to an older revision.
      if (chat.regenRecovery?.detached === true && chat.regenRecovery.phase === 'prepared' && !chat.regenRecovery?.candidateFrame) {
        return await abandonDetached(chatId, chat.regenRecovery.id, true)
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
      const candidateFirst = chat.regenRecovery?.candidateFrame?.kind === 'foreground'
      let before = chat
      if (!candidateFirst) {
        try { before = await originalState(chat) }
        catch (error) { return await release({ chatId, operationId, session, reason: error }) }
      }
      if (!session) return await release({ chatId, operationId, before: candidateFirst ? null : before, reason: '无法加载重新生成的原生会话' })
      let eventStart
      try { eventStart = chat.regenRecovery?.eventStart ?? legacyEventStart(before, session) }
      catch (error) { return await release({ chatId, operationId, before: candidateFirst ? null : before, session, reason: error }) }
      if (!Number.isSafeInteger(eventStart) || eventStart < 0 || eventStart > sessionEvents(session).length) {
        return await release({ chatId, operationId, before: candidateFirst ? null : before, session, reason: '重新生成的原生历史边界不匹配' })
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

  return Object.freeze({ attempt, recover, abort, complete })
}
