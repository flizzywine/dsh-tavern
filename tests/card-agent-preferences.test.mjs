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

test('真实卡片 Agent 请求：建卡 Skill 与工作台性格同时送达，偏好和附加指令各自生效', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
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
  const skillText = await readFile(new URL('../presets/tavern/skills/create-card/SKILL.md', import.meta.url), 'utf8')
  h.ctx.skills.register({ name: 'create-card', description: '新建人物卡', content: skillText, source: 'runtime' })
  await h.ctx.plugin(toolSkill).await()
  let chat = await h.open().start({ ...h.input, mode: 'card', cardPath: '' })
  let append = '附加指令第一版'
  const persona = '叫自己阿刺，称呼用户为主编。'
  const snapshots = createPlayCardSnapshots({ userPreferenceProfile: profile, writeChat: async next => { chat = next; return next } })
  const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const implementation = source.slice(source.indexOf('  async function ensureNativeSystemPrefix('), source.indexOf('  async function ensureNativeCardWorkspace('))
  const ensurePrefix = vm.runInNewContext(`(${implementation.trim()})`, {
    readSessionStablePrefix, ensureSessionStablePrefix, ensureSessionVariableDirectory,
    ensurePlayCardSnapshot: snapshots.ensure, playCardSnapshots: snapshots, isScopedMessages: () => false, chatForSession: async () => chat,
    stablePrefixStorage: undefined, sessionStore: { flush: session => h.ctx.sessions.flush(session) }
  })
  const strategy = createNativePlayOrchestrationStrategy({ modeFor: async () => 'card', visibleTools: async () => [], controlledToolNames: new Set(),
    cardPersonaText: () => persona, workspaceContext: () => '卡片资源工作区' })
  registerTurnLifecycleHooks({ ctx: h.ctx, hookChatForSession: async () => chat, ensureNativeSystemPrefix: ensurePrefix,
    backgroundAgentRunner: { owns: () => false }, clearRuntimePresetRequestState() {},
    userMessageForTurn: () => null, contentText: () => '', foregroundHandoff: { end() {}, awaitOpening: async () => {} },
    sessionStore: { flush: session => h.ctx.sessions.flush(session) }, foregroundStrategies: strategy, turnOrchestrator: { modeFor: async () => 'card' },
    publishResourceWorkspace: async () => ({}), runtimePrompt: () => append
  })
  for (const [value, input] of [
    ['附加指令第一版', '/create-card\n\n我想新建一张人物卡。'],
    ['附加指令第二版', '继续制作人物卡'],
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
  for (const [index, request] of h.requests.entries()) {
    assert.equal(request.system.split('固定偏好').length - 1, 1)
    assert.match(request.system, /<card_agent_persona>\n[^\n]+始终沿用以下身份、称呼和语气。\n\n叫自己阿刺，称呼用户为主编。\n<\/card_agent_persona>/)
    assert.match(request.system, /卡片资源工作区/)
    assert.doesNotMatch(request.system, /不应自动替换|不可丢失的固定背景/)
    assert.ok(request.messages.filter(m => m.role !== 'system').every(m => !JSON.stringify(m.content).includes('固定偏好')))
    if (index < 2) assert.ok(request.system.startsWith(index ? '<system_append>\n附加指令第二版\n</system_append>\n\n' : '<system_append>\n附加指令第一版\n</system_append>\n\n'))
    else assert.doesNotMatch(request.system, /附加指令/)
  }
})
