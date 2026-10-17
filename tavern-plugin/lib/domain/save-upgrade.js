import { migrateInstalledSessions } from './session-upgrade.js'

// Host logs must be prepared before the host opens handles. The same upgrade
// service then completes each game's journal cutover under its storage lock.
export const prepareSaveUpgrade = migrateInstalledSessions

export function createSaveUpgrade({ store, inspectSessions, assertIdle = () => {}, notify = () => {} }) {
  const jobs = new Map(), pending = new Set()
  async function inspect(id) {
    const version = await store.version(id)
    if (!version) throw new Error('找不到当前存档')
    const chat = await store.readSessionState(id)
    if (!chat) throw new Error('找不到当前存档')
    const sessions = await inspectSessions(chat)
    return { chat, sessions, storage: version.startsWith('native:') ? 'current' : 'legacy' }
  }
  async function status(id) {
    const { sessions, storage } = await inspect(id)
    const job = jobs.get(id)
    const completed = sessions.ready && storage === 'current'
    return { target: 'dsh-0.2.1', sessions, storage, phase: completed ? 'completed' : (job?.phase !== 'completed' && job?.phase) || (sessions.ready ? 'idle' : 'failed'),
      stage: completed ? 'completed' : job?.stage || 'sessions',
      ...(!completed && (job?.error || sessions.error) ? { error: job?.error || sessions.error } : {}) }
  }
  function start(id) {
    if (jobs.get(id)?.phase === 'running') return { phase: 'running' }
    for (const [key, job] of jobs) if (jobs.size >= 128 && job.phase !== 'running') jobs.delete(key)
    const job = { phase: 'running', stage: 'sessions', startedAt: Date.now() }
    jobs.set(id, job)
    const task = (async () => {
      try {
        const { chat, sessions } = await inspect(id)
        await assertIdle(chat)
        if (!sessions.ready) throw new Error(sessions.error || '会话日志尚未升级，请重启酒馆后重试；原存档已保留')
        const result = await store.upgradeStorage(id, {
          assertCanMigrate: async current => {
            await assertIdle(current)
            const checked = await inspectSessions(current)
            if (!checked.ready) throw new Error(checked.error || '会话日志尚未升级')
          },
          onProgress: stage => { job.stage = stage },
        })
        if (result.status !== 'native') throw new Error('找不到可升级的存档')
        Object.assign(job, { phase: 'completed', stage: 'completed', elapsedMs: Date.now() - job.startedAt })
        notify(id)
      } catch (error) { Object.assign(job, { phase: 'failed', error: String(error.message || error) }) }
    })()
    pending.add(task)
    task.finally(() => pending.delete(task))
    return { phase: 'running' }
  }
  return { status, start, dispose: () => Promise.allSettled([...pending]) }
}

export function saveSessionIds(chat) {
  return [...new Set([chat.sessionId, chat.candidateAgent?.sessionId,
    ...Object.values(chat.timeline?.participants || {}).map(participant => participant.sessionId),
    chat.rollbackUndo?.foreground?.sessionId,
    ...(chat.rollbackUndo?.background || []).map(checkpoint => checkpoint.sessionId),
  ].filter(id => typeof id === 'string' && id))]
}
