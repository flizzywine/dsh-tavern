import test from 'node:test'
import assert from 'node:assert/strict'
import { registerRequestHooks } from '../tavern-plugin/lib/hooks/request.js'

function preStep() {
  const handlers = {}
  const prepared = []
  registerRequestHooks({
    backgroundAgentRunner: { owns: () => false },
    cardMemory: { appendRecall: async ({ decision }) => decision },
    chatForSession: async () => undefined,
    ctx: { on: (name, handler) => { handlers[name] = handler } },
    foregroundStrategies: { prepareStep: async input => { prepared.push(input.sessionId); return { ...input.decision, status: true } } },
    requestCoordinates: new Map(),
    requestIdForMessages: () => '',
    sessionStore: { flush: async () => {} },
    tavernRetryLimiter: { handle: async (_payload, next) => next() }
  })
  return { run: header => handlers['agent/pre-step']({ agent: { session: { id: 's1', header } }, step: 1, messages: [] }, async () => ({ kind: 'enter', messages: [] })), prepared }
}

test('child agent sessions get no Tavern turn frame or status', async () => {
  const hook = preStep()
  assert.deepEqual(await hook.run({ parentSession: 'game-1' }), { kind: 'enter', messages: [] })
  assert.deepEqual(hook.prepared, [])
})

test('top-level sessions still go through foreground preparation', async () => {
  const hook = preStep()
  assert.equal((await hook.run({})).status, true)
  assert.deepEqual(hook.prepared, ['s1'])
})
