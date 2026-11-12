import assert from 'node:assert/strict'
import { readFile } from "node:fs/promises"

import test from 'node:test'

import { applyTavernSettingsPatch, normalizePlayDefaults, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'
import { createConversationInitialization } from '../tavern-plugin/lib/domain/conversation-initialization.js'

const serverSource = await readFile(new URL('../tavern-plugin/lib/index.js', import.meta.url), 'utf8')

test('用户推进字数随配置保存和读回，旧配置默认 500 且拒绝非法值', () => {
  assert.equal(presentTavernSettings({}, {}).scriptChunkSize, 500)
  const saved = applyTavernSettingsPatch({ other: 'keep' }, { scriptChunkSize: 1200 })
  assert.equal(presentTavernSettings(JSON.parse(JSON.stringify(saved)), {}).scriptChunkSize, 1200)
  assert.equal(saved.other, 'keep')
  assert.equal(applyTavernSettingsPatch(saved, { hideContextAndReasoning: false }).scriptChunkSize, 1200)
  for (const scriptChunkSize of [99, 10001, 1200.5, '1200', null]) {
    assert.throws(() => applyTavernSettingsPatch(saved, { scriptChunkSize }), /100–10000/)
    assert.equal(presentTavernSettings({ scriptChunkSize }, {}).scriptChunkSize, 500)
  }
})

// Exercise the real save/read call sites with durable storage, not a copied implementation.

const settingsModuleSource = await readFile(new URL('../tavern-plugin/src/client/modules/global-settings.js', import.meta.url), 'utf8')

test('全局写作 Skill 逐项保存，恢复开启不改动其他 Skill', () => {
  let document = applyTavernSettingsPatch({}, { defaultWritingSkill: { name: 'one', enabled: false } })
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'two', enabled: false } })
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: false } })
  assert.deepEqual(presentTavernSettings(document, {}).defaultDisabledWritingSkills, ['one', 'two'])
  document = applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: true } })
  assert.deepEqual(document.defaultDisabledWritingSkills, ['two'])
  assert.throws(() => applyTavernSettingsPatch(document, { defaultWritingSkill: { name: 'one', enabled: 'false' } }), /无效/)
})

test('系统提示词方案：切换时保存当前内容，生效内容始终在顶层字段', () => {
  let document = applyTavernSettingsPatch({ promptOverrides: { story: 'A' }, systemAppendEnabled: false }, { promptSet: { action: 'create', name: '快节奏' } })
  assert.equal(document.promptOverrides, undefined)
  assert.equal(document.systemAppendEnabled, true)
  document = applyTavernSettingsPatch(document, { systemPrompt: { name: 'story', text: 'B' } })
  const fast = document.activePromptSetId
  document = applyTavernSettingsPatch(document, { promptSet: { action: 'select', id: 'default' } })
  assert.deepEqual(document.promptOverrides, { story: 'A' })
  assert.equal(document.systemAppendEnabled, false)
  assert.equal(presentTavernSettings(document, { story: 'def' }).systemPrompts[0].text, 'A')
  document = applyTavernSettingsPatch(document, { promptSet: { action: 'select', id: fast } })
  assert.deepEqual(document.promptOverrides, { story: 'B' })
  assert.deepEqual(presentTavernSettings(document, {}).promptSets.sets.map(set => [set.name, set.active]), [['默认方案', false], ['快节奏', true]])
})

test('改一边不会带上另一边；第一次改动就把旧字段折成明确的两项', () => {
  const fromMerged = applyTavernSettingsPatch({ storyToolCall: true }, { storyOutputToolCall: false })
  assert.deepEqual(fromMerged, { storyInputToolCall: true, storyOutputToolCall: false })
  assert.equal(presentTavernSettings(fromMerged, {}).storyInputToolCall, true)

  const fromHistory = applyTavernSettingsPatch({ storyHistoryToolCall: true }, { storyOutputToolCall: true })
  assert.deepEqual(fromHistory, { storyInputToolCall: true, storyOutputToolCall: true })

  const off = applyTavernSettingsPatch({ storyInputToolCall: true, storyOutputToolCall: true }, { storyInputToolCall: false })
  assert.deepEqual(off, { storyInputToolCall: false, storyOutputToolCall: true })

  const onlyInput = applyTavernSettingsPatch({}, { storyInputToolCall: true })
  assert.deepEqual(onlyInput, { storyInputToolCall: true, storyOutputToolCall: false })
  assert.throws(() => applyTavernSettingsPatch({}, { storyInputToolCall: 'yes' }), /输入走工具调用设置必须是布尔值/)
  assert.throws(() => applyTavernSettingsPatch({}, { storyOutputToolCall: 1 }), /输出走工具调用设置必须是布尔值/)
})

test('新游戏统一主动检索，旧默认值归一化且严格校验', () => {
  assert.equal(normalizePlayDefaults({}).worldbookStrategy, 'native-skills')
  const saved = applyTavernSettingsPatch({}, { defaultPlaySettings: { worldbookStrategy: 'legacy' } })
  assert.equal(presentTavernSettings(saved, {}).defaultPlaySettings.worldbookStrategy, 'native-skills')
  const updated = applyTavernSettingsPatch(saved, { defaultPlaySettings: { playerName: '旅人' } })
  assert.equal(updated.defaultPlaySettings.worldbookStrategy, 'native-skills')
  assert.throws(() => applyTavernSettingsPatch({}, { defaultPlaySettings: { worldbookStrategy: 'unknown' } }), /默认世界书策略无效/)
})




test('正文生成方式默认原生，插件模式必须指定生成器且完整往返保存', () => {
  assert.equal(presentTavernSettings({}, {}).storyGenerationMode, 'host')
  assert.throws(() => applyTavernSettingsPatch({}, { storyGenerationMode: 'plugin-tool-call' }), /先选择/)
  assert.throws(() => applyTavernSettingsPatch({}, { storyGenerationMode: 'invalid' }), /无效/)
  let value = applyTavernSettingsPatch({}, { storyGenerationProvider: 'p:body', storyGenerationMode: 'plugin-tool-call' })
  value = presentTavernSettings(value, {})
  assert.equal(value.storyGenerationProvider, 'p:body')
  assert.equal(value.storyGenerationMode, 'plugin-tool-call')
  assert.equal(applyTavernSettingsPatch(value, { storyGenerationMode: 'host' }).storyGenerationProvider, 'p:body')
})

test('本局默认模板保存、恢复与新局继承覆盖全部本局设置字段', async () => {
  let settingsDoc = {}
  let activePresetPath = ''
  let defaultProfileId = ''
  let pluginResetCalls = []
  let skillsInvalidated = 0
  const presets = new Map([
    ['presets/reborn.json', { path: 'presets/reborn.json', title: 'Reborn2.4.2', valid: true, recognized: true }]
  ])
  const chatsBySession = new Map([
    ['s1', {
      id: 'c1',
      sessionId: 's1',
      mode: 'story',
      cardPath: 'cards/a.json',
      cardName: '角色A',
      macroState: { userName: '旅人', local: {}, global: {} },
      runtimePresetSnapshot: { presetPath: 'presets/reborn.json', presetName: 'Reborn2.4.2', regexScripts: [] },
      runtimePresetPath: 'presets/reborn.json',
      userProfileEnabled: true,
      userProfileId: 'p1',
      userProfileRevision: 2,
      userProfileContextSnapshot: '[偏好正文]',
      cardContextSnapshot: '[偏好正文]\n\n[人物卡正文]',
      cardContextRevision: 1,
      backgroundModelSelection: { provider: 'reapi', model: 'deepseek/deepseek-v4.1', reasoningEffort: 'high' },
      backgroundTasks: { variables: true, posture: false, styleReference: false, foregroundCandidates: true },
      webSearchEnabled: true,
      storyGenerationMode: 'plugin-direct',
      storyGenerationProvider: 'gen:one',
      storyPluginOutputRegex: true,
      disabledForegroundTools: ['web_fetch', 'tavern_recall_history'],
      disabledWritingSkills: ['slow-burn'],
      messages: [{ role: 'assistant', greeting: true, text: '你好' }]
    }],
    ['s2', {
      id: 'c2',
      sessionId: 's2',
      mode: 'story',
      cardPath: 'cards/a.json',
      cardName: '角色A',
      macroState: { userName: '你', local: {}, global: {} },
      runtimePresetSnapshot: null,
      runtimePresetPath: '',
      userProfileEnabled: false,
      userProfileId: 'default',
      userProfileRevision: 0,
      userProfileContextSnapshot: '',
      cardContextSnapshot: '[人物卡正文]',
      cardContextRevision: 1,
      backgroundModelSelection: null,
      backgroundTasks: { variables: true, posture: true, styleReference: true },
      webSearchEnabled: false,
      disabledForegroundTools: [],
      disabledWritingSkills: [],
      messages: [{ role: 'assistant', greeting: true, text: '你好' }]
    }]
  ])

  const readTavernSettings = async () => presentTavernSettings(settingsDoc, {})
  const updateTavernSettings = async patch => {
    settingsDoc = applyTavernSettingsPatch(settingsDoc, patch)
    return presentTavernSettings(settingsDoc, {})
  }
  const handlers = createSettingsHandlers({
    str: v => v == null ? '' : String(v),
    groupOfMode: mode => mode === 'card' ? 'card' : 'play',
    chatForSession: async sid => chatsBySession.get(sid),
    chatHeaderForSession: async sid => chatsBySession.get(sid),
    updateChat: async (chatId, updater) => {
      for (const [sid, chat] of chatsBySession.entries()) {
        if (chat.id === chatId) {
          const next = updater({ ...chat })
          chatsBySession.set(sid, next)
          return next
        }
      }
      throw new Error('missing chat')
    },
    setPlayerName: async (sid, userName) => {
      const chat = chatsBySession.get(sid)
      const name = String(userName || '').trim() || '你'
      chat.macroState = { ...chat.macroState, userName: name }
      return name
    },
    readTavernSettings,
    updateTavernSettings,
    llm: { resolveCallConfig: async cfg => cfg },
    sessionActivity: async () => ({ busy: false }),
    agentRegistry: { get: () => ({ phase: { kind: 'idle' } }) },
    presetLibrary: {
      read: async p => presets.get(p),
      select: async p => { activePresetPath = p; return { activePresetPath } },
      catalog: async () => ({ presets: [...presets.values()], activePresetPath })
    },
    runtimePresets: {
      fullSnapshot: async p => {
        if (!presets.has(p)) throw new Error('missing preset')
        return { presetPath: p, presetName: presets.get(p).title, regexScripts: [] }
      }
    },
    userPreferenceProfile: {
      read: async () => ({
        profileId: defaultProfileId || 'default',
        defaultEnabled: Boolean(defaultProfileId),
        defaultProfileId,
        profiles: [{ id: 'p1', name: '偏好一', hasConfirmed: true, confirmedRevision: 2 }]
      }),
      manage: async ({ action, profileId }) => {
        if (action === 'default') defaultProfileId = profileId
        return {}
      },
      stableContext: async id => id === 'p1' ? { profileId: 'p1', revision: 2, text: '[偏好正文]' } : null
    },
    playCardSnapshots: {
      ensure: async () => {},
      preferenceReplacement: async (chat, enabled, profileId) => ({
        userProfileEnabled: enabled,
        userProfileId: enabled ? profileId : 'default',
        userProfileRevision: enabled ? 2 : 0,
        userProfileContextSnapshot: enabled ? '[偏好正文]' : '',
        cardContextSnapshot: enabled ? '[偏好正文]\n\n[人物卡正文]' : '[人物卡正文]',
        cardContextRevision: (chat.cardContextRevision || 0) + 1
      })
    },
    pluginApi: {
      bodyGenerators: { require: async provider => { if (provider !== 'gen:one') throw new Error('no provider') } },
      gamePlugins: async () => ({
        settings: [
          { plugin: 'global.mod', card: false, values: { tone: 'warm', dice: true } },
          { plugin: 'card.only', card: true, values: { secret: 1 } }
        ]
      }),
      resetGamePluginSettings: async (sid, defaults) => { pluginResetCalls.push({ sid, defaults }) }
    },
    invalidateTavernSkills: () => { skillsInvalidated += 1 }
  })

  const saveRes = await handlers.saveConversationSettingsAsDefaultTemplate({ sessionId: 's1' })
  assert.equal(saveRes.saved, true)
  assert.deepEqual(saveRes.warnings, [])
  assert.equal(activePresetPath, 'presets/reborn.json')
  assert.equal(defaultProfileId, 'p1')
  const savedSettings = await readTavernSettings()
  assert.equal(savedSettings.defaultPlaySettings.playerName, '旅人')
  assert.equal(savedSettings.defaultPlaySettings.backgroundTasks.posture, false)
  assert.equal(savedSettings.defaultPlaySettings.backgroundTasks.styleReference, false)
  assert.equal(savedSettings.defaultPlaySettings.backgroundTasks.foregroundCandidates, true)
  assert.equal(savedSettings.defaultPlaySettings.webSearchEnabled, true)
  assert.deepEqual(savedSettings.defaultBackgroundModel, { provider: 'reapi', model: 'deepseek/deepseek-v4.1', reasoningEffort: 'high' })
  assert.deepEqual(savedSettings.defaultDisabledForegroundTools, ['web_fetch', 'tavern_recall_history'])
  assert.deepEqual(savedSettings.defaultDisabledWritingSkills, ['slow-burn'])
  assert.deepEqual(savedSettings.defaultBodyGeneration, { mode: 'plugin-direct', provider: 'gen:one', hostRegex: true })
  assert.deepEqual(savedSettings.defaultPluginGameSettings, { 'global.mod': { tone: 'warm', dice: true } })

  const restoreRes = await handlers.restoreConversationSettingsFromDefaultTemplate({ sessionId: 's2' })
  assert.equal(restoreRes.restored, true)
  assert.deepEqual(restoreRes.warnings, [])
  const restored = chatsBySession.get('s2')
  assert.equal(restored.macroState.userName, '旅人')
  assert.equal(restored.runtimePresetPath, 'presets/reborn.json')
  assert.equal(restored.userProfileEnabled, true)
  assert.equal(restored.userProfileId, 'p1')
  assert.deepEqual(restored.backgroundModelSelection, { provider: 'reapi', model: 'deepseek/deepseek-v4.1', reasoningEffort: 'high' })
  assert.equal(restored.backgroundTasks.posture, false)
  assert.equal(restored.backgroundTasks.styleReference, false)
  assert.equal(restored.backgroundTasks.foregroundCandidates, true)
  assert.equal(restored.webSearchEnabled, true)
  assert.equal(restored.storyGenerationMode, 'plugin-direct')
  assert.equal(restored.storyGenerationProvider, 'gen:one')
  assert.equal(restored.storyPluginOutputRegex, true)
  assert.deepEqual(restored.disabledForegroundTools, ['web_fetch', 'tavern_recall_history'])
  assert.deepEqual(restored.disabledWritingSkills, ['slow-burn'])
  assert.equal(skillsInvalidated, 1)
  assert.deepEqual(pluginResetCalls, [{ sid: 's2', defaults: { 'global.mod': { tone: 'warm', dice: true } } }])

  // Verify new game initialization inherits all saved default template fields
  const seededPlugins = {}
  let publishedChat = null
  const init = createConversationInitialization({
    id: prefix => prefix + '-new',
    timeline: { apply: ({ chat }) => ({ chat }) },
    cards: {
      read: async () => ({ path: 'cards/a.json', name: '角色A', first_mes: '开场' }),
      extensions: async () => ({}),
      script: async () => undefined
    },
    chats: { resolve: async () => undefined, publish: async chat => { publishedChat = chat } },
    snapshots: { prepare: async () => {} },
    pluginDataStore: {
      updateSettings: async (chatId, fn) => {
        const s = { values: {} }
        fn(s)
        seededPlugins[chatId] = s.values
      }
    },
    presets: { fullSnapshot: async () => ({ presetPath: activePresetPath, presetName: 'Reborn2.4.2', regexScripts: [] }) },
    settings: readTavernSettings,
    emptyCardWorkspace: () => ({}),
    present: async chat => chat
  })
  await init.start({ cardPath: 'cards/a.json', mode: 'story' })
  assert.equal(publishedChat.macroState.userName, '旅人')
  assert.equal(publishedChat.runtimePresetPath, 'presets/reborn.json')
  assert.deepEqual(publishedChat.backgroundModelSelection, { provider: 'reapi', model: 'deepseek/deepseek-v4.1', reasoningEffort: 'high' })
  assert.equal(publishedChat.backgroundTasks.posture, false)
  assert.equal(publishedChat.backgroundTasks.styleReference, false)
  assert.equal(publishedChat.backgroundTasks.foregroundCandidates, true)
  assert.equal(publishedChat.webSearchEnabled, true)
  assert.deepEqual(publishedChat.disabledForegroundTools, ['web_fetch', 'tavern_recall_history'])
  assert.deepEqual(publishedChat.disabledWritingSkills, ['slow-burn'])
  assert.equal(publishedChat.storyGenerationMode, 'plugin-direct')
  assert.equal(publishedChat.storyGenerationProvider, 'gen:one')
  assert.equal(publishedChat.storyPluginOutputRegex, true)
  assert.deepEqual(seededPlugins['chat-new'], { 'global.mod': { tone: 'warm', dice: true } })
})
