import { pendingMvuSettlementState } from './chat-session-state.js'
import { createMvuSettlementReconciler } from './mvu-settlement-reconciler.js'

function str(value) {
  return typeof value === 'string' ? value : (value === undefined || value === null ? '' : String(value))
}

// Waiting MVU deliveries (a submission saved, the card runtime not ready yet) resume on
// their own: after each settled turn, when a card runtime becomes ready, and on retries.
// A waiting game with no page in front gets the server runtime started for it.
// `deps` is read on each call; serverScripts may appear after creation.
export function createMvuSettlementResume(deps) {
  const reconciler = createMvuSettlementReconciler({
    list: () => deps.conversationRegistry.list(),
    resolve: async sessionId => {
      const { taskStateReader, backgroundTasks, sessionStateForSession } = deps
      const state = await taskStateReader.forSession(sessionId)
      // Pending delivery may need old message receipts. Idle eligibility does not.
      return state && backgroundTasks.activity(state).phase === 'pending'
        ? sessionStateForSession(sessionId) : state
    },
    shouldResume: function (chat) {
      const { backgroundTasks } = deps
      return Boolean(pendingMvuSettlementState(chat)?.hasSubmission
        && backgroundTasks.activity(chat).phase === 'pending')
    },
    isReady: function (sessionId, chat) {
      if (pendingMvuSettlementState(chat)?.prepared) return true
      const { tavernScriptDispatch, serverScripts, pageInFront } = deps
      const state = tavernScriptDispatch.status(sessionId)
      // A waiting settlement with no page in front keeps (or starts) the
      // server runtime until it finishes.
      if (serverScripts && !pageInFront(sessionId)) serverScripts.demand(sessionId)
      return state.ready === true || Boolean(state.initializationError)
    },
    resume: chatId => deps.queueSettlement(chatId),
    retryDelayMs: 10000,
    onError: function (error) {
      console.error('dsh-tavern: 接续等待中的 MVU 变量结算失败，将自动重试', str(error && error.message || error))
    }
  })
  // An unreadable save after a settlement: scan every game for waiting MVU work instead.
  const unsubscribeTurnSettled = deps.storyEvents.on('turn-settled', '接续 MVU 结算', ({ latest }) => latest ? reconciler.wake(latest.sessionId) : reconciler.scan())
  // A card runtime that finished starting may now run a waiting delivery.
  const unsubscribeRuntimeReady = deps.tavernScriptDispatch.subscribeSettled(function (sessionId) {
    void reconciler.wake(sessionId)
  })

  return Object.freeze({
    wake: sessionId => reconciler.wake(sessionId),
    scan: () => reconciler.scan(),
    dispose() { unsubscribeTurnSettled(); unsubscribeRuntimeReady(); reconciler.dispose() }
  })
}
