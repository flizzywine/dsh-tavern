import { retainedRevisions } from './conversation-retention.js'
import { FORK_HISTORY_TURNS } from './conversation-fork-targets.js'

const STATE_PATH = 'save-maintenance.json'

/**
 * Keeps saves small without touching anything play or story export reads:
 * old revisions nothing can reach any more, pre-migration journal files once
 * no kept revision predates the migration, and debugging logs (model request
 * bodies, worldbook recall audits) outside their recent windows. History for
 * forking from an earlier turn is kept for the latest `keepTurns` turns.
 *
 * Every committed revision counts (`noteWrite`, from the store), not only turn
 * settlements: a game that grew by `everyRevisions` revisions since its last pass
 * is tidied once it has been quiet for `quietMs`, and while writes keep coming at the
 * latest `2 * quietMs` after the first one waiting. A pass reads and lists without the save's write
 * lock and joins it only in short steps, so it may run during play. `catchUpMs` after a
 * start (`catchUp`), every game already that far behind gets the same pass.
 * A game that is only paged never reaches that count, so a cold stage read that
 * touched `coldVisits` packs of it queues the same pass after the same quiet
 * period; the pass's relayout measures the layout and rewrites it only when it
 * is fragmented, and a head measured within the last `everyRevisions` is left alone.
 */
export function createSaveMaintenance({
  chats, listChatIds, requestLog, recallLog, isIdle, store,
  keepRecent = 8, keepTurns = FORK_HISTORY_TURNS, everyRevisions = 50, graceMs, logger = console,
  coldVisits = Infinity, quietMs = 600000, catchUpMs = 120000, now = Date.now,
  setTimer = (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer }, clearTimer = clearTimeout
}) {
  let state = null
  let disposed = false
  let tail = Promise.resolve()
  const stop = new AbortController()
  const quiet = new Map() // chatId -> {timer, revision, cold, since}: the pass waiting for the game to go quiet

  async function load() {
    if (state) return state
    const value = await store.readJson(STATE_PATH).catch(() => undefined)
    state = value?.version === 1 ? value : { version: 1, scanned: false, forks: {}, compacted: {} }
    state.laidOut ||= {} // chatId -> the revision whose layout a relayout last measured
    return state
  }
  async function save() { await store.writeJson(STATE_PATH, state) }
  // One maintenance pass at a time: they share the state file and the disk.
  function serial(task) {
    const next = tail.then(task, task)
    tail = next.catch(() => {})
    return next
  }

  function forkEntry(chat) {
    const from = chat?.forkedFrom
    if (!from) return null
    return { chatId: from.chatId || '', storageRevision: Number(from.storageRevision), stateChatId: from.stateChatId || '', stateRevision: Number(from.stateRevision) }
  }
  function forkRevisionsOf(chatId) {
    const revisions = []
    for (const from of Object.values(state.forks)) {
      if (from.chatId === chatId && Number.isSafeInteger(from.storageRevision)) revisions.push(from.storageRevision)
      if (from.stateChatId === chatId && Number.isSafeInteger(from.stateRevision)) revisions.push(from.stateRevision)
    }
    return revisions
  }
  async function scanForks() {
    // Saves created before this index existed: read each game's fork source once.
    for (const chatId of await listChatIds()) {
      if (disposed) return
      try {
        const head = await chats.readRetentionHeader(chatId) ?? await chats.read(chatId)
        const entry = forkEntry(head)
        if (entry) state.forks[chatId] = entry
      } catch (error) { logger.warn('dsh-tavern: 存档整理读取分叉来源失败', chatId, String(error?.message || error)) }
    }
    state.scanned = true
    await save()
  }

  // `behind`: how many revisions since its last pass make a game due (1 = any change).
  async function maintainChat(chatId, { layout = false, behind = 1 } = {}) {
    if (disposed) return { status: 'disposed' }
    await load()
    if (!(await isIdle(chatId))) return { status: 'busy' }
    const result = { status: 'done', requests: await requestLog.prune(chatId).catch(() => null), recalls: await recallLog.prune(chatId).catch(() => null) }
    const head = await chats.readRetentionHeader(chatId)
    if (!head) return { ...result, status: 'legacy-format' }
    if (head.regenInProgress) return { ...result, status: 'busy' }
    const revision = head._storageRevision
    const since = revision - (state.compacted[chatId] ?? 0)
    if (layout ? revision - (state.laidOut[chatId] ?? -Infinity) < everyRevisions : since < behind) return { ...result, status: 'unchanged' }
    const started = now()
    const retain = await retainedRevisions(head, (id, revision) => chats.readRetentionHeader(id, revision), forkRevisionsOf(chatId), { keepTurns })
    if (!(await isIdle(chatId))) return { ...result, status: 'busy' }
    // Incremental reads back to the last few rollback points stay fast.
    const recentCheckpoints = (head.timeline?.checkpoints || []).slice(-3).map(item => Number(item?.beforeRevision)).filter(Number.isSafeInteger)
    const changeFloor = recentCheckpoints.length ? Math.min(...recentCheckpoints) : undefined
    // Before the sweep, so this same pass frees the packs the relayout emptied.
    result.relayout = await chats.relayout(chatId)
    if (result.relayout) state.laidOut[chatId] = revision
    result.compaction = await chats.compact(chatId, { retain: revision => retain.has(revision), keepRecent, changeFloor, graceMs, signal: stop.signal })
    // Stopped by disposal: the files it removed stay removed, the next start does the rest.
    if (result.compaction?.stopped) return { ...result, status: 'disposed' }
    const legacyFrom = Number(head.legacyInitialRevision)
    const oldestKept = Math.min(head._storageRevision - keepRecent + 1, ...retain)
    if (Number.isSafeInteger(legacyFrom) && legacyFrom > 0 && oldestKept >= legacyFrom) {
      result.legacy = await chats.removeLegacyFiles(chatId)
    }
    state.compacted[chatId] = head._storageRevision
    await save()
    const compaction = result.compaction || {}
    // Every pass that did work is visible: an anomaly shows up as revisions and files, not only as freed bytes.
    if (compaction.removed || result.legacy?.bytes) logger.log('dsh-tavern: 存档整理', chatId, JSON.stringify({ revisions: since,
      removedFiles: compaction.removed || 0, indexKeys: compaction.indexKeysRemoved || 0, freedMB: Math.round(((compaction.bytes || 0) + (result.legacy?.bytes || 0)) / 1048576),
      seconds: Math.round((now() - started) / 1000), lockSteps: compaction.lockHolds || 0, maxLockMs: compaction.maxLockMs || 0 }))
    return result
  }

  async function sweep({ behind = 1 } = {}) {
    await load()
    if (!state.scanned) await scanForks()
    let freed = 0, chatsDone = 0
    for (const chatId of await listChatIds()) {
      if (disposed) break
      try {
        const result = await maintainChat(chatId, { behind })
        freed += (result.compaction?.bytes || 0) + (result.legacy?.bytes || 0)
        if (result.status === 'done') chatsDone++
      } catch (error) { logger.warn('dsh-tavern: 存档整理失败', chatId, String(error?.message || error)) }
    }
    return { freed, chats: chatsDone }
  }

  // Each write or cold read restarts the game's quiet period, up to `quietMs` past the first one waiting.
  function schedule(chatId, change) {
    const pending = { since: now(), ...quiet.get(chatId), ...change }
    clearTimer(pending.timer)
    pending.timer = setTimer(() => {
      quiet.delete(chatId)
      void serial(async () => {
        if (disposed) return
        await load()
        const due = Number.isSafeInteger(pending.revision) && pending.revision - (Number(state.compacted[chatId]) || 0) >= everyRevisions
        if (!due && !pending.cold) return
        if (!state.scanned) await scanForks()
        await maintainChat(chatId, { layout: !due })
      }).catch(error => logger.warn('dsh-tavern: 存档整理失败', chatId, String(error?.message || error)))
    }, Math.max(0, Math.min(quietMs, pending.since + 2 * quietMs - now())))
    quiet.set(chatId, pending)
  }

  return Object.freeze({
    maintainChat: chatId => serial(async () => { await load(); if (!state.scanned) await scanForks(); return maintainChat(chatId) }),
    sweep: () => serial(sweep),
    // After a start: `catchUpMs` later, every game `everyRevisions` behind gets its pass. Short, because
    // the host restarts often and a pass only joins the write lock in short steps.
    catchUp() {
      if (disposed) return
      setTimer(() => { void serial(() => disposed ? null : sweep({ behind: everyRevisions }))
        .catch(error => logger.warn('dsh-tavern: 存档整理失败', String(error?.message || error))) }, catchUpMs)
    },
    // The rule: called by the store with every committed revision.
    noteWrite(chatId, revision) {
      if (disposed || !chatId || !Number.isSafeInteger(revision)) return
      schedule(chatId, { revision })
    },
    // Called with the pack files one traced stage request read from the game's save.
    noteColdRead(chatId, visits) {
      if (disposed || !chatId || !(visits >= coldVisits)) return
      schedule(chatId, { cold: true })
    },
    async recordFork(chat) {
      const entry = forkEntry(chat)
      if (!entry || !chat?.id) return
      await serial(async () => { await load(); state.forks[chat.id] = entry; await save() })
    },
    dispose() { disposed = true; stop.abort(); for (const { timer } of quiet.values()) clearTimer(timer); quiet.clear() }
  })
}
