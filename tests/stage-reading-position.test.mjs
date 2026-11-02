import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const kernel = require('../tavern-plugin/src/client/stage-runtime.cjs')
const {stageBlockPages, stagePageHeldTail} = require('../tavern-plugin/src/client/stage-page-index.cjs')
const factory = (file, name) => vm.runInNewContext(readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client/' + file, import.meta.url), 'utf8') + '\n' + name, {})
const {createStageSessionRuntime} = require('../tavern-plugin/packages/dsh-tavern-stage/src/client/session-runtime.cjs')
const runtime = createStageSessionRuntime({kernel, createStoreModule: factory('runtime-store.cjs', 'createStageRuntimeStoreModule'), createSessionModule: factory('session.cjs', 'createStageSessionModule')})
test.after(() => runtime.dispose())

function signal(snapshot) {
  const listeners = new Set()
  return {getSnapshot: () => snapshot, subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn)},
    publish(next) {snapshot = next; for (const fn of [...listeners]) fn()}}
}
// Three loaded rounds of three one-page paragraphs each; the index stands in for the host-published bodies.
function rows(turns) {
  return new Map(turns.map(turn => {
    const pages = ['Opening.', 'Middle.', 'Saved page.'].map((text, i) => ({text: `${text} ${turn}`, anchor: {paragraphId: `${turn}:${i + 1}`, para: i + 1, offset: 0}}))
    return [turn, {turn, nativeTurn: turn, parts: [], text: {pages, units: [], hasReadableText: true, streaming: false}}]
  }))
}
function harness() {
  const index = rows([1, 2, 3])
  const list = signal({current: 's', byId: {s: {}}})
  const views = signal({view: {mode: 'story', chatId: 'chat', card: {path: 'card'}}})
  const coordination = signal({view: {cardPath: 'card', runtimeGeneration: 'host-1'}})
  const settings = signal({cardPath: 'card', config: {enabled: true}})
  const prefs = signal({})
  const chat = signal({nodes: new Map()}), session = signal({running: false})
  const binding = {session}
  const owner = runtime.createSessionOwner({
    sessions: {list, binding: () => binding}, resolveChat: () => chat,
    views: {select: () => views, invalidate() {}},
    coordination: {getSnapshot: () => coordination.getSnapshot(), subscribe: (_id, fn) => coordination.subscribe(fn)},
    settings: {get: () => settings.getSnapshot(), load() {}, subscribe: settings.subscribe},
    preferences: {get: prefs.getSnapshot, subscribe: prefs.subscribe}, storyTurn: (_view, turn) => turn,
    createIndex: () => ({getSnapshot: () => index, reconcile: () => index, clear() {}, touch() {}}),
  })
  owner.start()
  return {owner, coordination, state: () => owner.get('s').getSnapshot(),
    view(patch) {views.publish({view: {...views.getSnapshot().view, ...patch}})}, dispose: () => owner.dispose()}
}
const place = anchor => ({para: anchor.para, offset: anchor.offset})

test('a lifecycle reload keeps the reader on the same round and page, still; another chat starts over', async () => {
  const h = harness()
  try {
    await h.owner.navigate('s', 3, 2, true)
    const before = h.state()
    assert.equal(before.cursor.anchor.para, 3)
    h.view({tavernHelper: {lifecycleRevision: 1}})
    assert.notEqual(h.state().source.branchId, before.source.branchId, 'the lifecycle still resets the branch')
    assert.deepEqual(place(h.state().cursor.anchor), place(before.cursor.anchor), 'the same page, not page one')
    assert.equal(h.state().cursor.mode, 'live')
    assert.equal(h.state().cursor.still, true, 'a restored page plays nothing')
    h.coordination.publish({view: {cardPath: 'card', runtimeGeneration: 'host-2'}})
    assert.deepEqual(place(h.state().cursor.anchor), place(before.cursor.anchor), 'a card reload (new authority) keeps it too')
    h.view({chatId: 'other', tavernHelper: {lifecycleRevision: 2}})
    assert.deepEqual(h.state().cursor.anchor, h.state().text.pages[0].anchor, 'another chat starts at its beginning')
  } finally {h.dispose()}
})

test('a lifecycle reload while reading an earlier round returns to that round and page, still', async () => {
  const h = harness()
  try {
    await h.owner.navigate('s', 1, 1, false)
    const before = h.state()
    assert.equal(before.source.turn, 1)
    assert.equal(before.cursor.mode, 'history')
    h.view({tavernHelper: {lifecycleRevision: 1}})
    for (let i = 0; i < 5 && h.state().source.turn !== 1; i++) await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(h.state().source.turn, 1)
    assert.notEqual(h.state().source.branchId, before.source.branchId)
    assert.deepEqual(place(h.state().cursor.anchor), place(before.cursor.anchor))
    assert.equal(h.state().cursor.mode, 'history')
    assert.equal(h.state().cursor.still, true)
  } finally {h.dispose()}
})

test('a streaming page holds back the short tail that version-2 pagination merges into it', () => {
  const head = 'あ'.repeat(60) + '。' + 'い'.repeat(60) + '。', tail = 'う'.repeat(20) + '。'
  assert.deepEqual(stageBlockPages(head + tail, 2), [head + tail], 'the short tail is merged into the page')
  assert.equal(stageBlockPages(head + tail + 'え'.repeat(30) + '。', 2).length, 2, 'past a third of a page it splits off again')
  assert.equal(stagePageHeldTail(head + tail), tail, 'so the stage does not show it on this page yet')
  assert.equal(stagePageHeldTail(head), '', 'a page the version-1 split keeps whole holds nothing back')
})
