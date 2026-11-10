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

test('round notifications reuse dialogue settings until the card or host changes', () => {
  const list = source({current:'a', byId:{a:{}}})
  const view = source({view:{card:{path:'cards/a.json'}}})
  const sync = source({view:{runtimeGeneration:'v1'}})
  const loads = []
  const owner = createStageSessionOwner({
    sessions:{list, binding: () => ({session:source({running:false})})},
    resolveChat: () => source({nodes:new Map()}),
    views:{select: () => view, invalidate() {}},
    coordination:{getSnapshot:sync.getSnapshot, subscribe(_id, fn){return sync.subscribe(fn)}},
    settings:{get: () => ({}), load(_id, force) {loads.push(force === true)}, subscribe:() => () => {}},
    preferences:{get: () => ({}), subscribe:() => () => {}},
    createIndex: () => ({getSnapshot: () => new Map(), reconcile: () => new Map(), clear() {}}),
  })
  try {
    owner.start()
    sync.publish({view:{runtimeGeneration:'v1', activity:{phase:'running'}}})
    sync.publish({view:{runtimeGeneration:'v1', activity:{phase:'idle'}}})
    assert.deepEqual(loads, [false])
    view.publish({view:{card:{path:'cards/b.json'}}})
    sync.publish({view:{runtimeGeneration:'v2'}})
    assert.deepEqual(loads, [false,true,true])
  } finally { owner.dispose() }
})
