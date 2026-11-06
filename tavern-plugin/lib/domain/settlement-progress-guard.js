/** Bound stale-commit retries without treating a new story/task as a failure. */
export function createSettlementProgressGuard({ backgroundTasks, onStopped = () => {} }) {
  let previous = '', repeats = 0
  return async function retry(chat, error) {
    const activity = backgroundTasks.activity(chat)
    if (activity.role !== 'settlement' || !['pending', 'running'].includes(activity.phase)) return false
    const expectedState = {
      branchId: chat.timeline?.branchId,
      revision: chat.timeline?.revision,
      lifecycleRevision: Number(chat.tavernHelperLifecycleRevision || 0),
      phase: activity.phase
    }
    const key = JSON.stringify([activity.operationId, expectedState])
    repeats = key === previous ? repeats + 1 : 1
    previous = key
    if (repeats < 3) return true
    // Use the coordinator's serialized, revalidated interruption path. Never
    // write a stale full-chat snapshot or discard a prepared variable effect.
    const result = await backgroundTasks.recover(chat, { operationId: activity.operationId, expectedState })
    if (result.status === 'stale') { previous = ''; repeats = 0; return true }
    onStopped({ chatId: chat.id, operationId: activity.operationId, error })
    return false
  }
}
