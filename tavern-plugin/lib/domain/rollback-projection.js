import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { rewindBackgroundSurface } from './background-surface.js'
import { sessionEvents, withSurfaceEditTurn } from './session-events.js'
import { replaceSessionSurface } from './session-surface-mutations.js'

function str(value) {
  return value === undefined || value === null ? '' : String(value)
}

export function createRollbackProjection({ sessions, timeline, dispatchEvent }) {
  const acquireBackgroundSession = sessions.acquireBackground || sessions.acquire

  // After the story commit: hide the round on the native surface (aborting the
  // commit if the host refuses), rewind background contexts, notify scripts and
  // publish the undo point. Shared by the complete and the bounded rollback.
  return async function projectRollback({ chat, agent, session, rollbackSurface, undo, rollbackWarning, messageCount, dispatchChat, abort, saveUndoPoint }) {
    // 3) 原生消息面：用空消息替换最近一轮的所有 surface 节点（模型不再看到），UI 由客户端隐藏对应 turn tail
    try {
      if (rollbackSurface.alreadyShadowed && !isDeepStrictEqual(session.surface.nodes, undo.foreground.nodes)) {
        throw new Error('回退期间模型上下文已变化，请刷新后重试')
      }
      const shadow = rollbackSurface.alreadyShadowed ? rollbackSurface.cleanup : rollbackSurface
      if (shadow) {
        // A rollback runs between turns. The replacement needs a native edit
        // turn so the session can still be loaded from the append-only log.
        const { toolReplay: _toolReplay, replayState: _replayState, ...source } = shadow.source
        withSurfaceEditTurn(session, agent, (turn, step) => replaceSessionSurface(session, 'assistant/message', {
          turn,
          step,
          message: {
            id: randomUUID(),
            role: 'assistant',
            content: [],
            source
          }
        }, { start: shadow.userSeq, end: shadow.endSeq, sourceEventSeqs: shadow.shadowedSeqs }))
      }
    } catch (error) {
      // Keep append-only history intact. A rejected surface replacement must not
      // consume the story checkpoint, and nothing is rewritten behind the save.
      try {
        await abort()
      } catch (restoreError) {
        throw new Error('回退失败且剧情恢复未完成：' + str(error?.message || error) + '；' + str(restoreError?.message || restoreError), { cause: error })
      }
      throw error
    }
    // The Chat commit above already hides this round. Persist its model-side
    // shadow now, not on the host's delayed live buffer behind slower background
    // and script steps: a crash in between would leave the round in the context.
    if (typeof sessions.flush === 'function') {
      try { await sessions.flush(session) }
      catch (error) { rollbackWarning = [rollbackWarning, '正文已回退，模型上下文保存失败：' + str(error?.message || error)].filter(Boolean).join('；') }
    }
    // Rewind immediately after the foreground commit; retain the timeline's retry
    // boundary so the next task can safely retry if this best-effort step fails.
    for (const participant of Object.values(timeline.inspect({ chat }).participants || {})) {
      if (participant.status !== 'needs-rewind' || !participant.sessionId) continue
      let restoredHandle
      try {
        let worker = sessions.get(participant.sessionId)
        let background = worker?.session || sessions.getSession?.(participant.sessionId)
        if (acquireBackgroundSession || (!background && typeof sessions.resume === 'function')) {
          restoredHandle = await (acquireBackgroundSession || sessions.resume)(participant.sessionId)
          worker = restoredHandle.agent
          background = worker?.session
        }
        if (!background) throw new Error('后台会话尚未加载，将在下次后台任务启动时重试')
        if (worker?.phase?.kind === 'running') {
          worker.cancel({ kind: 'parent' })
        }
        if (typeof worker?.whenIdle === 'function') {
          let timeout
          try {
            await Promise.race([worker.whenIdle(), new Promise((_, reject) => {
              timeout = setTimeout(() => reject(new Error('后台尚未停止，将在下次任务启动时重试')), 3000)
            })])
          } finally { clearTimeout(timeout) }
        }
        if (typeof sessions.flush !== 'function') throw new Error('当前宿主未提供后台会话保存接口')
        const checkpoint = { formatVersion: 4, sessionId: participant.sessionId, nodes: [...background.surface.nodes] }
        rewindBackgroundSurface(background, participant.rewindTo, worker, participant.formatVersion || 3)
        checkpoint.afterCount = sessionEvents(background).length
        undo.background.push(checkpoint)
        await sessions.flush(background)
      } catch (error) {
        rollbackWarning = [rollbackWarning, '正文已回退，后台上下文回退未完成：' + str(error?.message || error)].filter(Boolean).join('；')
      } finally {
        if (restoredHandle) {
          try { await restoredHandle.dispose() }
          catch (error) { rollbackWarning = [rollbackWarning, '后台回退临时会话释放失败：' + str(error?.message || error)].filter(Boolean).join('；') }
        }
      }
    }
    // Notify scripts only after both authoritative story and native surface have committed.
    try {
      await dispatchEvent({ sessionId: chat.sessionId, ...(dispatchChat ? { chat: dispatchChat } : { recent: true }), name: 'MESSAGE_DELETED', args: [messageCount] })
    } catch (error) { rollbackWarning = '回退已完成，但脚本联动失败：' + str(error?.message || error) }
    try {
      if (typeof sessions.flush === 'function') await sessions.flush(session)
      chat = await saveUndoPoint()
    } catch (error) { rollbackWarning = [rollbackWarning, '回退已完成，但撤销恢复点保存失败：' + str(error?.message || error)].filter(Boolean).join('；') }
    return { chat, warning: rollbackWarning }
  }
}
