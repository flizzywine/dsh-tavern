import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {createSettingsHandlers} from '../tavern-plugin/lib/rpc/settings.js'

function harness({settingsDelay = 0} = {}){
  let reads = 0, catalogCalls = 0
  const deps = {
    readTavernSettings: async () => { reads++; if (settingsDelay) await new Promise(r => setTimeout(r, settingsDelay)); return { playerName: '你' } },
    slotDeclarations: async () => [],
    scoringCatalog: () => ({ weights: [] }),
    tavernModelCatalog: async () => { catalogCalls++; return [{ provider: 'p1', providerName: 'P1', models: [{ id: 'm1', name: 'M1' }] }] },
    pluginApi: { bodyGenerators: { list: async () => [] } },
    presentSystemPrompts: () => ({}),
    presentUserPreferenceProfile: () => ({})
  }
  return { handlers: createSettingsHandlers(deps), reads: () => reads, catalogCalls: () => catalogCalls }
}

test('同时到达的设置读取只读一次，返回各自独立的对象', async () => {
  const h = harness({ settingsDelay: 10 })
  const [a, b, c] = await Promise.all([h.handlers.getTavernSettings({}), h.handlers.getTavernSettings({}), h.handlers.getTavernSettings({})])
  assert.equal(h.reads(), 1, '并发读取合并成一次')
  assert.equal(h.catalogCalls(), 1)
  assert.deepEqual(a, b)
  a.settings.playerName = '改动'
  assert.equal(b.settings.playerName, '你', '返回的是副本，互不影响')
  await h.handlers.getTavernSettings({})
  assert.equal(h.reads(), 2, '请求结束后下一次读取重新读盘')
})

test('模型选择器只取目录，不读整份设置', async () => {
  const h = harness()
  assert.deepEqual(await h.handlers.getTavernModelCatalog(), { modelCatalog: [{ provider: 'p1', providerName: 'P1', models: [{ id: 'm1', name: 'M1' }] }] })
  assert.equal(h.reads(), 0, '取目录不触发设置读盘')
})

test('空设置文件允许启动、读会话、保存错误可见性及重新写入设置', async () => {
  const home = await mkdtemp(join(tmpdir(), 'tavern-empty-settings-'))
  const previousHome = process.env.DSH_HOME
  const previousFetch = globalThis.fetch
  let host
  try {
    process.env.DSH_HOME = home
    const dataRoot = join(home, 'profile-data', 'tavern', 'data')
    const settings = join(dataRoot, 'tavern-settings.json')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(settings, '')
    await writeFile(join(dataRoot, 'sessions.json'), JSON.stringify({ session: 'chat' }))
    const { createChatJournalStore } = await import('../tavern-plugin/lib/domain/chat-journal-store.js')
    const { createChatPersistence } = await import('../tavern-plugin/lib/domain/chat-persistence.js')
    const { createPluginHost } = await import('./fixtures/plugin-host.mjs')
    host = await createPluginHost({ config: { stage: false } })
    const { card } = await host.rpc('importCard', {
      payload: { name: 'fixture.json', text: JSON.stringify({ name: '旅店', first_mes: '欢迎' }) }
    })
    await createChatPersistence({ store: createChatJournalStore({ dataRoot, newConversations: true }) }).write({
      id: 'chat', sessionId: 'session', mode: 'story', cardPath: card.path, title: '保存的故事', messages: []
    })
    host.services.get('sessions').set('session', { events: [], surface: { nodes: [] } })
    const readSession = () => host.rpc('getSession', { sessionId: 'session' })
    assert.equal((await readSession()).view.chatId, 'chat')
    assert.equal(await readFile(settings, 'utf8'), '')

    await writeFile(settings, ' \t\r\n')
    assert.equal((await readSession()).view.chatId, 'chat')
    const { view } = await host.rpc('setAllFailedErrorVisibility', { sessionId: 'session', hidden: true })
    assert.equal(view.chatId, 'chat')
    assert.equal((await host.rpc('getTavernSettings', {})).settings.defaultPlaySettings.candidateTabs, true)
    const saved = await host.rpc('updateTavernSettings', { patch: { defaultPlaySettings: { playerName: '旅客', candidateTabs: true } } })
    assert.equal(saved.settings.defaultPlaySettings.playerName, '旅客')
    assert.equal(JSON.parse(await readFile(settings, 'utf8')).defaultPlaySettings.playerName, '旅客')
    const sessionId = 'session'
    assert.equal((await host.rpc('getConversationBackgroundConfig', { sessionId })).candidateTabs, false, '旧局保留少量候选')
    await host.rpc('setConversationBackgroundConfig', { sessionId, candidateTabs: true })
    assert.equal((await host.rpc('getConversationBackgroundConfig', { sessionId })).candidateTabs, true)
    await host.rpc('updateTavernSettings', { patch: { defaultPlaySettings: { candidateTabs: false } } })
    assert.equal((await host.rpc('getConversationBackgroundConfig', { sessionId })).candidateTabs, true, '开局默认不改本局选择')
  } finally {
    await host?.dispose()
    globalThis.fetch = previousFetch
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    await rm(home, { recursive: true, force: true })
  }
})
