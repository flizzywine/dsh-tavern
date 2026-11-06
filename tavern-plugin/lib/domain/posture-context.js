/** Saved posture remains available for history, but disabled settlement must not
 * present its stale output as current state in newly built requests. */
export function postureForContext(chat, snapshot = chat) {
  if (chat?.backgroundTasks?.posture === false || snapshot?.backgroundTasks?.posture === false) return ''
  return typeof snapshot?.posture === 'string' ? snapshot.posture : ''
}
