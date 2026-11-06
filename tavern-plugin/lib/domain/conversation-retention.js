// Revisions a Chat's features can still read back: rollback checkpoints (and
// the checkpoints of those states, which forks and save export follow), undo,
// regeneration recovery, and revisions other Chats were forked from.
// `keepTurns` bounds the history kept for forking from an earlier turn: only
// checkpoints of the latest turns are followed. Undo, recovery and existing
// forks are always kept.
export async function retainedRevisions(chat, readRevision, forkRevisions = [], { keepTurns = Infinity } = {}) {
  const retained = new Set()
  const pending = [chat]
  const latestTurn = Math.max(0, ...(chat?.timeline?.checkpoints || []).map(item => Number(item?.turn) || 0))
  const oldestTurn = Number.isFinite(keepTurns) ? latestTurn - keepTurns : -Infinity
  const visit = revision => {
    if (!Number.isSafeInteger(revision) || revision < 0 || retained.has(revision)) return false
    retained.add(revision)
    return true
  }
  async function follow(revision) {
    if (!visit(revision)) return
    let state
    try { state = await readRevision(chat.id, revision) } catch (error) {
      if (error?.code === 'DSH_TAVERN_REVISION_NOT_FOUND') return
      throw error
    }
    if (state && state._storageRevision === revision) pending.push(state)
  }
  for (const revision of forkRevisions) await follow(Number(revision))
  while (pending.length) {
    const state = pending.pop()
    for (const checkpoint of state?.timeline?.checkpoints || []) {
      // A checkpoint without a readable turn is kept: never drop what cannot be placed.
      const turn = Number(checkpoint?.turn)
      if (!Number.isFinite(turn) || turn > oldestTurn) await follow(Number(checkpoint?.beforeRevision))
    }
    await follow(Number(state?.rollbackUndo?.beforeRevision))
    await follow(Number(state?.regenRecovery?.beforeRevision))
  }
  return retained
}
