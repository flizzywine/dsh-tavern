function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

/** Own the seam from one foreground turn to its persistent background cycle. */
export function createForegroundHandoff(options = {}) {
  const turns = options.turns
  const store = options.store
  const tasks = options.tasks
  const queueBackground = options.queueBackground
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
    const activity = chat === undefined ? { busy: false, role: '' } : tasks.activity(chat)
    if (activity.busy) {
      const error = new Error('后台 Agent 正在执行 ' + activity.role + '，完成后才能发送正文')
      error.code = 'BACKGROUND_BUSY'
      error.activity = activity
      throw error
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
        if (chat !== undefined && tasks.activity(chat).busy) await queueBackground(chat.id)
      }, '前台回合移交后台周期')
      return true
    }
    later(async function () {
      await turns.discard({ sessionId: input.sessionId, turn: input.turn })
    }, '清理未完成前台回合')
    return true
  }

  async function recover(chatIds) {
    if (typeof store.readChat !== 'function' || typeof tasks.recover !== 'function') return
    for (const chatId of chatIds || []) {
      try {
        const chat = await store.readChat(chatId)
        if (chat === undefined) continue
        const recovered = await tasks.recover(chat)
        if (recovered.activity.busy) await queueBackground(recovered.chat.id)
      } catch (error) {
        logger.error('dsh-tavern: 恢复后台周期失败 ' + str(chatId), error && error.message || error)
      }
    }
  }

  return Object.freeze({ prepare, finalize, end, recover })
}
