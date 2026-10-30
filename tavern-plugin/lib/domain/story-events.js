// The moments in a story that start or stop background work. Where the story reaches
// one, it only announces it; what follows is registered here by name, so one table
// (table(), shown on the 后台任务 page) lists every task each moment starts.
// Besides these, a plugin may announce its own moments (`<plugin>:<name>`, CUSTOM_EVENT).
export const STORY_EVENTS = Object.freeze({
  // { sessionId, turn }: the player sent a message and its turn begins.
  'turn-started': '玩家发送',
  // { sessionId, turn }: the reply of that turn started streaming.
  'reply-started': '正文开始',
  // { sessionId }: a reply or a regenerated reply was saved.
  'reply-committed': '正文写完',
  // { chatId, latest, turn }: a turn's background settlement finished; `latest` is the
  // save's header after it, or null when it could not be read; `turn`, the turn settled.
  'turn-settled': '本轮结算完',
  // { sessionId, turn }: a reply failed or was stopped, and its turn is thrown away.
  'turn-discarded': '回合作废',
  // { sessionId, turn, withdrawn }: the player stopped the turn (舞台的「停止」); `withdrawn`: its reply never committed.
  'turn-interrupted': '回合打断',
  // { sessionId, kind }: the story was rolled back, a reply regenerated or edited, or a
  // rollback undone (kind: rollback / regenerate / edit / undo-rollback).
  'story-rewound': '剧情回退或改写',
  // { sessionId, task, plugin, member, status, turn }: a background run ended
  // (status: completed / failed / cancelled).
  'task-finished': '任务完成'
})

// A plugin's own moment: its name, a colon, the moment's name.
export const CUSTOM_EVENT = /^[a-z0-9][a-z0-9._-]{0,63}:[a-z0-9][a-z0-9._-]{0,63}$/

const KEPT_PER_GAME = 30

export function createStoryEvents({ logger = console, now = Date.now } = {}) {
  const followers = new Map(Object.keys(STORY_EVENTS).map(event => [event, []]))
  // When each moment happened, per game, for the background task timeline.
  const moments = new Map()
  const nameOf = event => STORY_EVENTS[event] || event

  // A built-in moment, or a plugin's own one, known from its first follower or announcement.
  function listFor(event) {
    if (!followers.has(event) && CUSTOM_EVENT.test(String(event))) followers.set(event, [])
    const list = followers.get(event)
    if (!list) throw new Error('未知的剧情事件：' + event)
    return list
  }

  function on(event, label, listener) {
    const list = listFor(event)
    const follower = { label: String(label), listener }
    list.push(follower)
    return () => { const index = list.indexOf(follower); if (index >= 0) list.splice(index, 1) }
  }

  // Fire and forget: one failing follower never keeps the others from running.
  function emit(event, payload) {
    const list = listFor(event)
    const gameId = String(payload?.sessionId || payload?.latest?.sessionId || '')
    // The timeline marks story moments; a finished task is already its own block there.
    if (gameId && event !== 'task-finished') {
      const kept = moments.get(gameId) || []
      kept.push({ event, name: nameOf(event), at: now(), ...(Number.isSafeInteger(payload?.turn) ? { turn: payload.turn } : {}) })
      moments.set(gameId, kept.slice(-KEPT_PER_GAME))
    }
    for (const { label, listener } of [...list]) {
      const warn = error => logger.warn('dsh-tavern: ' + nameOf(event) + '后「' + label + '」失败:', error?.message || error)
      try {
        const pending = listener(payload)
        if (pending && typeof pending.catch === 'function') pending.catch(warn)
      } catch (error) { warn(error) }
    }
  }

  function table() {
    return [...followers].map(([event, list]) => ({ event, name: nameOf(event), custom: !Object.hasOwn(STORY_EVENTS, event), followers: list.map(item => item.label) }))
  }

  // Oldest first.
  function history(gameId) {
    return (moments.get(String(gameId || '')) || []).map(item => ({ ...item }))
  }

  return Object.freeze({ on, emit, table, history })
}
