/** Own a session's complete template work, including persistence before receipt.
 * The plugin protects upstream global state; connection protects save ordering;
 * dispatch protects remote leases. This queue owns orchestration between them.
 */
export function createTemplateSessionTasks({ connection, plugin, dispatch }) {
  let tail = Promise.resolve(), closing = false, disposal, pendingReceipt
  function enqueue(action) {
    if (closing) return Promise.reject(new Error('Template session disposed'))
    const next = tail.then(action)
    tail = next.catch(() => {})
    return next
  }
  async function refreshed() {
    const snapshot = await connection.refresh()
    await plugin.refresh(snapshot)
    return snapshot
  }
  async function settled(action) {
    try { return await action() }
    finally { await connection.flush() }
  }
  async function project(operation, input) {
    if (operation === 'renderMany') {
      const results = []
      let scopes = input.context?.scopes
      for (const item of input.items) {
        // Batch transport, not evaluation: each entry keeps its refresh,
        // prepare event and persistence boundary. Failed renders do not pass
        // speculative scopes to the next entry. Save/transport errors abort
        // the batch; already executed entries must never be replayed.
        const result = await project('render', {
          template: item.template,
          context: { ...input.context, scopes, randomRef: item.randomRef }
        })
        if (result.ok) scopes = structuredClone(result.scopes)
        // Scopes feed the next browser evaluation, not the host's completed
        // projection. Do not retain/upload one full variable tree per entry.
        const { scopes: _scopes, ...receipt } = result
        results.push(receipt)
      }
      return results
    }
    const snapshot = await refreshed()
    if (operation === 'request' && input?.request?.model) snapshot.dsh.model = input.request.model
    return settled(() => plugin.project(operation, input))
  }
  return {
    context: connection.snapshot,
    project: (operation, input) => enqueue(() => project(operation, input)),
    synchronize: () => enqueue(async () => {
      const snapshot = await refreshed()
      const result=await settled(() => plugin.synchronize(snapshot,connection.displayChanges?.()))
      if (!result?.deferred) connection.acknowledgeDisplay?.()
      return result
    }),
    refresh: () => enqueue(refreshed),
    flush: () => enqueue(() => connection.flush()),
    command: (...args) => enqueue(() => settled(() => plugin.command(...args))),
    emit: (...args) => enqueue(() => settled(() => plugin.emit(...args))),
    processChatCompletion: input => enqueue(() => settled(() => plugin.processChatCompletion(input))),
    // Start only after local work drains. A receipt transport failure must not
    // be reclassified as execution failure, nor cause the template to run twice.
    processNext: () => enqueue(async () => {
      if (pendingReceipt) {
        await dispatch.complete(pendingReceipt.work, pendingReceipt.receipt)
        pendingReceipt = null
        return true
      }
      const work = await dispatch.claim()
      if (!work.event) return false
      const started = await dispatch.start(work)
      if (!started.started) return true
      let receipt
      try {
        const result = await project(work.event.name, work.event.args[0])
        receipt = { args: [result] }
      } catch (error) {
        receipt = { error: String(error.stack || error) }
      }
      pendingReceipt = { work, receipt }
      await dispatch.complete(work, receipt)
      pendingReceipt = null
      return true
    }),
    dispose() {
      if (disposal) return disposal
      closing = true
      disposal = tail.then(async () => {
        try { await connection.flush() }
        finally { await plugin.dispose() }
      })
      return disposal
    }
  }
}
