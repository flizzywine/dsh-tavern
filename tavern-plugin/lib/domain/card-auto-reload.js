// A playing game follows its card: once the card or its world book changed, the next idle read of
// the game applies the update by itself, the same work as the old explicit reload. Only a legacy
// save whose own book copy needs synchronization keeps the manual button (the copy may hold card
// script writes an automatic overwrite would lose).

import { prepareTemplateHistory, synchronizeTemplateHistory } from './template-history.js'

export const CARD_RELOAD_BUSY = 'TAVERN_CARD_RELOAD_BUSY'

/** Whether a reload status asks for an update this game may take on its own. */
export function autoReloadable(status) {
  return Boolean(status && status.available && !status.error && status.digest
    && !status.legacy && !status.worldbookSyncRequired && (status.cardChanged || status.worldbookChanged))
}

/**
 * Runs `apply(sessionId, digest)` off the read that noticed the change, once per session at a time.
 * A failure is kept per digest so the same update is not retried on every read; a new edit (another
 * digest) or retry() tries again. Busy games stay queued for the idle watcher.
 * `published(sessionId)` runs after a success so pages re-read.
 */
export function createCardAutoReload({ apply, published = () => {}, logger = console, defer = task => setTimeout(task, 0) }) {
  const running = new Set()
  const failures = new Map()
  const waiting = new Set()

  function schedule(sessionId, status, { busy = false } = {}) {
    if (!sessionId || running.has(sessionId)) return false
    if (!autoReloadable(status)) {
      waiting.delete(sessionId)
      return false
    }
    if (failures.get(sessionId)?.digest === status.digest) return false
    if (busy) {
      waiting.add(sessionId)
      return false
    }
    waiting.delete(sessionId)
    running.add(sessionId)
    defer(async () => {
      try {
        await apply(sessionId, status.digest)
        failures.delete(sessionId)
        published(sessionId)
      } catch (error) {
        if (error?.code === CARD_RELOAD_BUSY) waiting.add(sessionId)
        else {
          failures.set(sessionId, { digest: status.digest, message: String(error?.message || error) })
          logger.warn('dsh-tavern: 自动重新加载人物卡失败', sessionId, error?.message || error)
        }
      } finally { running.delete(sessionId) }
    })
    return true
  }

  /** The last automatic failure of a game, for its status line. */
  function failure(sessionId, digest) {
    const failed = failures.get(sessionId)
    return failed && failed.digest === digest ? failed.message : ''
  }

  /** The player asked to retry: forget the failure so the next read tries again. */
  function retry(sessionId) { failures.delete(sessionId) }

  return Object.freeze({ schedule, failure, retry, running: sessionId => running.has(sessionId), waiting: sessionId => waiting.has(sessionId) })
}

export function createPlayCardUpdate({ chats, cards, snapshots, liveUpdate, native, activity, present, published, defer, logger }) {
  const stamps = new Map()
  const reload = createCardAutoReload({
    apply: (sessionId, digest) => apply(sessionId, digest, true),
    published, defer, logger
  })

  function playable(chat) {
    return chat && ['story', 'script'].includes(chat.mode || 'story') && chat.requestMode !== 'sillytavern'
  }

  function busy(chat, sessionId, observed) {
    return observed?.busy || native.agent(sessionId)?.phase?.kind === 'running'
      || ['pending', 'running', 'waiting-runtime'].includes(chat.settleStatus)
  }

  async function status(chat, { fresh, card, busy: observedBusy } = {}) {
    try {
      if (fresh === true) return snapshots().libraryBoundStatus(chat, card)
      const result = await snapshots().currentStatus(chat, { busy: observedBusy === true })
      reload.schedule(chat.sessionId, result, { busy: observedBusy === true })
      return { ...result, autoReloading: reload.running(chat.sessionId), autoReloadError: reload.failure(chat.sessionId, result.digest) }
    } catch (error) {
      return { available: true, error: String(error.message || error) }
    }
  }

  async function notice(sessionId) {
    const header = await chats.header(sessionId, ['cardPath', 'mode', 'requestMode', 'settleStatus'])
    if (!playable(header) || !header.cardPath) return
    const stamp = await cards.stamp(header.cardPath)
    const seen = stamps.get(sessionId)
    if (seen === undefined) stamps.set(sessionId, stamp)
    if ((seen === undefined || seen === stamp) && !reload.waiting(sessionId)) return
    // Keep the old stamp while busy so the next idle tick notices the edit again.
    if (busy(header, sessionId, await activity.observed(sessionId))) return
    stamps.set(sessionId, stamp)
    const chat = await chats.forSession(sessionId)
    if (chat) await status(chat)
  }

  async function apply(sessionId, digest, automatic) {
    if (typeof digest !== 'string' || !digest) throw new Error('请刷新后确认人物卡和世界书更新')
    const conflict = new Error('游戏状态已变化，未应用更新，请稍后重试')
    const blocked = Object.assign(new Error('请等待当前生成和后台任务完成后再应用人物卡'), { code: CARD_RELOAD_BUSY })
    for (let attempt = 0; attempt < 3; attempt++) {
      const chat = await chats.forSession(sessionId)
      if (!playable(chat)) throw new Error('仅支持当前游玩会话')
      if (busy(chat, sessionId, await activity.observed(sessionId))) throw blocked
      // Restarting card scripts would prevent an interrupted replacement from recovering.
      if (chat.regenInProgress) throw new Error('上一次正文重新生成尚未完成：请先点「重新生成正文」完成或恢复它，再应用人物卡')
      const card = await cards.read(chat.cardPath)
      if (!card) throw new Error('人物卡不存在')
      const patch = await snapshots().replacement(chat, card, digest)
      const prepared = await liveUpdate.prepare({ ...chat, ...patch }, card, chat)
      const session = native.session(sessionId)
      if (session) prepareTemplateHistory(session, chat, prepared)
      prepared.tavernHelperLifecycleRevision = (Number(chat.tavernHelperLifecycleRevision) || 0) + 1
      if (automatic) {
        const latest = chat.messages?.findLast(message => message?.role === 'assistant')
        prepared.cardAutoReload = { at: Date.now(), turn: Number(latest?.turn) || 0 }
      }
      const extensions = await cards.extensions(chat.cardPath, prepared)
      await liveUpdate.project(prepared, card, { projections: [] }, {
        charName: card.name, macroState: chat.macroState, regexScripts: extensions.regexScripts
      })
      await snapshots().replacement(chat, await cards.read(chat.cardPath), digest)
      try {
        const saved = await chats.update(chat.id, current => {
          if (busy(current, sessionId, activity.current(current))) throw blocked
          if (current._storageRevision !== chat._storageRevision) throw conflict
          return prepared
        }, { source: automatic ? 'card-context.auto-reload' : 'card-context.apply-update' })
        if (session) await synchronizeTemplateHistory(session, saved, native.flush)
        return await present(saved, card)
      } catch (error) {
        // Rebuild from the new snapshot; never publish a prepared update over it.
        if (error !== conflict) throw error
      }
    }
    throw conflict
  }

  return Object.freeze({
    status, notice,
    applyManual(sessionId, digest) {
      reload.retry(sessionId)
      return apply(sessionId, digest, false)
    }
  })
}
