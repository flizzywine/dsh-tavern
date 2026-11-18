import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'
import { createChatJournalStore } from '../tavern-plugin/lib/domain/chat-journal-store.js'
import { createChatPersistence } from '../tavern-plugin/lib/domain/chat-persistence.js'

const trace = {
  stage: async (_name, work) => work(),
  state() {}
}

test('故事响应只走故事窗口，不读取完整 Chat、原生窗口或同步游标', async () => {
  const transcript = { source: 'story', revision: 9, from: 0, to: 0, messageCount: 1, floorCount: 1, floorOffset: 0, messages: [] }
  const calls = []
  const reader = createSessionViewReader({
    readState: async () => { throw new Error('不应读取 native state') },
    readChat: async () => { throw new Error('不应读取完整 Chat') },
    readChanges: async () => { throw new Error('不应读取变更索引') },
    readOpeningWindow: async () => { throw new Error('不应读取原生 openingWindow') },
    readStoryWindow: async (sessionId, historyFrom, options) => {
      calls.push(['readStoryWindow', sessionId, historyFrom, options.includeToolCalls])
      return { chat: { id: 'chat', sessionId, messages: [] }, revision: 9, storyTranscript: transcript }
    },
    project: {
      story: async (window, options) => {
        calls.push(['projectStory', window.revision, options.deferResources])
        return { chatId: 'chat', storyTranscript: transcript }
      }
    },
    activity: () => { throw new Error('不应读取 native activity') },
    trace,
    foregroundRunning: () => { throw new Error('不应读取 native running state') },
    synchronize: Object.assign(() => { throw new Error('不应同步 native view cursor') }, { peek: () => { throw new Error('不应读取 native cursor') } })
  })

  const result = await reader.response({ sessionId: 'story-session', storyTranscript: 1, historyFrom: 4, resourceSync: 1 })
  assert.equal(result.storyTranscript, transcript)
  assert.equal(result.revision, 9)
  assert.deepEqual(result.view, { chatId: 'chat' })
  await reader.response({ sessionId: 'story-session', storyTranscript: 1, historyFrom: 4, resourceSync: 1, includeToolCalls: true })
  assert.deepEqual(calls, [
    ['readStoryWindow', 'story-session', 4, false],
    ['projectStory', 9, true],
    ['readStoryWindow', 'story-session', 4, true],
    ['projectStory', 9, true]
  ])
})

test('全局状态栏设置变化使故事 RPC 重新投影，存档 revision 保持一致', async () => {
  const home = await mkdtemp(join(tmpdir(), 'story-projection-settings-'))
  const previousHome = process.env.DSH_HOME, previousFetch = globalThis.fetch
  let host
  try {
    process.env.DSH_HOME = home
    const dataRoot = join(home, 'profile-data', 'tavern', 'data')
    await mkdir(dataRoot, { recursive: true })
    await writeFile(join(dataRoot, 'sessions.json'), '{"session":"chat"}')
    const { createPluginHost } = await import('./fixtures/plugin-host.mjs')
    host = await createPluginHost({ config: { stage: false } })
    const { card } = await host.rpc('importCard', {
      payload: { name: 'fixture.json', text: JSON.stringify({ name: '旅店', first_mes: '欢迎' }) }
    })
    await createChatPersistence({ store: createChatJournalStore({ dataRoot, newConversations: true }) }).write({
      id: 'chat', sessionId: 'session', mode: 'story', cardPath: card.path, title: '保存的故事',
      messages: [{ role: 'assistant', greeting: true, turn: 1, text: '欢迎' }]
    })
    const read = knownStorySignature => host.rpc('getStoryTranscript', { sessionId: 'session', knownStorySignature })
    const first = await read()
    assert.equal(first.view.statusBarPlacement, 'sidebar')
    assert.equal((await read(first.storySignature)).unchanged, true)
    await host.rpc('updateTavernSettings', { patch: { defaultPlaySettings: { statusBarPlacement: 'body' } } })
    const changed = await read(first.storySignature)
    assert.equal(changed.revision, first.revision)
    assert.notEqual(changed.storySignature, first.storySignature)
    assert.equal(changed.view.statusBarPlacement, 'body')
    assert.equal((await read(changed.storySignature)).unchanged, true)
  } finally {
    await host?.dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    globalThis.fetch = previousFetch
    await rm(home, { recursive: true, force: true })
  }
})

test('同一故事窗口的世界书传输格式变化会返回新视图', async () => {
  const worldbook = { name: '故事世界书' }
  const reader = createSessionViewReader({
    readStoryWindow: async () => ({
      chat: { id: 'chat', sessionId: 'session', messages: [] },
      revision: 1, stamp: 'native:snapshot', storyTranscript: { messages: [] }
    }),
    readStoryVersion: async () => 'native:snapshot',
    project: { story: async () => ({ tavernHelper: { worldbook }, tavernHelperWorldbook: worldbook }) },
    trace
  })
  const args = { sessionId: 'session', storyTranscript: 1 }
  const old = await reader.response(args)
  const current = await reader.response({ ...args, knownStorySignature: old.storySignature, helperWorldbookSync: 1 })
  assert.equal(old.view.tavernHelperWorldbook, worldbook)
  assert.equal(current.view.tavernHelper.worldbook, worldbook)
  assert.equal(Object.hasOwn(current.view, 'tavernHelperWorldbook'), false)
  assert.notEqual(current.storySignature, old.storySignature)
})
