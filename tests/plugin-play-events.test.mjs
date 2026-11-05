import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from './fixtures/client-vm.mjs'

const source = await readFile(new URL('../tavern-plugin/lib/client.js', import.meta.url), 'utf8')
const slice = (from, to) => { const start = source.indexOf(from); return source.slice(start, source.indexOf(to, start)) }
const events = slice('const tavernPlayEvents = (function', '\n\t\t})();') + '\n\t\t})();'
const factory = slice('function createTavernUiExtensions()', 'const tavernUiExtensions = createTavernUiExtensions()')

function load({ allowed = () => true } = {}) {
  const reports = []
  const views = new Map()
  const context = {
    React: { createElement: () => null },
    tavernPluginBoundary: () => 'Boundary',
    tavernPluginAllowed: (owner, gameId) => allowed(owner, gameId),
    liveTavernView: { getSnapshot: id => ({ view: views.get(id) || null }), subscribe: () => () => {} },
    Date: { now: () => 1234 },
    setTimeout, clearTimeout,
  }
  // The error hub reports through the same channel, like ui/error-center.js.
  context.tavernErrorHub = { report(source, error) { reports.push([source, error.message]); context.tavernPlayEvents.emit('error', '') } }
  vm.runInNewContext(events + '; globalThis.tavernPlayEvents = tavernPlayEvents', context)
  const ui = vm.runInNewContext(factory + '; createTavernUiExtensions()', context)
  const plugin = name => Object.setPrototypeOf({ ctx: { fiber: { name } } }, ui.service)
  return { ui, bus: context.tavernPlayEvents, views, plugin, reports }
}

test('onPlayEvent: listener gets { type, gameId, turn, at, ...fields } and stops when unsubscribed', () => {
  const { ui, bus, views, plugin } = load()
  assert.equal(ui.service.apiVersion, 9)
  views.set('g1', { latestAssistantTurn: 4 })
  const seen = []
  const stop = plugin('stats').onPlayEvent(event => seen.push({ ...event }))
  bus.emit('choice', 'g1', { choiceIndex: 2 })
  bus.emit('page', 'g1', { turn: 3, page: 1, dwellMs: 900, skipped: false })
  stop()
  bus.emit('regenerate', 'g1')
  assert.deepEqual(seen, [
    { type: 'choice', gameId: 'g1', turn: 4, at: 1234, choiceIndex: 2 },
    { type: 'page', gameId: 'g1', turn: 3, at: 1234, page: 1, dwellMs: 900, skipped: false },
  ])
})

test('onPlayEvent: a plugin off for a game hears nothing from it; page-wide events reach every plugin', () => {
  const { bus, plugin } = load({ allowed: (owner, gameId) => !(owner === 'off' && gameId === 'g2') })
  const seen = []
  plugin('off').onPlayEvent(event => seen.push(event.type + ':' + event.gameId))
  bus.emit('choice', 'g2', { choiceIndex: 0 })
  bus.emit('voice_replay', 'g3')
  bus.emit('error', '')
  assert.deepEqual(seen, ['voice_replay:g3', 'error:'])
})

test('emitOnce: an error row shown again by a re-render is one event', () => {
  const { bus, plugin } = load()
  const seen = []
  plugin('stats').onPlayEvent(event => seen.push(event.type + ':' + event.nativeTurn))
  for (let i = 0; i < 3; i += 1) bus.emitOnce('g1:5', 'native_error', 'g1', { nativeTurn: 5 })
  bus.emitOnce('g1:6', 'native_error', 'g1', { nativeTurn: 6 })
  assert.deepEqual(seen, ['native_error:5', 'native_error:6'])
})

test('onPlayEvent: a listener that keeps throwing is reported, dropped after three failures, and never loops on its own error events', () => {
  const { bus, plugin, reports } = load()
  const other = []
  plugin('broken').onPlayEvent(() => { throw new Error('boom') })
  plugin('fine').onPlayEvent(event => other.push(event.type))
  bus.emit('choice', 'g1', { choiceIndex: 1 })
  bus.emit('skip', 'g1')
  assert.equal(reports.length, 3)
  assert.match(reports[0][0], /broken/)
  assert.equal(other[0], 'error', 'the report of the first failure is itself delivered depth-first')
  assert.deepEqual(other.slice(-2), ['choice', 'skip'])
  assert.equal(other.filter(type => type === 'error').length, 3)
})

test('editChars counts the changed span, not the length difference', () => {
  const { bus } = load()
  assert.equal(bus.editChars('去车站', '去车站'), 0)
  assert.equal(bus.editChars('去车站', '去学校'), 4)
  assert.equal(bus.editChars('去车站吧', '去车站'), 1)
})
