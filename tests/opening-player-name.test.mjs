import test from 'node:test'
import assert from 'node:assert/strict'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'
import { createCardOpeningRuntime } from '../tavern-plugin/lib/domain/card-opening-runtime.js'
import { createStartChatRequest } from '../tavern-plugin/src/client/runtime/conversation-lifecycle.js'

test('留空时开局请求、开场预览和保存的玩家称呼使用同一个全局默认值', async t => {
  const fixture = initializationFixture()
  fixture.state.settings.defaultPlaySettings = { playerName: '水野涟' }
  const initialization = fixture.make()
  const { getCardOpenings: preview, openingPreparation } = createCardOpeningRuntime({
    readCard: async () => fixture.card,
    readTavernSettings: async () => fixture.state.settings,
    readCardExtensions: async () => ({}),
    tavernRemoteAssets: { pinExtensions: async () => ({}) },
    requestPerformance: { stage: (_, run) => run() },
    performanceDiagnostics: { opening() {} },
  })
  t.after(() => openingPreparation.dispose())
  const seeded = new Map()
  const createChat = createStartChatRequest({
    call: async (method, request) => {
      assert.equal(method, 'startChat')
      return { view: await initialization.start({ ...request, cardPath: request.path }) }
    },
    seedView: (sessionId, view) => seeded.set(sessionId, view),
  })
  for (const [userName, expected] of [[undefined, '水野涟'], ['  旅人  ', '旅人']]) {
    const { openings, defaultPlayerName } = await preview(fixture.card.path, userName)
    const { view } = await createChat({ card: fixture.card, targetMode: 'story', userName }, expected)
    assert.equal(defaultPlayerName, '水野涟')
    assert.equal(view.macroState.userName, expected)
    assert.equal(seeded.get(expected), view)
    assert.equal(openings[0].text, view.messages[0].text)
  }
})
