import { classifyResponse } from './response-refusal.js'
// Error visibility is presentation state, never a rollback or story suppression.
export function setFailedErrorVisibility(chat, events, turn, hidden) {
  if (!Number.isSafeInteger(turn) || turn < 1 || typeof hidden !== 'boolean') throw new Error('无效的错误提示参数')
  if (!events.some(event => event?.type === 'turn/end' && event.data?.turn === turn && event.data?.reason?.kind === 'error')) {
    throw new Error('找不到该轮的运行错误，请刷新后重试')
  }
  const turns = new Set((chat.hiddenDshErrorTurns || []).filter(value => Number.isSafeInteger(value) && value > 0))
  if (hidden) turns.add(turn)
  else turns.delete(turn)
  return { ...chat, hiddenDshErrorTurns: [...turns].sort((a, b) => a - b) }
}

// `scope` limits the batch to the turns a caller actually meant: the stacked
// notice removes the failures already cleared, and must keep the one still
// owning the tail (and its replay button) visible.
export function setAllFailedErrorVisibility(chat, events, hidden, scope) {
  if (typeof hidden !== 'boolean') throw new Error('无效的错误提示参数')
  const failed = new Set(events.filter(event => event?.type === 'turn/end' && event.data?.reason?.kind === 'error')
    .map(event => event.data.turn).filter(turn => Number.isSafeInteger(turn) && turn > 0))
  const turns = new Set((chat.hiddenDshErrorTurns || []).filter(turn => Number.isSafeInteger(turn) && turn > 0))
  const selected = Array.isArray(scope) ? new Set(scope.map(Number).filter(turn => failed.has(turn))) : failed
  let changedCount = 0
  for (const turn of selected) {
    if (hidden === turns.has(turn)) continue
    if (hidden) turns.add(turn)
    else turns.delete(turn)
    changedCount++
  }
  return { chat: changedCount ? { ...chat, hiddenDshErrorTurns: [...turns].sort((a, b) => a - b) } : chat, changedCount }
}

// A failure stops being actionable once the player cleared it or a later turn
// started; its error then folds by default. The trailing streak of provider
// moderation stops tells the player whether earlier story, not the new input,
// is what keeps tripping the filter.
export function failedErrorTurnStates(events, suppressedTurns) {
  const cleared = new Set((suppressedTurns || []).map(Number))
  const ends = (events || []).filter(event => event?.type === 'turn/end' && Number.isSafeInteger(event.data?.turn))
  const lastStart = (events || []).findLast(event => event?.type === 'turn/start' && Number.isSafeInteger(event.data?.turn))
  const stale = new Set()
  for (const event of ends) {
    if (event.data.reason?.kind !== 'error') continue
    const turn = event.data.turn
    if (cleared.has(turn) || (lastStart && Number(lastStart.seq) > Number(event.seq))) stale.add(turn)
  }
  let filteredStreak = 0
  for (let index = ends.length - 1; index >= 0; index--) {
    const reason = ends[index].data.reason
    if (reason?.kind === 'aborted') continue
    if (reason?.kind !== 'error' || classifyResponse({ error: String(reason.error?.message || '') }).method !== 'provider-signal') break
    filteredStreak++
  }
  return { staleTurns: [...stale].sort((a, b) => a - b), filteredStreak }
}
