import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTurnLifecycleHooks, turnStoppingWaits } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'

// The host only appends turn/end after this hook settles. A commit that never settles
// would therefore leave the Agent running for good: composer stuck on its stop button,
// no turn/end, and a reopened page reads the same in-memory status.
function harness({ finalize }) {
  const handlers = new Map()
  const saved = []
  const session = {
    id: 'session',
    events: [
      { type: 'turn/start', data: { turn: 2 } },
      { type: 'assistant/message', data: { turn: 2, step: 1, message: { id: 'm', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text: '一段正文' }] } } }
    ]
  }
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
    requestPerformance: { run: async (_method, _id, operation) => { saved.push(_method); return operation() } },
    userMessageForTurn: () => ({ role: 'user', content: [{ type: 'text', text: '继续' }] }),
    requestIdForTurn: () => 'req',
    runtimePrompt: () => '',
    sessionStore: { flush() {} },
    turnOrchestrator: { recordFailure: async () => {}, modeFor: async () => 'story' },
    foregroundHandoff: { finalize, end() {}, syncCandidateMessageId: async () => {} },
    replaceAssistantReply() {}
  })
  return { saved, stop: () => handlers.get('agent/turn-stopping')({ agent: { session }, turn: 2 }) }
}

test('a commit that never settles still lets the turn finish', async (t) => {
  const warned = []
  t.mock.method(console, 'warn', value => warned.push(String(value)))
  const original = turnStoppingWaits.commit
  turnStoppingWaits.commit = 20
  try {
    const h = harness({ finalize: () => new Promise(() => {}) })
    await h.stop()
    assert.deepEqual(h.saved, ['generateCommit'])
    assert.match(warned.join('\n'), /正文提交超过 0 秒未返回/)
  } finally {
    turnStoppingWaits.commit = original
  }
})

test('a commit that resolves keeps its reply projection', async () => {
  const h = harness({ finalize: async () => ({ reply: { sessionText: '一段正文' } }) })
  await h.stop()
  assert.deepEqual(h.saved, ['generateCommit'])
})
