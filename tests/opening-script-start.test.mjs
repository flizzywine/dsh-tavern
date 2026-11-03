import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createOpeningPreparation } from '../tavern-plugin/lib/domain/opening-preparation.js'
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

test('an opening chooses a chunk through continuity and the next committed turn advances it', async () => {
  const { h, preparation } = await fixture({ chunk: 2 })
  const chat = await h.make().start({ ...h.input, preparation })
  assert.equal(chat.mode, 'script')
  // The saved advance size re-splits the script; the chosen start survives as a source offset.
  const start = h.state.script.chunks[0].text.length
  assert.equal(chat.scriptState.sourceOffset, start)
  const continuity = createScriptContinuity()
  const prepared = continuity.transition({ script: h.state.script, state: chat.scriptState,
    event: { kind: 'prepare', userText: 'Look around.', nativeTurn: 1 } })
  assert.ok(prepared.reference.text.startsWith(h.state.script.chunks[1].text))
  const next = continuity.transition({ script: h.state.script, state: prepared.state,
    event: { kind: 'commit', userText: 'Look around.', nativeTurn: 1 } })
  assert.ok(next.state.sourceOffset > start)
  const existing = await h.make().start({ ...h.input, preparation: { startCommand: { scriptStart: { chunk: 3 } } } })
  assert.equal(existing.scriptState.sourceOffset, start, 're-entering a chat never resets its position')
})

test('a worldbook-only route leaves the card binding intact and starts without a script cursor', async () => {
  const { h, preparation } = await fixture({ mode: 'story' })
  const chat = await h.make().start({ ...h.input, preparation })
  assert.equal(chat.mode, 'story')
  assert.equal(chat.scriptState, null)
  assert.equal(h.state.script.chunks.length, 3)
})

test('a form without an explicit start preserves the existing blank-greeting alignment', async () => {
  const { h, preparation } = await fixture()
  h.card.first_mes = h.state.script.chunks[1].text
  preparation.openingMessages.primary = h.card.first_mes
  const chat = await h.make().start({ ...h.input, preparation })
  assert.equal(chat.openingText, '\u3000')
  assert.equal(chat.scriptState.cursor, createScriptContinuity().startAligned(h.state.script, '\u3000').cursor)
  assert.equal(chat.scriptState.cursor, 0)
})

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

test('invalid opening targets fail before publishing any conversation', async () => {
  for (const scriptStart of [{ chunk: 4 }, { chunk: 1 }]) {
    const { h, preparation } = await fixture(scriptStart)
    if (scriptStart.chunk === 1) h.state.script = undefined
    await assert.rejects(h.make().start({ ...h.input, preparation }), /剧本块不存在/)
    assert.equal(h.saved.size, 0)
  }
  const { service, draft, h, preparation } = await fixture({ chunk: 2 })
  for (const scriptStart of [null, 2, { chunk: 0 }, { chunk: 1.5 }, { chunk: '2' }, { mode: 'script' }, { mode: 'story', chunk: 2 }]) {
    await assert.rejects(service.callRuntime(draft.id, 'prepareOpeningCommand', { line: '/trigger', scriptStart }), /剧本起点/)
    assert.deepEqual(service.resolve(draft.id, h.card.path, 'primary'), preparation)
  }
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
