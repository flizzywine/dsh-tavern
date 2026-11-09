import test from 'node:test'
import assert from 'node:assert/strict'
import { createSessionViewReader } from '../tavern-plugin/lib/domain/session-view-reader.js'
import { createPlayHandlers } from '../tavern-plugin/lib/rpc/play.js'

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

test('故事 RPC 不触发 reconcile、branchOrigin 或后台目录', async () => {
  const handlers = createPlayHandlers({
    sessionViews: { response: async args => ({ received: args }) },
    reconcileWhenIdle: async () => { throw new Error('不应 reconcile') },
    branchOrigin: { ensure: async () => { throw new Error('不应修复 native branch') } },
    backgroundCatalog: async () => { throw new Error('不应读取后台目录') },
    templateHistoryFrom: new Map()
  })
  const result = await handlers.getStoryTranscript({ sessionId: 'story-session', historyFrom: 2 })
  assert.deepEqual(result.received, { sessionId: 'story-session', historyFrom: 2, storyTranscript: 1 })
})
