import assert from 'node:assert/strict'
import test from 'node:test'
import { Session } from './fixtures/dsh-session-host.mjs'
import { appendSessionEvent } from '../tavern-plugin/lib/domain/session-events.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'

// The hook is where a queued edit actually lands: the turn's end releases it.
function harness(owned = false) {
  const handlers = new Map()
  const flushed = []
  const session = Session.create('queue-hook')
  appendSessionEvent(session, 'turn/start', { turn: 1 })
  appendSessionEvent(session, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  registerTurnLifecycleHooks({
    ctx: { on: (name, handler) => { handlers.set(name, handler) } },
    flushQueuedBodyEdits: sessionId => { flushed.push(sessionId); return Promise.resolve(1) },
    backgroundAgentRunner: { owns: () => owned },
    foregroundHandoff: { end() {} },
    autoChoices: { cancel() {}, completed: async () => {} },
    clearRuntimePresetRequestState() {},
    pluginBodyGeneration: {},
    reconcileWhenIdle: async () => {},
    hookChatForSession: async () => null,
    contentText: () => '',
    ensureNativeSystemPrefix: async () => {},
    foregroundStrategies: {},
    nativeWorldBookTemplateContext: async () => ({}),
    persistClearedBodyEdits: async () => {},
    pluginPromptSections: async () => [],
    publishResourceWorkspace: async () => ({}),
    readChatCard: async () => null,
    replaceAssistantReply() {},
    requestIdForTurn: () => '',
    requestPerformance: null,
    runtimePrompt: () => '',
    sessionStore: { flush: async () => {} },
    storyOutputToolCall: async () => null,
    turnOrchestrator: { modeFor: async () => 'story' },
    turnStarted() {},
    userMessageForTurn: () => null,
  })
  return { handlers, flushed, session }
}

test('turn/end 释放排队编辑', async () => {
  const h = harness()
  h.handlers.get('session/event')(h.session, { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } })
  assert.deepEqual(h.flushed, ['queue-hook'])
})

test('后台回合的 turn/end 不碰前台排队编辑', async () => {
  const h = harness(true)
  h.handlers.get('session/event')(h.session, { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } })
  assert.deepEqual(h.flushed, [])
})

test('turn/start 不释放排队编辑', async () => {
  const h = harness()
  h.handlers.get('session/event')(h.session, { type: 'turn/start', seq: 1, data: { turn: 1 } })
  assert.deepEqual(h.flushed, [])
})
