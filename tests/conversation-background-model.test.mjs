import { createConversationBackgroundSettings } from '../tavern-plugin/lib/domain/conversation-background-settings.js'
import { projectChatBackgroundConfig } from '../tavern-plugin/lib/domain/chat-session-state.js'
import { createTurnOrchestrator } from '../tavern-plugin/lib/domain/turn-orchestration.js'
import { STORY_GENERATE_TOOL_NAME } from '../tavern-plugin/lib/domain/story-tool-submission.js'
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

test('只有插件工具调用需要前台开关，旧开关不阻止插件直出', async () => {
  let chat = { id: 'game', mode: 'script', disabledForegroundTools: [STORY_GENERATE_TOOL_NAME] }
  let mode = 'host'
  const settings = createConversationBackgroundSettings({
    readConfig: async () => chat, readChat: async () => chat, isPlayMode: value => value === 'script',
    updateChat: async (_id, mutation) => chat = mutation(chat), modelCatalog: async () => [],
    bodyGenerationToolAvailable: async () => mode === 'plugin-tool-call',
    extraTools: async () => [{ name: STORY_GENERATE_TOOL_NAME }]
  })
  const turns = createTurnOrchestrator({ store: { chatForSession: async () => chat }, frameBuilder: { build() {} },
    bodyGeneration: async () => ({ mode }) })
  const toolRows = async () => (await settings.read('game')).foregroundTools.filter(tool => tool.name === STORY_GENERATE_TOOL_NAME)
  assert.deepEqual(await toolRows(), [])
  assert.equal((await turns.callableTools('game')).includes(STORY_GENERATE_TOOL_NAME), false)
  mode = 'plugin-direct'
  assert.deepEqual(await toolRows(), [])
  assert.equal((await turns.callableTools('game')).includes(STORY_GENERATE_TOOL_NAME), true)
  mode = 'plugin-tool-call'
  assert.deepEqual((await toolRows()).map(tool => tool.label), ['插件生成正文'])
  await assert.rejects(turns.callableTools('game'), /本局禁用了正文生成工具/)
  await settings.save({ sessionId: 'game', disabledForegroundTools: [] })
  assert.equal((await turns.callableTools('game')).includes(STORY_GENERATE_TOOL_NAME), true)
})

test('自由和剧本游玩只开放一个世界书工具，旧存档的关闭状态沿用', async () => {
  let chat = { id: 'game', mode: 'story', disabledForegroundTools: ['worldbook_grep', 'read_lorebook'] }
  const settings = createConversationBackgroundSettings({
    readConfig: async () => chat, readChat: async () => chat, isPlayMode: mode => ['story', 'script'].includes(mode),
    updateChat: async (_id, mutation) => chat = mutation(chat), modelCatalog: async () => []
  })
  const turns = createTurnOrchestrator({ store: { chatForSession: async () => chat }, frameBuilder: { build() {} } })
  const worldbookTools = names => names.filter(name => /lorebook|worldbook|^read$/.test(name))
  const savedConfig = await settings.read('game')
  assert.deepEqual(savedConfig.disabledForegroundTools, ['query_lorebook'])
  assert.deepEqual(worldbookTools(await turns.visibleTools('game')), [])
  assert.deepEqual(savedConfig.foregroundTools.filter(tool => worldbookTools([tool.name]).length).map(tool => [tool.name, tool.label]),
    [['query_lorebook', '查询世界书']])
  await settings.save({ sessionId: 'game', disabledForegroundTools: [] })
  for (const mode of ['story', 'script']) {
    chat.mode = mode
    assert.deepEqual(worldbookTools(await turns.callableTools('game')), ['query_lorebook'])
  }
})
