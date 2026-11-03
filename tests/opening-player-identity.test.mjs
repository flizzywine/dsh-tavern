import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { projectAgentContent } from '../tavern-plugin/lib/domain/runtime-content-projection.js'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

const chosen = '\u5c0f\u5706', fallback = '\u9ad8\u5742\u6708'

test('submitted opening name survives the stale picker default and enters the first fixed context', async () => {
  const h = initializationFixture()
  h.state.settings.defaultPlaySettings = { playerName: fallback }
  h.state.extensions = { openingSetup: { form: '<form></form>' } }
  h.card.description = '{{user}} / <user>'
  const service = createOpeningPreparation({ readCard: async () => h.card, worldBooks: { bound: async () => null } })
  const draft = await service.create(h.card.path, { userName: fallback })
  await service.callRuntime(draft.id, 'prepareOpeningCommand', { line: '/send Begin.|/trigger', userName: chosen })
  const preparation = service.resolve(draft.id, h.card.path, 'primary')
  const chat = await h.make().start({ ...h.input, userName: fallback, preparation })
  assert.equal(chat.macroState.userName, chosen)
  assert.equal(h.saved.get(chat.id).macroState.userName, chosen)
  assert.equal(projectAgentContent('{{user}} / <user>', { macroState: chat.macroState }).agentText, chosen + ' / ' + chosen)
  assert.ok(h.session().prefix.includes(chosen + ' is the player.'))
  assert.ok(!h.session().prefix.includes(fallback))
  const reopened = await h.make().start({ ...h.input, userName: fallback })
  assert.equal(reopened.macroState.userName, chosen, 'later initialization must not overwrite an existing identity')
})

test('ordinary new chat uses the explicit name, and defaults only when no name was entered', async () => {
  for (const userName of [chosen, undefined]) {
    const h = initializationFixture()
    h.state.settings.defaultPlaySettings = { playerName: fallback }
    const chat = await h.make().start({ ...h.input, userName })
    assert.equal(chat.macroState.userName, userName ?? fallback)
    assert.ok(h.session().prefix.includes((userName ?? fallback) + ' is the player.'))
  }
})

test('opening bridge submits the identity to the draft; play settings use the existing name authority', async () => {
  const frame = await readFile(new URL('../tavern-plugin/src/client/runtime/message-frame-lifecycle.js', import.meta.url), 'utf8')
  assert.match(frame, /method: "prepareOpeningCommand", args: \{[\s\S]*?userName: data.args && data.args.playerName/)
  const controls = await readFile(new URL('../tavern-plugin/src/client/modules/conversation-settings.js', import.meta.url), 'utf8')
  assert.match(controls, /rpc\("setPlayerName", \{ userName: value \}, props.sessionId\)/)
})
