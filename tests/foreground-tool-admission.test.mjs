import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createForegroundOrchestrationStrategies } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { USE_SKILL_TOOL } from '../tavern-plugin/lib/domain/foreground-tools.js'
import { filterPlayMessages } from '../tavern-plugin/lib/domain/play-request-policy.js'
import { installTavernPlaySkillScope } from '../tavern-plugin/lib/domain/tavern-skill-provider.js'
import { registerModelStreamHooks } from '../tavern-plugin/lib/hooks/model-stream.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'
import { useNativeTools } from '../tavern-plugin/lib/host/tools.js'
import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'

test('play context keeps story materials and drops unknown host contributions from saved history', () => {
  const message = (role, source, text) => ({ role, source, content: [{ type: 'text', text }] })
  const section = { name: 'tavern:character-card', text: '人物设定' }
  const mixed = message('system', { kind: 'system-prompt', sections: [section, { name: 'future:system', text: '宿主设定' }] }, '人物设定\n\n宿主设定')
  const story = [message('user', { kind: 'user' }, '继续'), message('assistant', { kind: 'model' }, '剧情'),
    message('user', { kind: 'skill-catalog' }, '写作 Skill'), message('user', { kind: 'compact-checkpoint' }, '前情'),
    message('user', { kind: 'plugin:dsh-tavern', form: 'foreground-frame' }, '本轮世界书')]
  const unknown = message('user', { kind: 'plugin:future-host-provider' }, '宿主上下文')
  assert.deepEqual(filterPlayMessages([mixed, unknown, ...story]), [message('system', { kind: 'system-prompt', sections: [section] }, '人物设定'), ...story])
  assert.match(mixed.content[0].text, /宿主设定/, '保存的原始消息保持完整')
})

test('play context removes unapproved saved Skill calls and their results without changing the session', () => {
  const call = (name, id, skill) => ({ type: 'tool-call', id, name, arguments: JSON.stringify({ name: skill, action: 'load' }) })
  const text = text => ({ type: 'text', text })
  const story = { role: 'user', source: { kind: 'user' }, content: [text('/unexpected')] }
  const manual = { role: 'user', source: { kind: 'skill-invocation', name: 'manual' }, content: [text('经批准的手动写作要求')] }
  const foreignInvocation = { role: 'user', source: { kind: 'skill-invocation', name: 'unexpected' }, content: [text('来自旧存档的宿主指令')] }
  const assistant = { role: 'assistant', source: { kind: 'model', replayState: {} }, content: [text('正文'),
    call('skill', 'foreign', 'unexpected'), call(USE_SKILL_TOOL, 'allowed', 'dialogue')] }
  const result = id => ({ role: 'tool', toolCallId: id, content: [text('内容 ' + id)] })
  const messages = [story, manual, foreignInvocation, assistant, result('foreign'), result('allowed')]
  const skills = [{ name: 'dialogue', modelInvocable: true }, { name: 'manual', userInvocable: true }]
  const projected = filterPlayMessages(messages, undefined, { skills })
  assert.deepEqual(projected, [story, manual, { ...assistant, source: { kind: 'model' }, content: [assistant.content[0], assistant.content[2]] }, result('allowed')])
  assert.equal(assistant.content.length, 3)
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
  await useNativeTools(h.target.agent.ctx)
  const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { SkillRegistry } = await import(new URL('../../dsh-skill/lib/index.js', bootUrl))
  const toolSkill = await import(new URL('../../dsh-tool-skill/lib/index.js', bootUrl))
  await h.ctx.plugin(SkillRegistry).await()
  h.ctx.provide('workingDirectory', { ensure: async () => process.cwd() })
  const writingSkill = { name: 'dialogue', description: '当前写作 Skill', modelInvocable: true, userInvocable: true }
  h.ctx.skills.register({ name: writingSkill.name, description: writingSkill.description, content: 'APPROVED_WRITING_BODY', provider: 'tavern', source: 'runtime' })
  const foreign = 'diagnose-windows-sandbox-acl'
  h.ctx.skills.register({ name: foreign, description: 'Foreign host skill', content: 'UNAPPROVED_HOST_SKILL_BODY', provider: 'dsh-windows-acl', source: 'runtime' })
  t.after(installTavernPlaySkillScope(h.ctx.get('skills'), async scope => scope?.session?.id === h.input.sessionId))
  await h.ctx.plugin(toolSkill).await()
  const lookup = { scope: h.target.agent }
  assert.deepEqual((await h.ctx.skills.list(lookup)).map(skill => skill.name), ['dialogue'])
  assert.equal(await h.ctx.skills.get(foreign, lookup), undefined)
  assert.equal((await h.ctx.skills.get(foreign))?.provider, 'dsh-windows-acl')
  const chat = { mode: 'story', messages: [] }
  let approved
  const strategies = createForegroundOrchestrationStrategies({ nativePlay: {
    modeFor: async () => 'story', visibleTools: async () => approved,
    resolvePreset: async () => null, controlledToolNames: new Set(['submit_story', 'edit', USE_SKILL_TOOL, 'skill', 'tavern_read_skill_reference']),
    playPluginToolNames: async () => new Set(['declared_play_tool']),
    storyOutputToolCall: async () => true
  } })
  for (const name of ['submit_story', 'edit', 'read', 'future_host_tool', 'declared_play_tool', USE_SKILL_TOOL, 'tavern_read_skill_reference']) h.ctx.tools.register({ name, description: name,
    parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: value => value }, execute: async () => 'ok'
  })
  h.ctx.systemPrompt.section({ name: 'future:section', order: 0, text: 'FUTURE_HOST_SECTION' })
  h.ctx.systemPrompt.context({ name: 'future:required', order: 0, required: true, text: 'FUTURE_HOST_REQUIRED_CONTEXT' })
  h.ctx.on('agent/pre-step', async (_input, next) => {
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    return { ...decision, messages: [...decision.messages, {
      id: crypto.randomUUID(), role: 'user', source: { kind: 'future-host-notice' }, content: [{ type: 'text', text: 'FUTURE_HOST_INJECTED_CONTEXT' }]
    }, {
      id: crypto.randomUUID(), role: 'user', source: { kind: 'plugin:@deepseek-ai/dsh-tool-skill' },
      content: [{ type: 'text', text: '<available_skills>\n- `dialogue`: 旧说明\n- `' + foreign + '`: 不应出现在前台\n</available_skills>' }]
    }] }
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
    chatHeaderForSession: async (_id, fields) => fields[0] === 'mode' ? chat : undefined,
    playSkillsFor: async () => [writingSkill],
    sessionStore: h.ctx.sessions, agentRegistry: h.ctx.agents
  })
  for (const names of [['submit_story', USE_SKILL_TOOL], []]) {
    approved = names
    chat.disabledForegroundTools = names.length ? [] : ['declared_play_tool', 'skill']
    const input = names.length ? '/' + foreign + ' /dialogue 继续' : '继续'
    h.target.agent.followup({ id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: input }], source: { kind: 'user' } })
    await h.target.agent.whenIdle()
  }
  assert.deepEqual(errors, [])
  assert.equal(received.length, 2)
  assert.deepEqual(new Set((received[0].tools || []).map(tool => tool.name)), new Set(['submit_story', 'declared_play_tool', USE_SKILL_TOOL]))
  assert.deepEqual(received[1].tools || [], [])
  assert.match(JSON.stringify(received[0].messages), /submit_story/)
  assert.match(JSON.stringify(received[0].messages), /Call the `tavern_use_skill` tool/)
  assert.match(JSON.stringify(received[0].messages), /APPROVED_WRITING_BODY/)
  const skillEvents = h.target.session.snapshotEvents().filter(event => event.type === 'user/message').map(event => event.data.source)
  assert.deepEqual(skillEvents.filter(source => source.kind === 'skill-catalog').map(source => source.entries.map(entry => entry.name)), [['dialogue']])
  assert.ok(!skillEvents.some(source => source.kind === 'skill-invocation' && source.name === foreign))
  assert.doesNotMatch(JSON.stringify(received[1].messages), /skill-catalog|Call the `skill` tool/)
  for (const request of received) {
    assert.doesNotMatch(JSON.stringify(request.messages), /FUTURE_HOST/)
    assert.doesNotMatch(JSON.stringify(request.messages.filter(message => message.source?.kind !== 'user')), /diagnose-windows-sandbox-acl|UNAPPROVED_HOST_SKILL_BODY/)
    assert.match(JSON.stringify(request.messages), /继续/)
  }
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
