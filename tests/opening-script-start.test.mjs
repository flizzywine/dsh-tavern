import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
import { parseOpeningCommand } from '../tavern-plugin/lib/domain/opening-command.js'
import { createScriptContinuity } from '../tavern-plugin/lib/domain/script-continuity.js'
import { initializationFixture } from './fixtures/conversation-initialization.mjs'

async function fixture(scriptStart) {
  const h = initializationFixture()
  h.state.extensions = { openingSetup: { form: '<form></form>' } }
  h.state.script = { title: 'Routes', importedAt: 1, chunks: [
    { id: 'chunk-00001', order: 0, text: 'A quiet morning at the station.' },
    { id: 'chunk-00002', order: 1, text: 'The clock strikes midnight as the ferry arrives.' },
    { id: 'chunk-00003', order: 2, text: 'At dawn the travelers return to the mountain.' }
  ] }
  const service = createOpeningPreparation({ readCard: async () => h.card, worldBooks: { bound: async () => null } })
  const draft = await service.create(h.card.path, {})
  await service.callRuntime(draft.id, 'prepareOpeningCommand', { line: '/send Begin.|/trigger', scriptStart })
  return { h, service, draft, preparation: service.resolve(draft.id, h.card.path, 'primary') }
}

test('omitted starts retain upstream prose alignment and explicit starts override card defaults', async () => {
  const implicit = await fixture()
  implicit.h.state.extensions = {}
  implicit.h.card.first_mes = implicit.h.state.script.chunks[1].text
  implicit.preparation.openingMessages.primary = implicit.h.card.first_mes
  const chat = await implicit.h.make().start({ ...implicit.h.input, preparation: implicit.preparation })
  assert.equal(chat.scriptState.sourceOffset, createScriptContinuity().startAligned(implicit.h.state.script, implicit.h.card.first_mes).sourceOffset)
  assert.equal(chat.scriptState.sourceOffset, implicit.h.state.script.chunks[0].text.length)

  const explicit = await fixture({ chunk: 1 })
  explicit.h.card.script_start = 2
  const selected = await explicit.h.make().start({ ...explicit.h.input, preparation: explicit.preparation })
  assert.equal(selected.scriptState.sourceOffset, 0)
})

test('opening submissions project dialogue through the shared parser without leaking stage protocol', () => {
  const message = 'Morning.\n`@bubble:guide|Guide|calm|[Welcome.]|[Bonjour.]`\n@bubble：guest｜Guest｜｜[*Time to leave.*]\n@bubble:broken|[A fragment.]'
  const command = parseOpeningCommand('/send ' + message + '|/trigger')
  assert.equal(command.input, 'Morning.\nGuide：“Welcome.”\nGuest：（Time to leave.）\nA fragment.')
  assert.equal(command.input.includes('@bubble'), false)
  assert.equal(command.input.includes('Bonjour'), false)
  assert.equal(parseOpeningCommand('/send Line one.\n\nLine two.\\|More.|/trigger').input, 'Line one.\n\nLine two.|More.')
  assert.equal(parseOpeningCommand('/sys ' + message + '|/trigger').systemText, message)
})

test('the form bridge carries the route separately from the player message', async () => {
  const source = await readFile(new URL('../tavern-plugin/src/client/opening-preview.js', import.meta.url), 'utf8')
  const sent = [], listeners = []
  const parent = { postMessage: message => sent.push(message) }
  const context = vm.createContext({ parent, console, setTimeout, clearTimeout,
    addEventListener: (type, listener) => listeners.push(listener) })
  context.window = context
  vm.runInContext(source, context)
  context.installOpeningPreviewBridge('token', { runtime: false, swipes: ['Opening'], selectedIndex: 0, openingIds: ['primary'], worldbook: null })
  const pending = context.dshOpening.start({ playerName: 'Player', message: 'Look | listen.', scriptStart: { chunk: 2 } })
  const request = sent.at(-1)
  assert.deepEqual(JSON.parse(JSON.stringify(request.args)), { line: '/send Look \\| listen.|/trigger', playerName: 'Player', scriptStart: { chunk: 2 } })
  listeners.at(-1)({ source: parent, data: { type: 'dsh-tavern-helper-response', token: 'token', requestId: request.requestId, ok: true, result: {} } })
  await pending
})
