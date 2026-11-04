import { createHash } from 'node:crypto'
import { sessionEvents } from './session-events.js'
import { createSessionSurfaceMutator } from './session-surface-mutations.js'

export const GAME_FOREGROUND_PREFIX = 'tavern-game-mode:'
export function gameModeForegroundId(key, text) {
  return GAME_FOREGROUND_PREFIX + createHash('sha256').update(key).digest('hex').slice(0, 16) + ':'
    + createHash('sha256').update(text).digest('hex').slice(0, 24)
}

// The mode document owns the game. This native foreground message is a
// rebuildable public transcript, including after rewind or a failed flush.
export function projectGameModeForeground(session, { key, text }) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('玩法前台正文不能为空')
  const owner = GAME_FOREGROUND_PREFIX + createHash('sha256').update(key).digest('hex').slice(0, 16) + ':'
  const nodes = new Set(session.surface.nodes)
  const current = sessionEvents(session).findLast(event => nodes.has(event.seq)
    && event.type === 'assistant/message' && event.data?.message?.id?.startsWith(owner))
  const content = [{ type: 'text', text }]
  if (current && JSON.stringify(current.data.message.content) === JSON.stringify(content)) return false
  const message = { id: gameModeForegroundId(key, text),
    role: 'assistant', content, source: { kind: 'model', provider: 'dsh-tavern', model: 'game-dm-projection' } }
  const mutator = createSessionSurfaceMutator(session)
  mutator.editStep((turn, step) => {
    const data = { turn, step, message }
    // Native chat renders append rows, while replacements only update model
    // context. Retire the previous row and append the current public transcript.
    if (current) mutator.replace('assistant/message', { ...data, message: { ...message, id: message.id + ':retire:' + current.seq, content: [] } },
      { start: current.seq, end: current.seq, sourceEventSeqs: [current.seq] })
    mutator.append('assistant/message', data, { surfaceOp: 'append' })
  })
  return true
}

export async function restoreGameModeForeground({ sessions, agents }, gameId, projection) {
  let handle
  let session = sessions.get(gameId) || agents.get(gameId)?.session
  if (!session) { handle = await agents.resume({ resumeSessionId: gameId }); session = handle.agent.session }
  try {
    projectGameModeForeground(session, projection)
    await sessions.flush(session)
  } finally { if (handle) await handle.dispose() }
}
