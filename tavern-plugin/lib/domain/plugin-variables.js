// Writes to a plugin turn stay bound to its text version and the owning task.
// The activity and row must come from the same storage revision; the final CAS
// rejects a task stop or a new foreground turn that changes it before commit.
export function createPluginVariableWriter({ readState, readSlice, activity, generating, currentKey, patch }) {
  const stale = () => Object.assign(new Error('这一轮或插件任务已经变化，请重新读取后再试'), { code: 'TAVERN_PLUGIN_STALE_VERSION' })
  function writable(state, taskOperation) {
    const operationId = taskOperation?.()
    const background = state ? activity(state) : null
    const ownsTask = operationId && background?.busy === true && background.role === 'plugin-task' && background.operationId === operationId
    if (operationId && !ownsTask) throw stale()
    if (!state || state.regenInProgress || generating(state.sessionId) || (background?.busy && !ownsTask)) {
      throw Object.assign(new Error('正文生成或后台处理进行中，请稍后再改变量'), { code: 'TAVERN_PLUGIN_BUSY' })
    }
  }
  return async function writeVariables(material, variables, { taskOperation } = {}) {
    const sessionId = material.sessionId
    for (let attempt = 0; attempt < 3; attempt++) {
      const state = await readState(sessionId)
      writable(state, taskOperation)
      if (state.messages.findLastIndex(row => row?.role === 'assistant') !== material.index) throw stale()
      const selected = await readSlice(sessionId, [material.index], ['_storageRevision'])
      if (!selected) throw stale()
      if (state._storageRevision !== selected.chat._storageRevision) continue
      const row = selected.chat.messages?.[0]
      if (!row || row.role !== 'assistant' || Number(row.turn || (row.greeting ? 1 : 0)) !== material.turn
        || await currentKey(sessionId, material.turn) !== material.key) throw stale()
      const next = Array.isArray(row.variables) ? row.variables.slice() : []
      next[Math.max(0, Number(row.swipeId) || 0)] = variables
      writable(state, taskOperation)
      const saved = await patch(selected.chat.id, selected.chat._storageRevision,
        [{ op: 'set', path: ['messages', material.index, 'variables'], value: JSON.parse(JSON.stringify(next)) }], { source: 'plugin.variables' })
      if (saved) return
    }
    throw stale()
  }
}
