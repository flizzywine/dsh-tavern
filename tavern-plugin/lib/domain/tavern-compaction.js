import { randomUUID } from 'node:crypto'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

function compactResult(value, fallbackStatus) {
  const source = value !== null && typeof value === 'object' ? value : {}
  const status = ['succeeded', 'failed', 'skipped'].includes(source.status) ? source.status : fallbackStatus
  return { status, message: str(source.message).replace(/\s+/g, ' ').trim().slice(0, 500) }
}

/** Coordinate one Tavern-level foreground/background compaction request. */
export function createTavernCompactionCoordinator(options = {}) {
  const store = options.store
  const activity = typeof options.activity === 'function' ? options.activity : function () { return { busy: false } }
  const makeId = typeof options.id === 'function' ? options.id : function () { return 'compaction-' + randomUUID() }
  const now = typeof options.now === 'function' ? options.now : Date.now
  const timeoutMs = Math.max(60_000, Number(options.timeoutMs) || 15 * 60_000)
  const plans = new Map()
  if (!store || typeof store.chatForSession !== 'function' || typeof store.updateChat !== 'function') {
    throw new Error('Tavern Compaction Coordinator 缺少存储 adapter')
  }

  function active(chatId) {
    const plan = plans.get(str(chatId))
    if (plan === undefined) return null
    if (plan.expiresAt > now()) return plan
    plans.delete(str(chatId))
    return null
  }

  function blocked(chat) {
    return chat !== null && typeof chat === 'object' && active(chat.id) !== null
  }

  async function prepare(sessionId) {
    const foregroundSessionId = str(sessionId)
    const chat = await store.chatForSession(foregroundSessionId)
    if (chat === undefined) throw new Error('当前会话没有绑定 Tavern 对话')
    const running = activity(chat) || {}
    if (running.busy === true || running.phase === 'running') {
      const error = new Error('后台 Agent 正在执行 ' + (str(running.role) || '任务') + '，请等待完成后再压缩')
      error.code = 'BACKGROUND_BUSY'
      error.activity = running
      throw error
    }
    if (active(chat.id) !== null) {
      const error = new Error('这条 Tavern 对话正在压缩，请等待完成')
      error.code = 'COMPACTION_BUSY'
      throw error
    }
    const participant = chat.timeline && chat.timeline.participants && chat.timeline.participants.background
    const backgroundSessionId = str(participant && participant.sessionId)
    const operationId = makeId()
    const plan = {
      operationId,
      chatId: str(chat.id),
      foregroundSessionId,
      backgroundSessionId,
      expiresAt: now() + timeoutMs
    }
    plans.set(str(chat.id), plan)
    try {
      if (backgroundSessionId !== '') {
        await store.updateChat(chat.id, function (draft) {
          const current = draft.timeline && draft.timeline.participants && draft.timeline.participants.background
          if (current && str(current.sessionId) === backgroundSessionId) {
            // Mark before dispatch: the command may succeed even if its browser
            // response is lost, so future rewind must conservatively rehydrate.
            current.requiresNewSessionOnRewind = true
            current.compactionPlannedAt = now()
          }
          return draft
        })
      }
    } catch (error) {
      plans.delete(plan.chatId)
      throw error
    }
    return { operationId, foregroundSessionId, backgroundSessionId }
  }

  async function complete(sessionId, input = {}) {
    const chat = await store.chatForSession(str(sessionId))
    if (chat === undefined) throw new Error('当前会话没有绑定 Tavern 对话')
    const plan = active(chat.id)
    if (plan === null || plan.operationId !== str(input.operationId) || plan.foregroundSessionId !== str(sessionId)) {
      const error = new Error('压缩计划已失效，请重新执行')
      error.code = 'COMPACTION_PLAN_STALE'
      throw error
    }
    const foreground = compactResult(input.foreground, 'failed')
    const background = plan.backgroundSessionId === ''
      ? compactResult(input.background, 'skipped')
      : compactResult(input.background, 'failed')
    const foregroundSucceeded = foreground.status === 'succeeded'
    const backgroundSucceeded = plan.backgroundSessionId === '' || background.status === 'succeeded'
    const anySucceeded = foregroundSucceeded || (plan.backgroundSessionId !== '' && background.status === 'succeeded')
    const status = foregroundSucceeded && backgroundSucceeded ? 'completed' : (anySucceeded ? 'partial' : 'failed')
    try {
      await store.updateChat(chat.id, function (draft) {
        if (plan.backgroundSessionId !== '' && background.status === 'succeeded') {
          const participant = draft.timeline && draft.timeline.participants && draft.timeline.participants.background
          if (participant && str(participant.sessionId) === plan.backgroundSessionId) {
            participant.requiresNewSessionOnRewind = true
            participant.compactedAt = now()
          }
        }
        draft.lastCompaction = {
          operationId: plan.operationId,
          status,
          completedAt: now(),
          foreground,
          background
        }
        return draft
      })
    } finally {
      plans.delete(plan.chatId)
    }
    return { operationId: plan.operationId, status, foreground, background }
  }

  return Object.freeze({ prepare, complete, blocked })
}
