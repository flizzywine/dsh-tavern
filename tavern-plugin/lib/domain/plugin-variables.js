import { createHash } from 'node:crypto'

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
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  const currentVariables = row => row.variables?.[Math.max(0, Number(row.swipeId) || 0)] ?? null
  const conflict = () => Object.assign(new Error('变量快照已变化，请重新读取'), { code: 'TAVERN_PLUGIN_VARIABLE_CONFLICT' })
  async function inspect(material, taskOperation) {
    const state = await readState(material.sessionId)
    writable(state, taskOperation)
    if (state.messages.findLastIndex(row => row?.role === 'assistant') !== material.index) throw stale()
    const selected = await readSlice(material.sessionId, [material.index], ['_storageRevision'])
    if (!selected || state._storageRevision !== selected.chat._storageRevision) return null
    const row = selected.chat.messages?.[0]
    if (!row || row.role !== 'assistant' || Number(row.turn || (row.greeting ? 1 : 0)) !== material.turn ||
        await currentKey(material.sessionId, material.turn) !== material.key) throw stale()
    return { state, selected, row }
  }
  async function writeVariables(material, variables, { taskOperation } = {}) {
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
  writeVariables.snapshot = async (material, { taskOperation } = {}) => {
    for (let i = 0; i < 3; i++) {
      const item = await inspect(material, taskOperation)
      if (item) {
        const variables = currentVariables(item.row)
        return { variables: structuredClone(variables), variablesRevision: digest(variables) }
      }
    }
    throw stale()
  }
  writeVariables.commit = async (material, variables, { taskOperation, owner, operationId, variablesRevision } = {}) => {
    const requestHash = digest({ variablesRevision, variables })
    for (let i = 0; i < 3; i++) {
      const item = await inspect(material, taskOperation)
      if (!item) continue
      const { state, selected, row } = item
      const stored = row.tavernVariableCommits
      if (stored?.textVersion === material.key && (!Array.isArray(stored.receipts) || stored.receipts.length > 128 || stored.receipts.some(receipt =>
        !receipt || typeof receipt.owner !== 'string' || typeof receipt.operationId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(receipt.requestHash) || !/^[a-f0-9]{64}$/.test(receipt.resultRevision)))) {
        throw Object.assign(new Error('变量提交记录损坏'), { code: 'TAVERN_PLUGIN_RECEIPTS_INVALID' })
      }
      const receipts = stored?.textVersion === material.key ? stored.receipts : []
      const previous = receipts.find(receipt => receipt.owner === owner && receipt.operationId === operationId)
      if (previous) {
        if (previous.requestHash !== requestHash) throw Object.assign(new Error('operationId 已用于不同请求'), { code: 'TAVERN_PLUGIN_OPERATION_CONFLICT' })
        return { variablesRevision: previous.resultRevision, replayed: true }
      }
      if (digest(currentVariables(row)) !== variablesRevision) throw conflict()
      if (receipts.length >= 128) throw Object.assign(new Error('本正文版本的提交记录已满'), { code: 'TAVERN_PLUGIN_RECEIPTS_FULL' })
      const resultRevision = digest(variables)
      const next = Array.isArray(row.variables) ? row.variables.slice() : []
      next[Math.max(0, Number(row.swipeId) || 0)] = variables
      const ledger = { textVersion: material.key, receipts: [...receipts, { owner, operationId, requestHash, resultRevision }] }
      writable(state, taskOperation)
      const saved = await patch(selected.chat.id, selected.chat._storageRevision, [
        { op: 'set', path: ['messages', material.index, 'variables'], value: next },
        { op: 'set', path: ['messages', material.index, 'tavernVariableCommits'], value: ledger }
      ], { source: 'plugin.variables.commit' })
      if (saved) return { variablesRevision: resultRevision, replayed: false }
    }
    throw stale()
  }
  return writeVariables
}
