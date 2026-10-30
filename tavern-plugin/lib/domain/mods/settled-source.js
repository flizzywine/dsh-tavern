// StoryTimeline inserts assistant replies atomically with body completion. Its bounded
// operation/checkpoint retention is not a second disclosure ledger for older replies.
export function settledModTurns(head) {
  const turns=new Set((head.messages || []).filter(row=>row.role==='assistant').map(row=>Number(row.turn || (row.greeting?1:0))).filter(turn=>turn>0))
  for(const row of Object.values(head.timeline?.operations || {})) {
    if(row.kind==='body' && row.status==='running' && row.basedOn?.branchId===head.timeline.branchId)turns.delete(Number(row.turn))
  }
  return turns
}

export function latestSettledModTurn(head) {
  return Math.max(0,...settledModTurns(head))
}
