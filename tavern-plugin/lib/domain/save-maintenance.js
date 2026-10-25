import { retainedRevisions } from './conversation-retention.js'
import { FORK_HISTORY_TURNS } from './conversation-fork-targets.js'

const STATE_PATH = 'save-maintenance.json'

/**
 * Keeps saves small without touching anything play or story export reads:
 * old revisions nothing can reach any more, pre-migration journal files once
 * no kept revision predates the migration, and debugging logs (model request
 * bodies, worldbook recall audits) outside their recent windows. History for
 * forking from an earlier turn is kept for the latest `keepTurns` turns. After a
 * settlement, a game whose save grew by `everyRevisions` revisions since its last pass
 * is tidied once it has been quiet for `quietMs`: a pass holds the save's write lock
 * (seconds on a long save), so it never runs between two turns of play.
 */
export function createSaveMaintenance({
  chats, listChatIds, requestLog, recallLog, isIdle, store,
  keepRecent = 8, keepTurns = FORK_HISTORY_TURNS, everyRevisions = 50, graceMs, logger = console,
  quietMs = 600000, setTimer = (fn, ms) => { const timer = setTimeout(fn, ms); timer.unref?.(); return timer }, clearTimer = clearTimeout
}) {
  let state = null
  let disposed = false
  let tail = Promise.resolve()
  const quiet = new Map() // chatId -> the pass waiting for the game to go quiet

  async function load() {
    if (state) return state
    const value = await store.readJson(STATE_PATH).catch(() => undefined)
    state = value?.version === 1 ? value : { version: 1, scanned: false, forks: {}, compacted: {} }
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

  async function maintainChat(chatId) {
    if (disposed) return { status: 'disposed' }
    await load()
    if (!(await isIdle(chatId))) return { status: 'busy' }
    const result = { status: 'done', requests: await requestLog.prune(chatId).catch(() => null), recalls: await recallLog.prune(chatId).catch(() => null) }
    const head = await chats.readRetentionHeader(chatId)
    if (!head) return { ...result, status: 'legacy-format' }
    if (head.regenInProgress) return { ...result, status: 'busy' }
    if (state.compacted[chatId] === head._storageRevision) return { ...result, status: 'unchanged' }
    const retain = await retainedRevisions(head, (id, revision) => chats.readRetentionHeader(id, revision), forkRevisionsOf(chatId), { keepTurns })
    if (!(await isIdle(chatId))) return { ...result, status: 'busy' }
    // Incremental reads back to the last few rollback points stay fast.
    const recentCheckpoints = (head.timeline?.checkpoints || []).slice(-3).map(item => Number(item?.beforeRevision)).filter(Number.isSafeInteger)
    const changeFloor = recentCheckpoints.length ? Math.min(...recentCheckpoints) : undefined
    // Before the sweep, so this same pass frees the packs the relayout emptied.
    result.relayout = await chats.relayout(chatId)
    result.compaction = await chats.compact(chatId, { retain: revision => retain.has(revision), keepRecent, changeFloor, graceMs })
    const legacyFrom = Number(head.legacyInitialRevision)
    const oldestKept = Math.min(head._storageRevision - keepRecent + 1, ...retain)
    if (Number.isSafeInteger(legacyFrom) && legacyFrom > 0 && oldestKept >= legacyFrom) {
      result.legacy = await chats.removeLegacyFiles(chatId)
    }
    state.compacted[chatId] = head._storageRevision
    await save()
    return result
  }

  async function sweep() {
    await load()
    if (!state.scanned) await scanForks()
    let freed = 0, chatsDone = 0
    for (const chatId of await listChatIds()) {
      if (disposed) break
      try {
        const result = await maintainChat(chatId)
        freed += (result.compaction?.bytes || 0) + (result.legacy?.bytes || 0)
        if (result.status === 'done') chatsDone++
      } catch (error) { logger.warn('dsh-tavern: 存档整理失败', chatId, String(error?.message || error)) }
    }
    return { freed, chats: chatsDone }
  }

  return Object.freeze({
    maintainChat: chatId => serial(async () => { await load(); if (!state.scanned) await scanForks(); return maintainChat(chatId) }),
    sweep: () => serial(sweep),
    // The rule: called after each settlement with the save's revision. Each settlement
    // restarts the quiet period; the pass runs when none followed for `quietMs`.
    noteWrite(chatId, revision) {
      if (disposed || !chatId || !Number.isSafeInteger(revision)) return
      clearTimer(quiet.get(chatId))
      quiet.set(chatId, setTimer(() => {
        quiet.delete(chatId)
        void serial(async () => {
          if (disposed) return
          await load()
          if (revision - (Number(state.compacted[chatId]) || 0) < everyRevisions) return
          if (!state.scanned) await scanForks()
          const result = await maintainChat(chatId)
          const freed = (result.compaction?.bytes || 0) + (result.legacy?.bytes || 0)
          if (freed > 0) logger.log('dsh-tavern: 存档整理', chatId, '释放约', Math.round(freed / 1048576), 'MB')
        }).catch(error => logger.warn('dsh-tavern: 存档整理失败', chatId, String(error?.message || error)))
      }, quietMs))
    },
    async recordFork(chat) {
      const entry = forkEntry(chat)
      if (!entry || !chat?.id) return
      await serial(async () => { await load(); state.forks[chat.id] = entry; await save() })
    },
    dispose() { disposed = true; for (const timer of quiet.values()) clearTimer(timer); quiet.clear() }
  })
}
