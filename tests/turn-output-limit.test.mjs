import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'

// A turn whose stream never produced a body must still say why: an output-limit cut, a
// reasoning-only answer, or nothing at all are three different failures.
function harness(events) {
  const handlers = new Map()
  const failures = []
  const session = { id: 'session', events }
  registerTurnLifecycleHooks({
    ctx: { on: (name, fn) => handlers.set(name, fn) },
    autoChoices: { cancel() {}, completed: async () => {} },
    pluginBodyGeneration: { validateResult: async () => {} },
    reconcileWhenIdle() {},
    backgroundAgentRunner: { owns: () => false },
    hookChatForSession: async () => undefined,
    clearRuntimePresetRequestState() {},
    contentText: () => '继续',
    foregroundStrategies: {},
    nativeWorldBookTemplateContext: async () => ({}),
    publishResourceWorkspace: async () => null,
    readChatCard: async () => undefined,
    requestPerformance: { run: async (_method, _id, operation) => operation() },
    userMessageForTurn: () => ({ role: 'user', content: [{ type: 'text', text: '继续' }] }),
    requestIdForTurn: () => 'req',
    runtimePrompt: () => '',
    sessionStore: { flush() {} },
    turnOrchestrator: { recordFailure: async value => failures.push(value), modeFor: async () => 'story' },
    foregroundHandoff: { finalize: async () => ({}), end() {} },
    replaceAssistantReply() {}
  })
  return {
    failures,
    stop: () => handlers.get('agent/turn-stopping')({ agent: { session }, turn: 2 })
  }
}

test('a stream cut at the output limit reports output-limit, not an empty response', async () => {
  const h = harness([
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'assistant/message', data: {
      turn: 2,
      step: 1,
      stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } }],
      message: { id: 'm', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'reasoning', text: '先想一下这场戏怎么推进' }] }
    } }
  ])
  await assert.rejects(h.stop(), /输出达到上限被截断/)
  assert.equal(h.failures[0].code, 'output-limit')
})

test('a reasoning-only turn keeps its own failure code', async () => {
  const h = harness([
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'assistant/message', data: {
      turn: 2,
      step: 1,
      stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }],
      message: { id: 'm', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'reasoning', text: '只想了没写' }] }
    } }
  ])
  await assert.rejects(h.stop(), /只返回了思考过程/)
  assert.equal(h.failures[0].code, 'reasoning-only')
})

test('a turn with no assistant message at all stays empty-response', async () => {
  const h = harness([{ type: 'turn/start', data: { turn: 2 } }])
  await assert.rejects(h.stop(), /没有返回正文/)
  assert.equal(h.failures[0].code, 'empty-response')
})

test('an attempt that only streamed reasoning is still not a body', async () => {
  // The provider stopped before any text block: DSH keeps the attempt, the round has nothing.
  const h = harness([
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'assistant/attempt', data: {
      turn: 2,
      step: 1,
      stream: [
        { type: 'chunk', chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
        { type: 'reasoning-chunks', index: 0, texts: ['先想一下这场戏怎么推进'] },
        { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'Provider stopped with: SAFETY', code: 'PI_AI_ERROR' } } } }
      ]
    } }
  ])
  await assert.rejects(h.stop(), /没有返回正文/)
  assert.equal(h.failures[0].code, 'empty-response')
})
