import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

test('真实卡片 Agent 请求：偏好仅在 system，附加指令置顶且修改和清空立即生效', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const { profile } = await profiles()
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { userPreferenceProfile: profile, assembleStablePrefix: false })
  t.after(() => h.dispose())
  let chat = await h.open().start({ ...h.input, mode: 'card', cardPath: '' })
  let append = '附加指令第一版'
  const snapshots = createPlayCardSnapshots({ userPreferenceProfile: profile, writeChat: async next => { chat = next; return next } })
  const source = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')
  const implementation = source.slice(source.indexOf('  async function ensureNativeSystemPrefix('), source.indexOf('  async function ensureNativeCardWorkspace('))
  const ensurePrefix = vm.runInNewContext(`(${implementation.trim()})`, {
    readSessionStablePrefix, ensureSessionStablePrefix, ensureSessionVariableDirectory,
    ensurePlayCardSnapshot: snapshots.ensure, playCardSnapshots: snapshots, isScopedMessages: () => false, chatForSession: async () => chat,
    stablePrefixStorage: undefined, sessionStore: { flush: session => h.ctx.sessions.flush(session) }
  })
  const strategy = createNativePlayOrchestrationStrategy({ modeFor: async () => 'card', visibleTools: async () => [], controlledToolNames: new Set(),
    cardSystemPrompt: () => '卡片 Agent 职责', workspaceContext: () => '卡片资源工作区' })
  registerTurnLifecycleHooks({ ctx: h.ctx, hookChatForSession: async () => chat, ensureNativeSystemPrefix: ensurePrefix,
    backgroundAgentRunner: { owns: () => false }, clearRuntimePresetRequestState() {},
    userMessageForTurn: () => null, contentText: () => '', foregroundHandoff: { end() {} },
    sessionStore: { flush: session => h.ctx.sessions.flush(session) }, foregroundStrategies: strategy, turnOrchestrator: { modeFor: async () => 'card' },
    publishResourceWorkspace: async () => ({}), runtimePrompt: () => append
  })
  for (const value of ['附加指令第一版', '附加指令第二版', '']) {
    append = value
    h.target.agent.followup({ id: crypto.randomUUID(), role: 'user', content: [{ type: 'text', text: '继续制作人物卡' }], source: { kind: 'human' } })
    await h.target.agent.whenIdle()
    await profile.save({ profileId: 'default', content: '不应自动替换的偏好' })
  }
  assert.equal(h.requests.length, 3)
  for (const [index, request] of h.requests.entries()) {
    assert.equal(request.system.split('固定偏好').length - 1, 1)
    assert.match(request.system, /卡片 Agent 职责/)
    assert.match(request.system, /卡片资源工作区/)
    assert.doesNotMatch(request.system, /不应自动替换|不可丢失的固定背景/)
    assert.ok(request.messages.filter(m => m.role !== 'system').every(m => !JSON.stringify(m.content).includes('固定偏好')))
    if (index < 2) assert.ok(request.system.startsWith(index ? '附加指令第二版\n\n' : '附加指令第一版\n\n'))
    else assert.doesNotMatch(request.system, /附加指令/)
  }
})
