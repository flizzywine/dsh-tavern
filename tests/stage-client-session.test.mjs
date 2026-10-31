import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const kernel = require('../tavern-plugin/src/client/stage-runtime.cjs')
const factory = (file, name) => vm.runInNewContext(readFileSync(new URL('../tavern-plugin/packages/dsh-tavern-stage/lib/client/' + file, import.meta.url), 'utf8') + '\n' + name, {})
const {createStageSessionRuntime}=require('../tavern-plugin/packages/dsh-tavern-stage/src/client/session-runtime.cjs')
const runtime=createStageSessionRuntime({kernel,createStoreModule:factory('runtime-store.cjs','createStageRuntimeStoreModule'),createSessionModule:factory('session.cjs','createStageSessionModule')})
const storeModule=factory('runtime-store.cjs','createStageRuntimeStoreModule')(kernel)
const createStageSessionOwner=runtime.createSessionOwner
test.after(()=>runtime.dispose())

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

test('store clears selectors even when a disposal effect throws', () => {
  const store = storeModule.createStageRuntimeStore({observe(event) {
    if (event.type === 'DISPOSE') throw new Error('observer failed')
  }})
  const selection = store.select(state => state.disposed)
  let cleared = 0
  const dispose = selection.dispose
  selection.dispose = () => {cleared++; dispose()}
  assert.throws(() => store.dispose(), /observer failed/)
  assert.equal(store.getSnapshot().disposed, true)
  assert.equal(cleared, 1)
  store.dispose()
  assert.equal(cleared, 1)
})

test('one failed unsubscribe cannot retain other subscriptions or sessions', () => {
  const list = source({current:'a', byId:{a:{},b:{}}})
  const signal = source({view:{}})
  const chat = source({nodes:new Map()})
  const session = source({running:false})
  const binding = {session:{...session, subscribe(fn) {
    const stop = session.subscribe(fn)
    return () => {stop(); throw new Error('host unsubscribe failed')}
  }}}
  let cleared = 0
  const owner = createStageSessionOwner({
    sessions:{list, binding: () => binding}, resolveChat: () => chat,
    views:{select: () => signal, invalidate() {}}, coordination:signal,
    settings:{get: () => ({}), load() {}, subscribe:signal.subscribe},
    preferences:{get: () => ({}), subscribe:signal.subscribe},
    createIndex: () => ({getSnapshot: () => new Map(), reconcile: () => new Map(), clear() {cleared++}}),
  })
  owner.start()
  const first = owner.get('a')
  list.publish({current:'b', byId:{a:{},b:{}}})
  const second = owner.get('b')
  assert.ok(first && second && first !== second)
  assert.throws(() => owner.dispose(), /Stage session cleanup failed/)
  assert.equal(cleared, 2)
  assert.equal(first.getSnapshot().disposed, true)
  assert.equal(second.getSnapshot().disposed, true)
  for (const event of [list, signal, chat, session]) assert.equal(event.count, 0)
  assert.equal(owner.get('a'), null)
  assert.equal(owner.get('b'), null)
  assert.doesNotThrow(() => owner.dispose())
})
