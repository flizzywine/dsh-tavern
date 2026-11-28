import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

import { createInitializationNative } from './fixtures/conversation-initialization-native.mjs'
import { createUserPreferenceProfile } from '../tavern-plugin/lib/domain/user-preference-profile.js'
import { createPlayCardSnapshots } from '../tavern-plugin/lib/domain/play-card-snapshots.js'
import { createNativePlayOrchestrationStrategy, projectRetiredPreferenceHistory } from '../tavern-plugin/lib/domain/foreground-orchestration-strategies.js'
import { registerTurnLifecycleHooks } from '../tavern-plugin/lib/hooks/turn-lifecycle.js'
import { readSessionStablePrefix, ensureSessionStablePrefix, sessionStablePrefixSections, withoutLongTermPreference } from '../tavern-plugin/lib/domain/session-stable-prefix.js'
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
  return profile
}

test('归档的 Skill 和工具交换从模型历史中排除，普通内容仍保留', () => {
  const history = [
    { role: 'user', source: { kind: 'skill-invocation', name: 'tavern-user-profile' }, content: [{ type: 'text', text: '访谈指令' }] },
    { role: 'assistant', source: { replayState: { old: true } }, content: [
      { type: 'tool-call', id: 'preference', name: 'tavern_user_profile_read' },
      { type: 'tool-call', id: 'old-skill', name: 'skill', arguments: '{"name":"user-profile"}' },
      { type: 'tool-call', id: 'card', name: 'tavern_read_card' },
    ] },
    { role: 'tool', toolCallId: 'preference', content: [{ type: 'text', text: '旧偏好正文' }] },
    { role: 'tool', toolCallId: 'old-skill', content: [{ type: 'text', text: '旧访谈指令' }] },
    { role: 'tool', toolCallId: 'card', content: [{ type: 'text', text: '人物卡正文' }] },
    { role: 'system', source: { kind: 'dsh-user-profile' }, content: [{ type: 'text', text: '早期存档偏好' }] },
  ]
  assert.deepEqual(projectRetiredPreferenceHistory(history), [
    { ...history[1], source: {}, content: [history[1].content[2]] }, history[4],
  ])
  assert.match(JSON.stringify(history), /旧偏好正文/)
})

test('真实卡片 Agent 请求沿用性格和建卡 Skill，忽略已保存的偏好', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const profile = await profiles()
  const h = await createInitializationNative(process.env.DSH_BOOT_MODULE, { userPreferenceProfile: profile, assembleStablePrefix: false })
  t.after(() => h.dispose())
  const errors = []
  h.ctx.on('agent/error', ({ error }) => errors.push(error?.stack || String(error)))
  const bootUrl = pathToFileURL(process.env.DSH_BOOT_MODULE)
  const { SkillRegistry } = await import(new URL('../../dsh-skill/lib/index.js', bootUrl))
  const toolSkill = await import(new URL('../../dsh-tool-skill/lib/index.js', bootUrl))
  await h.ctx.plugin(SkillRegistry).await()
  h.ctx.provide('workingDirectory', { ensure: async () => process.cwd() })
  const content = await readFile(new URL('../presets/tavern/skills/create-card/SKILL.md', import.meta.url), 'utf8')
  h.ctx.skills.register({ name: 'create-card', description: '新建人物卡', content, source: 'runtime' })
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
    ['附加指令第二版', '继续整理人物设定'],
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
    assert.doesNotMatch(request.system, /固定偏好/)
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
    fixedSystemSections: [{ name: 'tavern:user-preference', text: '存档偏好' }, ...fixed]
  })
  const { sections } = await assemble()
  assert.deepEqual(sections.slice(0, -1), fixed)
  assert.equal(sections.at(-1).name, 'tavern:card-system')
  assert.match(sections.at(-1).text, /用阿刺的口吻交流/)

  persona = ''
  assert.deepEqual((await assemble()).sections, fixed)
})

test('游玩和后台共用的固定背景排除旧偏好区段，保留存档文本和人物卡', async () => {
  const card = '<character_card>\n角色资料\n</character_card>'
  const xml = '<user_preferences>\n存档偏好正文\n</user_preferences>\n\n' + card
  const legacy = '【用户已确认的长期偏好】\r\n存档偏好正文\r\n\r\n【故事设定 · 人物卡】\r\n角色资料'
  assert.equal(withoutLongTermPreference(xml), card)
  assert.equal(withoutLongTermPreference(legacy), '【故事设定 · 人物卡】\n角色资料')
  assert.deepEqual(sessionStablePrefixSections(null, xml), [{ name: 'tavern:character-card', text: card }])
  const chat = { id: 'old', mode: 'story', cardContextSnapshotVersion: 7, cardContextSnapshot: xml, userProfileContextSnapshot: '存档偏好正文' }
  const snapshots = createPlayCardSnapshots({ writeChat: async () => assert.fail('读取存档时不应写入') })
  assert.equal(snapshots.settled(chat), card)
  assert.equal(await snapshots.ensure(chat), card)
  assert.equal(chat.cardContextSnapshot, xml)
  assert.equal(chat.userProfileContextSnapshot, '存档偏好正文')
})
