function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function failureMessage(error) {
  return '这一轮没有生成正文：' + (str(error.message).trim() || '模型请求失败')
}

/** Pull a persistent background cycle only when the foreground needs its result. */
export function createForegroundHandoff(options = {}) {
  const turns = options.turns
  const store = options.store
  const tasks = options.tasks
  const queueBackground = options.queueBackground
  const cleanupFailedTurn = typeof options.cleanupFailedTurn === 'function' ? options.cleanupFailedTurn : null
  const defer = typeof options.defer === 'function' ? options.defer : setImmediate
  const logger = options.logger || console
  if (!turns || typeof turns.finalize !== 'function' || typeof turns.discard !== 'function' ||
      !store || typeof queueBackground !== 'function' || !tasks || typeof tasks.activity !== 'function') {
    throw new Error('Foreground Handoff 缺少回合、存储或后台任务 adapter')
  }

  async function finalize(input) {
    return await turns.finalize(input)
  }

  async function syncCandidateMessageId(sessionId, requestId, messageId) {
    if (typeof options.syncCandidateMessageId === 'function') {
      await options.syncCandidateMessageId(sessionId, requestId, messageId)
    }
  }

  // MVU's greeting/initvar path runs while floor 0 is still the latest floor, or on
  // the first input when the page loads its scripts after the player sent. An
  // immediate first send must wait before the system prompt, templates, context or
  // body.begin capture an empty baseline and advance beyond that initialization boundary.
  function openingPending(chat) {
    return Boolean(chat?.mvu?.enabled && chat.mvu.owner === 'official' && chat.mvu.openingInitialization?.status === 'pending')
  }
  async function awaitOpening(sessionId) {
    const opening = store.openingStateForSession ? await store.openingStateForSession(sessionId) : null
    const chat = opening ? opening.chat : await store.chatForSession(sessionId)
    if (openingPending(chat)) await options.scriptDispatch.waitUntilReady(sessionId)
  }

  async function prepare(input) {
    if (typeof turns.prepare !== 'function') throw new Error('Foreground Handoff 缺少 prepare adapter')
    // A save being reconciled (#196) finishes that first; both write the story.
    await options.waitReconcile?.(input.sessionId)
    await options.cancelPresentation?.(input.sessionId)
    // Task metadata and the opening check need the header and floor count only.
    const opening = store.openingStateForSession ? await store.openingStateForSession(input.sessionId) : null
    const chat = opening ? opening.chat : await store.chatForSession(input.sessionId)
    // A detached regeneration already owns a frozen request frame. Running the
    // ordinary next-turn hooks would cancel settlement, sync world state or clean
    // native tails against the live story before the candidate has been validated.
    if (chat?.regenInProgress === true) {
      const marked = await store.chatForSession(input.sessionId)
      if (marked?.regenRecovery?.candidateFrame?.kind === 'foreground') return await turns.prepare(input)
    }
    if (openingPending(chat)) await options.scriptDispatch.waitUntilReady(input.sessionId)
    // The tasks the next turn waits for (blocksNextTurn: settlement, plugin tasks) finish first.
    if (chat !== undefined) await options.beforeNextTurn?.(chat)
    // A failed turn is cleaned up after the failure, but that may not have happened (no live
    // session then, or it failed). Its input must not reach this request beside the new one.
    if (chat !== undefined) await options.clearFailedTurns?.(input.sessionId)
    // The stable prefix is rebuilt after this, so a world book edit received by
    // the previous turn must be adopted now rather than one turn later.
    if (chat !== undefined) await options.syncWorldBook?.(chat)
    try {
      return await turns.prepare(input)
    } catch (error) {
      if (error?.code === 'TAVERN_PREPARE_CONFLICT') {
        const { sessionId, turn, requestId } = input
        logger.warn('dsh-tavern: 正文准备冲突 ' + JSON.stringify({ sessionId, turn, code: error.code, ...error.conflict }))
        // DSH may report this hook error as UNKNOWN in turn/end.
        try {
          await turns.recordFailure({ sessionId, turn, requestId, code: error.code, message: failureMessage(error) })
        } catch (recordError) {
          logger.error('dsh-tavern: 记录正文准备冲突失败', recordError?.message || recordError)
        }
      }
      throw error
    }
  }

  function later(work, label) {
    defer(function () {
      Promise.resolve().then(work).catch(function (error) {
        logger.error('dsh-tavern: ' + label + '失败', error && error.message || error)
      })
    })
  }

  function end(input = {}) {
    const reason = str(input.reason)
    if (reason === 'completed' || reason === 'max-tokens') {
      later(async function () {
        const chat = await (store.stateForSession || store.chatForSession)(input.sessionId)
        if (chat === undefined) return
        // 正文重生成会先产生一个临时 DSH 回合，再把它合并为原楼层的新 Swipe。
        // 临时回合不能启动变量结算，否则可能把尚未采用的正文写进正式状态。
        if (chat.regenInProgress === true) return
        // Independent session: start from the host's committed body, never await settlement.
        // A Tavern edit's own turn writes no reply: it is 剧情回退或改写, announced by the edit.
        if (input.edit !== true) options.replyCommitted?.(input.sessionId)
        const activity = tasks.activity(chat)
        if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) {
          await queueBackground(chat.id)
        }
      }, '启动后台结算')
      return true
    }
    options.turnDiscarded?.(input.sessionId, input.turn)
    later(async function () {
      const target = { sessionId: input.sessionId, turn: input.turn }
      // A turn that failed (model API error, preparation error) wrote no reply: its
      // kept input says why, before the discard retires the reply placeholder.
      if (reason === 'error' && input.edit !== true) {
        const failure = input.error || {}
        await turns.recordFailure({ ...target, code: str(failure.code).trim() || 'turn-error',
          message: failureMessage(failure) })
      }
      await turns.discard(target)
      if (cleanupFailedTurn !== null) await cleanupFailedTurn(target)
    }, '清理未完成前台回合')
    return true
  }

  // startedBefore: when this process started; work begun since then is live, not left over.
  async function recover(chatIds, { startedBefore } = {}) {
    if (typeof store.readChat !== 'function' || typeof tasks.recover !== 'function') return
    for (const chatId of chatIds || []) {
      try {
        const chat = await (store.readState || store.readChat)(chatId)
        if (chat === undefined) continue
        await tasks.recover(chat, startedBefore ? { startedBefore } : {})
      } catch (error) {
        logger.error('dsh-tavern: 恢复后台周期失败 ' + str(chatId), error && error.message || error)
      }
    }
  }

  return Object.freeze({ awaitOpening, prepare, finalize, syncCandidateMessageId, end, recover })
}
