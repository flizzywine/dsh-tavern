import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { createUserPreferenceProfile } from '../tavern-plugin/lib/domain/user-preference-profile.js'
import { createPlayCardSnapshots } from '../tavern-plugin/lib/domain/play-card-snapshots.js'
import { createNativePlayOrchestrationStrategy } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'
import { registerUserProfileTools } from '../tavern-plugin/lib/tools/user-profile.js'
import { readSessionStablePrefix, ensureSessionStablePrefix } from '../tavern-plugin/lib/domain/session-stable-prefix.js'
import { ensureSessionVariableDirectory } from '../tavern-plugin/lib/domain/session-variable-directory.js'
import { resourceWorkspaceContext } from '../tavern-plugin/lib/domain/workspace-resources.js'

async function profiles() {
  let value
  const profile = createUserPreferenceProfile({ store: {
    readJson: async () => structuredClone(value),
    updateJson: async (_path, update) => { value = await update(structuredClone(value)); return structuredClone(value) }
  } })
  await profile.save({ content: '固定偏好：偏爱细腻的人物描写。' })
  await profile.setDefaultEnabled(true, 'default')
  const editing = await profile.manage({ action: 'create', name: '正在编辑的另一份偏好', content: '正在编辑的内容' })
  return { profile, editingId: editing.profileId }
}

test('读取、保存和确认工具使用管理目标，避免修改注入的默认偏好', async () => {
  const { profile, editingId } = await profiles()
  const tools = new Map()
  registerUserProfileTools({ tools: { register(tool) { tools.set(tool.name, tool) } }, userPreferenceProfile: profile,
    chatForSession: async () => ({ mode: 'card', userProfileId: 'default', userProfileManagementId: editingId }) })
  const execution = { agent: { session: { id: 'card' } } }
  const read = await tools.get('tavern_user_profile_read').execute({}, execution)
  assert.match(read.confirmedJson, /正在编辑的内容/)
  await tools.get('tavern_user_profile_save').execute({ content: '保存到管理条目' }, execution)
  assert.match((await profile.read(editingId)).confirmed.injectionText, /保存到管理条目/)
  const draft = await profile.saveDraft({ profileId: editingId, injectionText: '确认到管理条目' })
  await tools.get('tavern_user_profile_confirm').execute({ draftRevision: draft.draft.revision, confirmation: '确认保存用户画像' }, execution)
  assert.match((await profile.read(editingId)).confirmed.injectionText, /确认到管理条目/)
  assert.match((await profile.read('default')).confirmed.injectionText, /固定偏好/)
})

test('真实卡片 Agent 请求：建卡和偏好访谈沿用性格，工作区说明只提供回复语言默认值', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const { profile } = await profiles()
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { userPreferenceProfile: profile, assembleStablePrefix: false })
  t.after(() => h.dispose())
  const errors = []
  h.ctx.on('agent/error', ({ error }) => errors.push(error?.stack || String(error)))
  const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { SkillRegistry } = await import(new URL('../../dsh-skill/lib/index.js', bootUrl))
  const toolSkill = await import(new URL('../../dsh-tool-skill/lib/index.js', bootUrl))
  await h.ctx.plugin(SkillRegistry).await()
  h.ctx.provide('workingDirectory', { ensure: async () => process.cwd() })
  for (const [name, description] of [['create-card', '新建人物卡'], ['user-profile', '长期偏好访谈']]) {
    const content = await readFile(new URL('../presets/tavern/skills/' + name + '/SKILL.md', import.meta.url), 'utf8')
    h.ctx.skills.register({ name, description, content, source: 'runtime' })
  }
  await h.ctx.plugin(toolSkill).await()
  let chat = await h.open().start({ ...h.input, mode: 'card', cardPath: '' })
  let append = '附加指令第一版'
  const persona = '叫自己阿刺，称呼用户为主编。回复使用英文。'
  const snapshots = createPlayCardSnapshots({ userPreferenceProfile: profile, writeChat: async next => { chat = next; return next } })
  const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const implementation = source.slice(source.indexOf('  async function ensureNativeSystemPrefix('), source.indexOf('  async function ensureNativeCardWorkspace('))
  const ensurePrefix = vm.runInNewContext(`(${implementation.trim()})`, {
    readSessionStablePrefix, ensureSessionStablePrefix, ensureSessionVariableDirectory,
    ensurePlayCardSnapshot: snapshots.ensure, playCardSnapshots: snapshots, isScopedMessages: () => false, chatForSession: async () => chat,
    stablePrefixStorage: undefined, sessionStore: { flush: session => h.ctx.sessions.flush(session) }
  })
  const strategy = createNativePlayOrchestrationStrategy({ modeFor: async () => 'card', visibleTools: async () => [], controlledToolNames: new Set(),
    cardPersonaText: () => persona, workspaceContext: cwd => resourceWorkspaceContext(cwd || '/fixture-resources') })
  registerTurnLifecycleHooks({ ctx: h.ctx, hookChatForSession: async () => chat, ensureNativeSystemPrefix: ensurePrefix,
    backgroundAgentRunner: { owns: () => false }, clearRuntimePresetRequestState() {},
    userMessageForTurn: () => null, contentText: () => '', foregroundHandoff: { end() {}, awaitOpening: async () => {} },
    sessionStore: { flush: session => h.ctx.sessions.flush(session) }, foregroundStrategies: strategy, turnOrchestrator: { modeFor: async () => 'card' },
    publishResourceWorkspace: async () => ({}), runtimePrompt: () => append
  })
  for (const [value, input] of [
    ['附加指令第一版', '/create-card\n\n我想新建一张人物卡。'],
    ['附加指令第二版', '/user-profile\n\n请帮我梳理长期游玩与写作偏好。'],
    ['', '继续']
  ]) {
    append = value
    h.target.agent.followup({ id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: input }], source: { kind: 'user' } })
    await h.target.agent.whenIdle()
    await profile.save({ profileId: 'default', content: '不应自动替换的偏好' })
  }
  assert.deepEqual(errors, [])
  assert.equal(h.requests.length, 3)
  const skill = h.requests[0].messages.find(message => message.source?.kind === 'skill-invocation' && message.source.name === 'create-card')
  assert.ok(skill, '宿主展开了 /create-card')
  assert.match(skill.content[0].text, /用当前工作台性格的口吻提问并撰写选项说明/)
  assert.match(skill.content[0].text, /桌宠按此格式生成按钮/)
  const interview = h.requests[1].messages.find(message => message.source?.kind === 'skill-invocation' && message.source.name === 'user-profile')
  assert.ok(interview, '宿主展开了 /user-profile')
  assert.match(interview.content[0].text, /沿用工作台性格的称呼和口吻/)
  assert.match(interview.content[0].text, /用户明确表示可以保存/)
  for (const [index, request] of h.requests.entries()) {
    assert.equal(request.system.split('固定偏好').length - 1, 1)
    assert.match(request.system, /回复语言优先遵循用户明确要求，其次沿用以下性格的语言约定。/)
    assert.ok(request.system.includes(persona + '\n</card_agent_persona>'))
    assert.match(request.system, /If neither the user nor the workbench persona specifies a reply language/)
    assert.doesNotMatch(request.system, /不应自动替换|不可丢失的固定背景/)
    assert.ok(request.messages.filter(m => m.role !== 'system').every(m => !JSON.stringify(m.content).includes('固定偏好')))
    if (index < 2) assert.ok(request.system.startsWith(index ? '<system_append>\n附加指令第二版\n</system_append>\n\n' : '<system_append>\n附加指令第一版\n</system_append>\n\n'))
    else assert.doesNotMatch(request.system, /附加指令/)
  }
})

test('旧版改卡会话沿用原前缀并追加当前工作台性格，空白性格不追加', async () => {
  const fixed = [
    { name: 'tavern:character-card', text: '固定卡片设定' },
    { name: 'tavern:card-system-prompt', text: '人物卡的写作指令' }
  ]
  let persona = '用阿刺的口吻交流。'
  const strategy = createNativePlayOrchestrationStrategy({
    modeFor: async () => 'card', visibleTools: async () => [], controlledToolNames: new Set(),
    cardPersonaText: () => persona
  })
  const assemble = () => strategy.assembleSystemPrompt({}, {
    sessionId: 'legacy-card',
    chat: { mode: 'card', cardEditContext: { version: 1 } },
    fixedSystemSections: fixed
  })
  const { sections } = await assemble()
  assert.deepEqual(sections.slice(0, -1), fixed)
  assert.equal(sections.at(-1).name, 'tavern:card-system')
  assert.match(sections.at(-1).text, /用阿刺的口吻交流/)

  persona = ''
  assert.deepEqual((await assemble()).sections, fixed)
})
