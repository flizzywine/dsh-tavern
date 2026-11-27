import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from './fixtures/client-vm.mjs'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'
import { createCardOpeningRuntime } from '../tavern-plugin/lib/domain/card-opening-runtime.js'

const source = readFileSync(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')

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
  const adapter = source.slice(source.indexOf('createChat: async function (request, sessionId)'), source.indexOf('rememberPending: setPendingOpen'))
  const { createChat } = vm.runInNewContext('({' + adapter + '})', {
    call: async (method, request) => {
      assert.equal(method, 'startChat')
      return { view: await initialization.start({ ...request, cardPath: request.path }) }
    },
    liveTavernView: {},
  })
  for (const [userName, expected] of [[undefined, '水野涟'], ['  旅人  ', '旅人']]) {
    const { openings, defaultPlayerName } = await preview(fixture.card.path, userName)
    const { view } = await createChat({ card: fixture.card, targetMode: 'story', userName }, expected)
    assert.equal(defaultPlayerName, '水野涟')
    assert.equal(view.macroState.userName, expected)
    assert.equal(openings[0].text, view.messages[0].text)
  }
})
