import assert from 'node:assert/strict'
import test from 'node:test'
import { createForegroundOrchestrationStrategies } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { registerModelStreamHooks } from '../tavern-plugin/lib/hooks/model-stream.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'
import { useNativeTools } from '../tavern-plugin/lib/host/tools.js'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'

test('native host adapter receives only the approved foreground tools', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const received = []
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { assembleStablePrefix: false,
    modelStream: async function * (input) {
      received.push(input)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '正文' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  })
  t.after(() => h.dispose())
  const errors = []
  h.ctx.on('agent/error', payload => errors.push(payload.error?.stack || JSON.stringify(payload)))
  await useNativeTools(h.target.agent.ctx)
  const chat = { mode: 'story', messages: [] }
  let approved = ['submit_story']
  const strategies = createForegroundOrchestrationStrategies({ nativePlay: {
    modeFor: async () => 'story', visibleTools: async () => approved,
    resolvePreset: async () => null, controlledToolNames: new Set(['submit_story', 'edit']),
    storyOutputToolCall: async () => true
  } })
  for (const name of ['submit_story', 'edit']) h.ctx.tools.register({ name, description: name,
    parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: value => value }, execute: async () => 'ok'
  })
  registerTurnLifecycleHooks({ ctx: h.ctx, foregroundStrategies: strategies,
    backgroundAgentRunner: { owns: () => false }, hookChatForSession: async () => chat,
    turnOrchestrator: { modeFor: async () => 'story' }, ensureNativeSystemPrefix: async () => {},
    publishResourceWorkspace: async () => null, readChatCard: async () => ({}),
    nativeWorldBookTemplateContext: async () => ({}), runtimePrompt: () => '',
    clearRuntimePresetRequestState() {}, userMessageForTurn: () => null, contentText: () => '', foregroundHandoff: { end() {}, awaitOpening: async () => {} }
  })
  registerModelStreamHooks({ ctx: h.ctx, foregroundStrategies: strategies,
    backgroundAgentRunner: { owns: () => false, requestContext: () => undefined },
    requestCoordinates: new Map(), str: value => String(value || ''),
    chatForSession: async () => undefined,
    chatHeaderForSession: async () => undefined, sessionStore: h.ctx.sessions, agentRegistry: h.ctx.agents
  })
  for (const names of [['submit_story'], []]) {
    approved = names
    h.target.agent.followup({ id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'human' } })
    await h.target.agent.whenIdle()
  }
  assert.deepEqual(errors, [])
  assert.equal(received.length, 2)
  assert.deepEqual((received[0].tools || []).map(tool => tool.name), ['submit_story'])
  assert.deepEqual(received[1].tools || [], [])
})

test('Tavern native executor overrides an inherited program executor only in its own scope', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const received = []
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { nativeTools: false,
    modelStream: async function * (input) {
      received.push(input.tools || [])
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '完成' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  })
  t.after(() => h.dispose())
  if (!h.ctx.tools.setExecutor) { t.skip('0.2.1 has no scoped executors'); return }
  const programExecutor = { describe: () => ({ schemas: [{ name: 'run_code', description: 'Program', parameters: { type: 'object', properties: {} } }] }),
    execute: () => assert.fail('Tavern inherited the program executor') }
  h.ctx.tools.setExecutor(programExecutor)
  h.ctx.tools.register({ name: 'submit_story', description: '提交', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => value }, execute: async () => 'ok' })
  await useNativeTools(h.target.agent.ctx)
  h.target.agent.followup({ id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'human' } })
  await h.target.agent.whenIdle()
  assert.equal(received.length, 1)
  assert.deepEqual(received[0].map(tool => tool.name), ['submit_story'])
  assert.equal(h.ctx.tools.selectExecutor(), programExecutor, 'deployment executor remains unchanged')
})
