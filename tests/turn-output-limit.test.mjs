import test from 'node:test'
import assert from 'node:assert/strict'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'

// A stream cut off at the output limit leaves a submit_story call without its receipt:
// storySubmissionForTurn() finds nothing, and the visible text blocks are empty because
// the body sits in the tool arguments. That is a truncated turn, not a model that wrote
// nothing, and the failure record has to say so.
function harness(events) {
  const handlers = new Map()
  const failures = []
  const finalized = []
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
    ensureNativeSystemPrefix: async () => {},
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
    foregroundHandoff: { finalize: async value => { finalized.push(value); return {} }, end() {} },
    replaceAssistantReply() {},
  })
  return {
    failures,
    finalized,
    stop: () => handlers.get('agent/turn-stopping')({ agent: { session }, turn: 2 })
  }
}

function truncatedTurn() {
  return {
    stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } }],
    message: {
      id: 'm',
      role: 'assistant',
      source: { kind: 'model' },
      content: [{ type: 'reasoning', text: '先想一下这场戏怎么推进' }]
    }
  }
}

function truncatedSubmission() {
  return {
    stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } }],
    message: {
      id: 'm',
      role: 'assistant',
      source: { kind: 'model' },
      content: [{ type: 'tool-call', id: 'c', name: 'submit_story', arguments: '{"think":"构思","content":"青石板上的水光晃了一下，她' }]
    }
  }
}

function reasoningOnlyTurn() {
  return {
    stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }],
    message: { id: 'm', role: 'assistant', source: { kind: 'model' }, content: [{ type: 'reasoning', text: '只想了没写' }] }
  }
}

test('a stream cut at the output limit reports output-limit, not an empty response', async () => {
  const h = harness([
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'assistant/message', data: { turn: 2, step: 1, ...truncatedTurn() } }
  ])
  await assert.rejects(h.stop(), /输出达到上限被截断/)
  assert.equal(h.failures.length, 1)
  assert.equal(h.failures[0].code, 'output-limit')
})

test('a reasoning-only turn keeps its own failure code', async () => {
  const h = harness([
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'assistant/message', data: { turn: 2, step: 1, ...reasoningOnlyTurn() } }
  ])
  await assert.rejects(h.stop(), /只返回了思考过程/)
  assert.equal(h.failures[0].code, 'reasoning-only')
})

test('a turn with no assistant message at all stays empty-response', async () => {
  const h = harness([{ type: 'turn/start', data: { turn: 2 } }])
  await assert.rejects(h.stop(), /没有返回正文/)
  assert.equal(h.failures[0].code, 'empty-response')
})

test('a submission cut inside its content keeps the prose it already wrote', async () => {
  const h = harness([
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'assistant/message', data: { turn: 2, step: 1, ...truncatedSubmission() } }
  ])
  await h.stop()
  assert.equal(h.failures.length, 0, '抢救到的正文不算空回合')
  assert.equal(h.finalized.length, 1)
  assert.equal(h.finalized[0].assistantText, '青石板上的水光晃了一下，她')
  assert.equal(h.finalized[0].incomplete, true)
})

function attemptThatStreamedSubmission() {
  return {
    turn: 2,
    step: 1,
    stream: [
      { type: 'chunk', chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
      { type: 'tool-call-chunks', index: 0, id: 'c1', name: 'submit_story', args: [
        '{"content":"门扇无声滑开的刹那，璀璨夺目的暖黄水晶灯光',
        '倾泻而出，瞬间将我们母子二人笼罩在一片奢靡温热的空气里。'
      ] },
      { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { message: 'Provider stopped with: SAFETY', code: 'PI_AI_ERROR' } } } }
    ]
  }
}

test('a provider that stops mid-stream still keeps the body it already streamed', async () => {
  // SAFETY / idle timeout: no assistant/message exists, only the attempt's stream.
  const h = harness([
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'assistant/attempt', data: attemptThatStreamedSubmission() }
  ])
  await h.stop()
  assert.equal(h.failures.length, 0, '抢救到的正文不该记成空回合')
  assert.equal(h.finalized.length, 1)
  assert.equal(h.finalized[0].assistantText, '门扇无声滑开的刹那，璀璨夺目的暖黄水晶灯光倾泻而出，瞬间将我们母子二人笼罩在一片奢靡温热的空气里。')
  assert.equal(h.finalized[0].incomplete, true)
})

test('an attempt that only streamed reasoning is still not a body', async () => {
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
