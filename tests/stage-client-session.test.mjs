import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const kernel = require('../tavern-plugin/src/client/stage-runtime.cjs')
const factory = (file, name) => vm.runInNewContext(readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client/' + file, import.meta.url), 'utf8') + '\n' + name, {})
const storeModule = factory('runtime-store.cjs', 'createStageRuntimeStoreModule')(kernel)
const {createStageSessionOwner} = factory('session.cjs', 'createStageSessionModule')(storeModule)

function source(snapshot) {
  const listeners = new Set()
  return {getSnapshot: () => snapshot, subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn)},
    publish(next) {snapshot = next; for (const fn of [...listeners]) fn()}, get count() {return listeners.size}}
}

test('isolated session module owns subscriptions and rejects a body read after disposal', async () => {
  const list = source({current:'a', byId:{a:{}, b:{}}})
  const view = source({view:{}}), coordination = source({view:{}}), prefs = source({})
  const settings = source({})
  const chat = source({nodes:new Map([['n',{id:'n',kind:'assistant-step',location:{turn:{turn:1}},data:{}}]])})
  const session = source({running:false})
  const binding = {session}
  let finish, reads = 0, ingested = 0, cleared = 0
  const owner = createStageSessionOwner({
    sessions:{list, binding: () => binding}, resolveChat: () => chat,
    views:{select: () => view, invalidate() {}}, coordination,
    settings:{get: () => ({}), load() {}, subscribe:settings.subscribe},
    preferences:{get:prefs.getSnapshot, subscribe:prefs.subscribe}, storyTurn: (_, turn) => turn,
    createIndex: () => ({getSnapshot: () => new Map(), reconcile: () => new Map(),
      ingest() {ingested++}, clear() {cleared++}}),
    readBody: () => {reads++; return new Promise(resolve => {finish = resolve})},
  })
  owner.start()
  owner.start()
  assert.equal(list.count, 1)
  assert.ok(owner.get('a'))
  assert.equal(owner.get('b'), null, 'cold sessions do not initialize')
  await Promise.resolve()
  assert.equal(reads, 1)
  const oldStore = owner.get('a')
  owner.dispose()
  owner.dispose()
  finish({paragraphs:[]})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ingested, 0)
  assert.equal(cleared, 1)
  assert.equal(oldStore.getSnapshot().disposed, true)
  assert.equal(owner.get('a'), null)
  for (const signal of [list, view, coordination, prefs, settings, chat, session]) assert.equal(signal.count, 0)
  owner.start()
  assert.equal(list.count, 0, 'disposed owners cannot restart')
})
