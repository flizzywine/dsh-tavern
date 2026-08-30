function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
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

  async function prepare(input) {
    if (typeof turns.prepare !== 'function') throw new Error('Foreground Handoff 缺少 prepare adapter')
    const chat = await store.chatForSession(input.sessionId)
    const activity = chat === undefined ? { phase: 'idle', busy: false, role: '' } : tasks.activity(chat)
    if (chat !== undefined && activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) {
      await queueBackground(chat.id)
    }
    return await turns.prepare(input)
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
        const chat = await store.chatForSession(input.sessionId)
        if (chat === undefined) return
        // 正文重生成会先产生一个临时 DSH 回合，再把它合并为原楼层的新 Swipe。
        // 临时回合不能启动变量结算，否则可能把尚未采用的正文写进正式状态。
        if (chat.regenInProgress === true) return
        const activity = tasks.activity(chat)
        if (activity.role === 'settlement' && (activity.phase === 'pending' || activity.phase === 'running')) {
          await queueBackground(chat.id)
        }
      }, '启动后台结算')
      return true
    }
    later(async function () {
      const target = { sessionId: input.sessionId, turn: input.turn }
      await turns.discard(target)
      if (cleanupFailedTurn !== null) await cleanupFailedTurn(target)
    }, '清理未完成前台回合')
    return true
  }

  async function recover(chatIds) {
    if (typeof store.readChat !== 'function' || typeof tasks.recover !== 'function') return
    for (const chatId of chatIds || []) {
      try {
        const chat = await store.readChat(chatId)
        if (chat === undefined) continue
        await tasks.recover(chat)
      } catch (error) {
        logger.error('dsh-tavern: 恢复后台周期失败 ' + str(chatId), error && error.message || error)
      }
    }
  }

  return Object.freeze({ prepare, finalize, end, recover })
}
