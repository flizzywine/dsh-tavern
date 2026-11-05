import assert from 'node:assert/strict'
import test from 'node:test'
import { createForegroundOrchestrationStrategies } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { registerModelStreamHooks } from '../tavern-plugin/lib/hooks/model-stream.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'
import { markRequestHandled } from '../tavern-plugin/lib/domain/request-lineage.js'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'

for (const mode of ['story', 'script', 'card']) test(`${mode}: host overwrite cannot bypass foreground admission`, async () => {
  const hooks = new Map(), received = [], catalog = []
  const definitions = ['submit_story', 'tavern_generate_body', 'edit', 'style_reference_submit', 'plugin_off', 'plugin_locked', 'plugin_card'].map(name => Object.freeze({ name }))
  const chat = { mode, messages: [], disabledForegroundTools: ['plugin_off'] }
  let approved = ['submit_story']
  const strategies = createForegroundOrchestrationStrategies({ nativePlay: {
    modeFor: async () => mode, visibleTools: async () => approved,
    resolvePreset: async () => null, workspaceContext: () => '',
    controlledToolNames: new Set(['submit_story', 'tavern_generate_body', 'edit', 'style_reference_submit']),
    pluginToolsUnlocked: async (_id, names) => names.filter(name => name !== 'plugin_locked'),
    pluginToolModes: name => name === 'plugin_card' ? ['card'] : null,
    recordTools: (_id, tools) => catalog.push(tools), storyOutputToolCall: async () => true,
    styleReferencePrompt: () => '文风选段'
  } })
  const agent = { session: { id: 'game', header: {}, events: [] } }
  const ctx = { on: (name, fn) => hooks.set(name, fn), get() {},
    tools: { schemas: (_agent, toolSet) => toolSet.schemas },
    llm: { stream: request => {
      received.push(request)
      assert.equal(strategies.projectToolRequest(request), null, 'redispatch reaches a fixed point')
      return (async function * () { yield { type: 'finish' } })()
    } }
  }
  const background = { owns: id => id === 'background', requestContext: () => undefined }
  registerTurnLifecycleHooks({ ctx, backgroundAgentRunner: background, foregroundStrategies: strategies,
    hookChatForSession: async () => chat, ensureNativeSystemPrefix: async () => {},
    turnOrchestrator: { modeFor: async () => mode }, publishResourceWorkspace: async () => null,
    readChatCard: async () => ({}), nativeWorldBookTemplateContext: async () => ({}), runtimePrompt: () => ''
  })
  registerModelStreamHooks({ ctx, foregroundStrategies: strategies, backgroundAgentRunner: background,
    requestCoordinates: new Map(), str: value => String(value || ''), importContextPreparation: { isPrepared: () => true }
  })
  const assemble = async () => hooks.get('system-prompt/assemble')({}, { agent, toolSet: { schemas: definitions } },
    // Other middleware may already have assigned an empty assembly.tools.
    async () => ({ sections: [], contexts: [], variables: {}, tools: [] }))
  const result = await assemble()
  const expected = mode === 'card' ? ['submit_story', 'plugin_off', 'plugin_card'] : ['submit_story']
  assert.deepEqual(result.tools.map(tool => tool.name), expected)
  if (mode !== 'card') {
    assert.match(result.sections.find(section => section.name === 'tavern:story-tool-submission').text, /不要调用任何其他工具/)
    assert.ok(catalog.at(-1).some(tool => tool.name === 'plugin_off'))
  }
  assert.ok(!result.sections.some(section => ['tavern:plugin-body-generation', 'tavern:foreground-style-reference'].includes(section.name)))
  // Model middleware sees the host's unfiltered, frozen declarations after assembly.
  const request = Object.freeze(markRequestHandled({ sessionId: 'game', tools: Object.freeze(definitions), messages: [] }, 'full-template'))
  for await (const _chunk of hooks.get('llm/stream')(request, () => assert.fail('unfiltered request escaped'))) {}
  assert.deepEqual(received[0].tools.map(tool => tool.name), expected)
  assert.equal(request.tools.length, definitions.length, 'host-owned declarations are never mutated')
  assert.equal(strategies.projectToolRequest({ ...request, sessionId: 'background' }), null)
  assert.equal(strategies.projectToolRequest({ ...request, purpose: 'compaction' }), null)
  const execute = hooks.get('tools/pre-execute')
  assert.equal((await execute({ agent, name: 'edit' }, () => assert.fail('unapproved tool executed'))).kind, 'deny')
  assert.equal(await execute({ agent, name: 'submit_story' }, () => 'allowed'), 'allowed')
  assert.equal(await execute({ agent: { session: { id: 'background' } }, name: 'edit' }, () => 'background'), 'background')
  approved = ['edit']
  await assemble()
  assert.equal(strategies.allowsTool('game', 'submit_story'), false)
  assert.equal(strategies.allowsTool('game', 'edit'), true, 'each step refreshes admission')
  strategies.clearRequestState('game')
  assert.equal(strategies.projectToolRequest(request), null)
})

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
    clearRuntimePresetRequestState() {}, userMessageForTurn: () => null, contentText: () => '', foregroundHandoff: { end() {} }
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
