import { isTavernSurfaceEdit } from './session-surface-mutations.js'
const installations = new WeakMap()


/**
 * rc.1's meter assumes every assistant/message belongs to an active model step.
 * Tavern seeds and surface edits have no provider request/usage. Account for them
 * as injected messages in the meter's fold only, preserving their assistant role,
 * surface operation and seq. Never mutate the Session or its outgoing messages.
 * This isolated private-API shim must be covered against the installed host and
 * can be removed when upstream supports out-of-step surface edits natively.
 */
export function installTavernTokenMeter(meter) {
  if (!meter || typeof meter._foldEvent !== 'function') throw new Error('当前 DSH Token Meter 不支持 Tavern 消息统计适配，请检查 DSH 版本')
  let entry = installations.get(meter)
  if (!entry) {
    const original = meter._foldEvent
    const hadOwn = Object.hasOwn(meter, '_foldEvent')
    const compactSignature = original.length === 2
    const originalSync = meter._sync
    const hadOwnSync = Object.hasOwn(meter, '_sync')
    if (compactSignature && typeof originalSync !== 'function') throw new Error('当前 DSH Token Meter 缺少同步入口')
    const presetCursors = new WeakMap()
    const syncedSessions = new WeakSet()
    function presetBefore(session, state, seq, rawEventAt) {
      let cursor = presetCursors.get(state)
      if (!cursor || cursor.session !== session || seq < cursor.nextSeq) {
        cursor = { session, nextSeq: 0, selected: undefined }
        presetCursors.set(state, cursor)
      }
      // Read only the unseen prefix, excluding the event being classified.
      // Reset with the host fold state, or when a replay moves backwards.
      while (cursor.nextSeq < seq) {
        const previous = rawEventAt ? rawEventAt.call(session, cursor.nextSeq) : session.eventAt(cursor.nextSeq)
        if (previous?.type === 'agent-preset/selected') cursor.selected = previous.data?.agentPreset
        cursor.nextSeq++
      }
      return cursor.selected ?? session.header?.agentPreset
    }
    function toAccountingEvent(session, state, event, rawEventAt) {
      return session && state && event && isTavernSurfaceEdit(session, event, state.surface, () => presetBefore(session, state, event.seq, rawEventAt))
        ? { ...event, type: 'user/message', data: event.data.message }
        : event
    }
    let activeSession
    function sync(session, ...args) {
      const previous = activeSession
      activeSession = session
      if (session && !syncedSessions.has(session)) {
        this.states?.delete?.(session)
        syncedSessions.add(session)
      }
      const rawEventAt = session?.eventAt
      const hadOwnEventAt = session ? Object.hasOwn(session, 'eventAt') : false
      if (typeof rawEventAt === 'function') {
        session.eventAt = seq => {
          const event = rawEventAt.call(session, seq)
          const state = this.states?.get?.(session)
          return state && seq === state.consumedEvents ? toAccountingEvent(session, state, event, rawEventAt) : event
        }
      }
      try { return originalSync.call(this, session, false, ...args.slice(1)) }
      finally {
        if (typeof rawEventAt === 'function') {
          if (hadOwnEventAt) session.eventAt = rawEventAt
          else delete session.eventAt
        }
        activeSession = previous
      }
    }
    function fold(...args) {
      const [session, state, event] = compactSignature ? [activeSession, ...args] : args
      const accountingEvent = toAccountingEvent(session, state, event)
      return compactSignature ? original.call(this, state, accountingEvent) : original.call(this, session, state, accountingEvent)
    }
    meter._foldEvent = fold
    if (compactSignature) meter._sync = sync
    entry = { original, fold, hadOwn, originalSync, hadOwnSync, compactSignature, users: 0 }
    installations.set(meter, entry)
  }
  entry.users++
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    if (--entry.users !== 0) return
    if (entry.hadOwn) meter._foldEvent = entry.original
    else delete meter._foldEvent
    if (entry.compactSignature) {
      if (entry.hadOwnSync) meter._sync = entry.originalSync
      else delete meter._sync
    }
    installations.delete(meter)
  }
}
