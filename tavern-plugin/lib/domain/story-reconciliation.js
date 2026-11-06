import { randomUUID } from 'node:crypto'
import { repairNativeSurface, recordNativeSurfaceRepair, planNativeSurfaceRepair } from './native-surface-repair.js'
import { reshadowRolledBackRounds } from './rollback-surface.js'
import { sessionEvents } from './session-events.js'
import { inspectStoryAlignment, nativeStoryTurns } from './story-alignment.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// Bring the save and the native session back into agreement before anything
// acts on "the latest round" (#196): record a round the save missed, re-shadow
// a rolled-back round the model still sees, and rewrite the native tail from the
// save when their text drifted. The save is the truth. Never blocks the caller.
export function createStoryReconciliation({ agentRegistry, sessionStore, chatForSession, chatSliceForSession, updateChat, turns }) {
  const liveSession = sessionId => sessionStore.get(sessionId) || agentRegistry.get(sessionId)?.session
  // Reconciling writes the save: never while a turn of that session runs, where
  // it would wait on the very turn it shares the template runtime with.
  const reconciledSessions = new Set(), reconciling = new Map()

  async function reconcileWhenIdle(sessionId, { once = false } = {}) {
    sessionId = str(sessionId)
    if (!sessionId || (once && reconciledSessions.has(sessionId))) return null
    // Any phase but idle may be a turn being prepared; reconciling then would race it.
    // The agent phase can still read idle while a turn's hooks run, so an open
    // turn in the log (started, not ended) counts as busy too.
    const busy = () => {
      const kind = agentRegistry.get(sessionId)?.phase?.kind
      if (kind && kind !== 'idle') return true
      const session = liveSession(sessionId)
      const events = session ? sessionEvents(session) : []
      const started = events.findLastIndex(event => event?.type === 'turn/start'), ended = events.findLastIndex(event => event?.type === 'turn/end')
      return started > ended
    }
    if (busy()) {
      const agent = agentRegistry.get(sessionId)
      if (once || typeof agent?.whenIdle !== 'function') return null
      await agent.whenIdle()
      if (busy()) return null
    }
    // One reconcile per session at a time; concurrent view reads share it.
    if (reconciling.has(sessionId)) return await reconciling.get(sessionId)
    const run = reconcileStory(sessionId, { stillIdle: () => !busy() })
    reconciling.set(sessionId, run)
    try {
      const report = await run
      if (report) reconciledSessions.add(sessionId)
      return report
    } finally { reconciling.delete(sessionId) }
  }

  async function repairNativeStory(sessionId, session, reason) {
    const chat = await chatForSession(sessionId)
    if (!chat || chat.regenInProgress || !['story', 'script'].includes(chat.mode || 'story')) return null
    try {
      const result = repairNativeSurface(session, chat, { repairId: randomUUID() })
      if (result.applied) await sessionStore.flush(session)
      await updateChat(chat.id, current => recordNativeSurfaceRepair(current, chat, result.anchors) ? current : undefined, { source: 'native-repair' })
      if (result.applied) console.warn('dsh-tavern: 模型上下文与存档不一致（' + reason + '），已按存档重写最近 ' + result.plan.rounds.length + ' 轮')
      return result
    } catch (error) {
      console.warn('dsh-tavern: 模型上下文修复失败，下次打开或操作时重试：' + str(error?.message || error))
      await markNativeStale(chat.id, reason).catch(() => {})
      return null
    }
  }

  async function markNativeStale(chatId, reason) {
    await updateChat(chatId, current => {
      if (current.nativeSync?.status === 'stale') return undefined
      current.nativeSync = { status: 'stale', reason: str(reason), at: Date.now() }
      return current
    }, { source: 'native-repair.stale' })
  }

  // The save's latest player rounds, oldest first: enough rows to cover the native window.
  async function storyAlignmentInput(sessionId, nativeCount) {
    const fields = ['id', 'mode', 'nativeCommits', 'suppressedDshTurns', 'regeneratedDshTurns', 'regenInProgress', 'nativeSync']
    const head = await chatSliceForSession(sessionId, [], fields)
    let header, rows
    if (head?.chat) {
      const total = Number(head.messageCount) || 0, want = Math.min(total, nativeCount * 3 + 20)
      const selected = want ? await chatSliceForSession(sessionId, Array.from({ length: want }, (_, index) => total - want + index), []) : null
      header = head.chat
      rows = selected?.chat?.messages || []
    } else {
      header = await chatForSession(sessionId)
      rows = header?.messages || []
    }
    if (!header) return null
    const story = rows.filter(message => message?.role === 'assistant' && !message.greeting)
    return { header, rows, storyTurns: story.map(message => Number(message.turn)), storyAnchors: story.map(message => message.nativeAnchor).filter(Boolean) }
  }

  // Turn numbers can agree while the text drifted (an edit that never reached the model):
  // the repair planner checks the latest rounds' text against the rows already read.
  function alignStory(session, input) {
    const report = inspectStoryAlignment({ session, ...input })
    if (report.state === 'regenerating') return report
    const textDrift = planNativeSurfaceRepair({ chat: { id: input.header.id, messages: input.rows }, events: sessionEvents(session), nodes: session.surface?.nodes || [] }).status !== 'intact'
    const nativeSync = input.header.nativeSync?.status || ''
    return { ...report, textDrift, nativeSync, aligned: report.aligned && !textDrift && nativeSync !== 'stale' }
  }

  async function reconcileStory(sessionId, { repair = true, stillIdle = () => true } = {}) {
    try {
      sessionId = str(sessionId)
      const session = sessionId && liveSession(sessionId)
      if (!session) return null
      const input = await storyAlignmentInput(sessionId, nativeStoryTurns(session).length)
      if (!input || !['story', 'script'].includes(input.header.mode || 'story')) return null
      const report = alignStory(session, input)
      if (!repair || report.aligned || report.state === 'regenerating') return report
      for (const round of report.adopt) {
        if (!stillIdle()) return report
        const adopted = await turns.finalize({ sessionId, turn: round.turn, requestId: round.requestId, userText: round.userText, userContent: round.userContent, assistantText: round.assistantText, nativeAnchor: round.nativeAnchor, adopt: true })
        if (adopted?.saved && !adopted.duplicate) console.warn('dsh-tavern: 第 ' + round.turn + ' 轮已完成但未写入存档，已补记')
      }
      const shadowed = reshadowRolledBackRounds(session, new Set(report.rolledBackVisible))
      if (shadowed.length) {
        await sessionStore.flush(session)
        console.warn('dsh-tavern: 第 ' + shadowed.join('、') + ' 轮已回退但模型仍能看到，已重新隐藏')
      }
      let after = alignStory(session, await storyAlignmentInput(sessionId, nativeStoryTurns(session).length))
      // The save is the truth: rewrite the native tail after the last round both still agree on.
      if (!after.aligned && stillIdle()) {
        await repairNativeStory(sessionId, session, after.state === 'mismatch' ? '轮次不一致' : after.nativeSync === 'stale' ? '上次同步失败' : after.textDrift ? '正文不一致' : '找不到原生位置')
        after = alignStory(session, await storyAlignmentInput(sessionId, nativeStoryTurns(session).length))
      }
      if (after.state === 'mismatch') console.warn('dsh-tavern: 存档与模型上下文的轮次修复后仍不一致：' + JSON.stringify(after.mismatch))
      return after
    } catch (error) {
      console.warn('dsh-tavern: 存档与模型上下文核对失败：' + str(error?.message || error))
      return null
    }
  }

  return {
    reconcileStory,
    reconcileWhenIdle,
    repairNativeStory,
    // Let a turn start after an in-flight reconcile of its session.
    async waitReconcile(sessionId) { await reconciling.get(str(sessionId))?.catch(() => {}) },
  }
}
