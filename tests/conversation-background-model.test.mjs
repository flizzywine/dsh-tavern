import { createConversationBackgroundSettings } from '../tavern-plugin/lib/domain/conversation-background-settings.js'
import { projectChatBackgroundConfig } from '../tavern-plugin/lib/domain/chat-session-state.js'
import assert from 'node:assert/strict'
import test from 'node:test'

test('本局模型保存保留并发更新的剧情，只修改所选游戏，允许恢复跟随前台', async () => {
  const chats = new Map([['one', { id: 'one', mode: 'story', messages: ['old'] }], ['two', { id: 'two', mode: 'story' }]])
  const settings = createConversationBackgroundSettings({
    readChat: async id => structuredClone(chats.get(id)),
    readConfig: async id => chats.get(id), isPlayMode: mode => mode === 'story',
    modelReasoning: async () => ({ efforts: [{ id: 'high' }] }),
    modelCatalog: async () => [{ provider: 'test', models: [{ id: 'new' }] }],
    updateChat: async (id, mutation) => {
      const current = { ...chats.get(id), messages: ['old', 'concurrent update'] }
      const saved = mutation(current); chats.set(id, saved); return saved
    }
  })
  const call = backgroundModel => settings.save({ sessionId: 'one', backgroundModel })
  await call({ provider: 'test', model: 'new', reasoningEffort: 'high' })
  assert.deepEqual(chats.get('one').backgroundModelSelection, { provider: 'test', model: 'new', reasoningEffort: 'high' })
  assert.deepEqual(chats.get('one').messages, ['old', 'concurrent update'])
  assert.equal(chats.get('two').backgroundModelSelection, undefined)
  assert.equal(chats.get('one').backgroundConfigVersion, 1)
  await assert.rejects(call({ provider: 'test', model: 'new', reasoningEffort: 'invalid' }), /推理强度不可用/)
  assert.equal(chats.get('one').backgroundModelSelection.reasoningEffort, 'high')
  await call(null)
  assert.equal(chats.get('one').backgroundModelSelection, null)
  await assert.rejects(call({}), /配置无效/)
  await assert.rejects(settings.save({ sessionId: 'missing', backgroundModel: null }), /游玩会话/)
})

test('旧版世界书选择不再由本局设置读写，保存其它选项仍保留召回历史', async () => {
  const reads = { 'book:7': { turn: 3, kind: 'screened', fingerprint: 'old' } }
  const chats = new Map(['one', 'two'].map(id => [id, { id, mode: 'story', worldbookStrategy: 'old-plugin', worldBookReads: reads, backgroundTasks: { worldbookScreening: true, posture: false }, disabledWritingSkills: ['writing'] }]))
  const settings = createConversationBackgroundSettings({
    readConfig: async id => projectChatBackgroundConfig(chats.get(id)), readChat: async id => chats.get(id),
    updateChat: async (id, mutation) => { const next = mutation({ ...chats.get(id), messages: ['concurrent'] }); chats.set(id, next); return next },
    isPlayMode: mode => mode === 'story', modelCatalog: async () => [], modelReasoning: async () => null
  })
  const config = await settings.read('one')
  assert.equal(Object.hasOwn(config, 'worldbookStrategy'), false)
  assert.equal(Object.hasOwn(config, 'worldbookStrategies'), false)
  const saved = await settings.save({ sessionId: 'one', worldbookStrategy: 'native-skills', backgroundTasks: { foregroundCandidates: true } })
  assert.equal(Object.hasOwn(saved, 'worldbookStrategy'), false)
  assert.equal(chats.get('one').worldbookStrategy, 'old-plugin')
  assert.equal(chats.get('one').backgroundTasks.worldbookScreening, false)
  assert.equal(chats.get('one').backgroundTasks.posture, false)
  assert.equal(chats.get('one').backgroundTasks.foregroundCandidates, true)
  assert.deepEqual(chats.get('one').worldBookReads, reads)
  assert.deepEqual(chats.get('one').disabledWritingSkills, ['writing'])
  assert.deepEqual(chats.get('one').messages, ['concurrent'])
})

test('前台目录随本局联网开关更新，只列出宿主提供的网页工具', async () => {
  let chat = { id: 'game', mode: 'script', disabledForegroundTools: ['web_search'] }
  const registered = new Set(['web_search'])
  const settings = createConversationBackgroundSettings({
    readConfig: async () => chat, readChat: async () => chat, isPlayMode: mode => mode === 'script',
    updateChat: async (_id, mutation) => chat = mutation(chat), modelCatalog: async () => [],
    hasNativeTool: (name, sessionId) => sessionId === 'game' && registered.has(name),
    toolNetworkFor: name => name === 'plugin_search' ? 'search' : undefined,
    extraTools: async () => [{ name: 'plugin_search' }, { name: 'plugin_local' }, { name: 'web_fetch' }]
  })
  const relevantTools = config => config.foregroundTools.map(tool => tool.name).filter(name => /^(web_|plugin_)/.test(name))
  assert.deepEqual(relevantTools(await settings.read('game')), ['plugin_local'])
  const online = await settings.save({ sessionId: 'game', webSearchEnabled: true })
  assert.deepEqual(relevantTools(online), ['web_search', 'plugin_search', 'plugin_local'])
  assert.deepEqual(online.disabledForegroundTools, ['web_search'])
  registered.add('web_fetch')
  assert.deepEqual(relevantTools(await settings.read('game')), ['web_search', 'web_fetch', 'plugin_search', 'plugin_local'])
  assert.deepEqual(relevantTools(await settings.save({ sessionId: 'game', webSearchEnabled: false })), ['plugin_local'])
})
