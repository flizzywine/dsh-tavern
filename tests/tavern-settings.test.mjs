import assert from 'node:assert/strict'
import { readFile } from "node:fs/promises"

import test from 'node:test'

import { applyTavernSettingsPatch, presentTavernSettings } from '../tavern-plugin/lib/domain/tavern-settings.js'
import { createTavernSettingsRuntime } from '../tavern-plugin/lib/domain/tavern-settings-runtime.js'
import { createSettingsHandlers } from '../tavern-plugin/lib/rpc/settings.js'
import { createConversationInitialization } from '../tavern-plugin/lib/domain/conversation-initialization.js'

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




test('本局默认模板保存、恢复与新局继承覆盖全部本局设置字段', async () => {
  let settingsDoc = {
    storyGenerationMode: 'plugin-tool-call',
    storyGenerationProvider: 'global:body',
    storyPluginOutputRegex: false,
    defaultBodyGeneration: { mode: 'plugin-direct', provider: 'legacy:body', hostRegex: true }
  }
  assert.equal(presentTavernSettings(settingsDoc, {}).defaultPlaySettings.backgroundTasks.styleReference, false)
  const optedIn = applyTavernSettingsPatch(settingsDoc, { defaultPlaySettings: { backgroundTasks: { styleReference: true } } })
  assert.equal(presentTavernSettings(optedIn, {}).defaultPlaySettings.backgroundTasks.styleReference, true)
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
      backgroundTasks: { variables: true, posture: false, styleReference: false, foregroundCandidates: true, preset: true },
      candidateTabs: false,
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

  const llm = { resolveCallConfig: async cfg => cfg }
  const { readTavernSettings, updateTavernSettings } = await createTavernSettingsRuntime({ llm, profileData: {
    readJson: async () => structuredClone(settingsDoc),
    async updateJson(_path, update) {
      settingsDoc = await update(structuredClone(settingsDoc))
      return structuredClone(settingsDoc)
    }
  } })
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
    llm,
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
  assert.equal(savedSettings.defaultPlaySettings.backgroundTasks.preset, true)
  assert.equal(savedSettings.defaultPlaySettings.candidateTabs, false)
  assert.equal(savedSettings.defaultPlaySettings.webSearchEnabled, true)
  assert.deepEqual(savedSettings.defaultBackgroundModel, { provider: 'reapi', model: 'deepseek/deepseek-v4.1', reasoningEffort: 'high' })
  assert.deepEqual(savedSettings.defaultDisabledForegroundTools, ['web_fetch', 'tavern_recall_history'])
  assert.deepEqual(savedSettings.defaultDisabledWritingSkills, ['slow-burn'])
  assert.equal(savedSettings.defaultBodyGeneration, undefined)
  assert.equal(savedSettings.storyGenerationMode, 'plugin-tool-call')
  assert.equal(savedSettings.storyGenerationProvider, 'global:body')
  assert.equal(savedSettings.storyPluginOutputRegex, false)
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
  assert.equal(restored.backgroundTasks.preset, true)
  assert.equal(restored.candidateTabs, false)
  assert.equal(restored.webSearchEnabled, true)
  assert.equal(restored.storyGenerationMode, undefined)
  assert.equal(restored.storyGenerationProvider, undefined)
  assert.equal(restored.storyPluginOutputRegex, undefined)
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
  assert.equal(publishedChat.backgroundTasks.preset, true)
  assert.equal(publishedChat.candidateTabs, false)
  assert.equal(publishedChat.webSearchEnabled, true)
  assert.deepEqual(publishedChat.disabledForegroundTools, ['web_fetch', 'tavern_recall_history'])
  assert.deepEqual(publishedChat.disabledWritingSkills, ['slow-burn'])
  assert.equal(publishedChat.storyGenerationMode, undefined)
  assert.equal(publishedChat.storyGenerationProvider, undefined)
  assert.equal(publishedChat.storyPluginOutputRegex, undefined)
  assert.deepEqual(seededPlugins['chat-new'], { 'global.mod': { tone: 'warm', dice: true } })
})
